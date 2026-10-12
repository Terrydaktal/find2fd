// Scope checks use synthetic files and offline SDK sessions only. A tracing fd
// executable delegates to the real engine so routing assertions do not replace
// the behavior being checked with a canned response.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { withFindWrapper } from "../src/find-wrapper.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const realFd = spawnSync("/usr/bin/bash", ["-c", "command -v fd || command -v fdfind"], { encoding: "utf8" }).stdout.trim();
assert.ok(realFd, "scope verification requires a real fd engine");
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
const textOf = (result) => result.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");

function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), "pi-find-scope-"));
  const bin = join(cwd, "bin"), trace = join(cwd, "fd-trace.txt");
  mkdirSync(bin);
  mkdirSync(join(cwd, "tree"));
  writeFileSync(join(cwd, "tree/foo.txt"), "synthetic\n");
  writeFileSync(join(cwd, "child.sh"), "#!/usr/bin/env bash\ntype -t find\nfind tree -name foo.txt\n", { mode: 0o700 });
  writeFileSync(join(bin, "fd"), `#!/usr/bin/env bash\nprintf 'fd\n' >> "$FIND_SCOPE_TRACE"\nexec ${quote(realFd)} "$@"\n`, { mode: 0o700 });
  const env = { ...process.env, FIND2FD_EXPERIMENTAL_FD: "1", PATH: `${bin}:${process.env.PATH ?? ""}`, FIND_SCOPE_TRACE: trace, LC_ALL: "C" };
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  return { cwd, env, bin, trace, calls: () => existsSync(trace) ? readFileSync(trace, "utf8").split("\n").filter(Boolean).length : 0 };
}

function shell(command, current, { wrapped = false, interactive = false } = {}) {
  const context = { command, cwd: current.cwd, env: current.env };
  const adapted = wrapped ? withFindWrapper(context, "/usr/bin/bash") : context;
  const result = spawnSync("/usr/bin/bash", ["--noprofile", "--norc", interactive ? "-ic" : "-c", adapted.command], {
    cwd: adapted.cwd, env: adapted.env, stdio: ["ignore", "pipe", "pipe"], timeout: 5000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr?.toString());
  return result.stdout.toString();
}

test("the wrapper does not alter ordinary interactive shells, native find, or child scripts", (t) => {
  const current = fixture(t);
  assert.equal(shell("type -t find; find tree -name foo.txt", current, { interactive: true }), "file\ntree/foo.txt\n");
  assert.equal(current.calls(), 0, "an ordinary shell invokes GNU find, without fd");
  assert.equal(shell("type -t find; command find tree -name foo.txt; /usr/bin/find tree -name foo.txt; bash child.sh", current, { wrapped: true }),
    "function\ntree/foo.txt\ntree/foo.txt\nfile\ntree/foo.txt\n");
  assert.equal(current.calls(), 0, "command/absolute-path bypasses and child scripts remain native");
  assert.equal(shell("export -pf | /usr/bin/grep '^declare -fx find' || :; bash -c 'type -t find'; printenv | /usr/bin/grep '^BASH_FUNC_find%%=' || :", current, { wrapped: true }), "file\n");
  assert.equal(current.calls(), 0, "the scoped find function is not exported to descendants");
  assert.equal(shell("type -t find; find tree -name foo.txt", current), "file\ntree/foo.txt\n");
  assert.equal(current.calls(), 0, "a later shell remains unchanged");
});

test("bare find is translated automatically in compound shell commands, pipelines and subshells", (t) => {
  const current = fixture(t);
  const output = shell("printf 'discarded\\n' | find tree -name foo.txt; (find tree -name foo.txt); for target in tree; do find \"$target\" -name foo.txt; done", current, { wrapped: true });
  assert.equal(output, "tree/foo.txt\ntree/foo.txt\ntree/foo.txt\n");
  assert.equal(current.calls(), 3, "all three bare find commands reached the real fd engine");
});

test("non-Bash shell settings retain the original command and environment", () => {
  const context = { command: "find tree -name foo.txt", cwd: "/synthetic", env: { SYNTHETIC: "1" } };
  for (const path of ["/usr/bin/fish", "/bin/sh", "/bin/zsh"]) assert.equal(withFindWrapper(context, path), context);
});

test("the find prefix preserves an existing private grep function", (t) => {
  const current = fixture(t);
  const adapted = withFindWrapper({ command: "grep preserved; find tree -name foo.txt; type -t grep", cwd: current.cwd, env: current.env }, "/usr/bin/bash");
  const sentinel = "grep() { printf 'GREPSENTINEL:%s\\n' \"$1\"; }; export -n -f grep; ";
  assert.equal(shell(sentinel + adapted.command, current), "GREPSENTINEL:preserved\ntree/foo.txt\nfunction\n");
  assert.equal(current.calls(), 1);
});

// The verifier registers this group only in its explicit SDK stage; the CPU run
// has no misleading skipped integration check when dependencies are unavailable.
if (process.env.FIND2FD_TEST_PI_SDK === "1") {
  test("installed Pi applies the wrapper only to qwen-r9700 model tools, never user ! commands", { timeout: 20000 }, async (t) => {
    const sdkRoot = process.env.FIND2FD_TEST_PI_ROOT ?? process.env.QWEN_TEST_PI_ROOT;
    assert.ok(sdkRoot, "explicit SDK checks require FIND2FD_TEST_PI_ROOT");
    const mod = (path) => import(pathToFileURL(join(sdkRoot, path)));
    const { createAgentSession } = await mod("pi-coding-agent/dist/core/sdk.js");
    const { SettingsManager } = await mod("pi-coding-agent/dist/core/settings-manager.js");
    const { SessionManager } = await mod("pi-coding-agent/dist/core/session-manager.js");
    const { DefaultResourceLoader } = await mod("pi-coding-agent/dist/core/resource-loader.js");
    const { validateToolArguments } = await mod("pi-ai/dist/utils/validation.js");
    const current = fixture(t), agentDir = join(current.cwd, "agent");
    mkdirSync(agentDir);
    const previous = process.env.PI_CODING_AGENT_DIR;
    const previousProviders = process.env.FIND2FD_PI_PROVIDERS;
    const previousExperiment = process.env.FIND2FD_EXPERIMENTAL_FD;
    process.env.FIND2FD_EXPERIMENTAL_FD = "1";
    t.after(() => { if (previousExperiment === undefined) delete process.env.FIND2FD_EXPERIMENTAL_FD; else process.env.FIND2FD_EXPERIMENTAL_FD = previousExperiment; });
    process.env.PI_CODING_AGENT_DIR = agentDir;
    t.after(() => { if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous; });
    delete process.env.FIND2FD_PI_PROVIDERS;
    t.after(() => { if (previousProviders === undefined) delete process.env.FIND2FD_PI_PROVIDERS; else process.env.FIND2FD_PI_PROVIDERS = previousProviders; });
    writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ defaultTools: ["bash"], shellPath: "/usr/bin/bash",
      shellCommandPrefix: `export PATH=${quote(current.bin)}:"$PATH"\nexport FIND_SCOPE_TRACE=${quote(current.trace)}\nexport LC_ALL=C`,
      compaction: { enabled: false }, retry: { enabled: false } }));
    let networkRequests = 0, inferenceRequests = 0;
    t.mock.method(globalThis, "fetch", () => { networkRequests++; throw new Error("Network forbidden in find scope fixture"); });
    const model = (provider, id) => ({ provider, id, name: id, api: "openai-completions", baseUrl: "http://fixture.invalid/v1",
      reasoning: false, input: ["text"], contextWindow: 32768, maxTokens: 8192, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } });
    const models = [model("qwen-r9700", "qwen-scope-fixture"), model("fixture", "non-qwen"),
      model("openai", "qwen-name-with-other-provider"), model("qwen-r9700-other", "qwen-near-provider")];
    const modelRuntime = { getModel: (provider, id) => models.find((item) => item.provider === provider && item.id === id),
      getAvailableSnapshot: () => models, hasConfiguredAuth: () => true, checkAuth: async () => true,
      isUsingOAuth: () => false, getAuth: async () => ({ auth: { apiKey: "fixture" }, env: {} }),
      streamSimple: () => { inferenceRequests++; throw new Error("Inference forbidden in find scope fixture"); } };
    const settingsManager = SettingsManager.create(current.cwd, agentDir, { projectTrusted: true });
    const resourceLoader = new DefaultResourceLoader({ cwd: current.cwd, agentDir, settingsManager,
      noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
      additionalExtensionPaths: [join(root, "pi/find2fd.ts")] });
    await resourceLoader.reload();
    assert.deepEqual(resourceLoader.getExtensions().errors, []);
    const { session } = await createAgentSession({ cwd: current.cwd, agentDir, model: models[0], modelRuntime, settingsManager, resourceLoader,
      sessionManager: SessionManager.create(current.cwd, join(current.cwd, "sessions")) });
    const errors = [];
    session.extensionRunner.onError((error) => errors.push(error));
    t.after(async () => { await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" }); session.dispose(); });
    await session.bindExtensions({ uiContext: { notify() {}, setWidget() {}, setStatus() {}, setWorkingMessage() {} } });
    const invoke = async (command) => {
      const tool = session.agent.state.tools.find((candidate) => candidate.name === "bash");
      assert.ok(tool, "the actual SDK native bash tool is active");
      const params = { command, timeout: 5 };
      validateToolArguments(tool, { name: tool.name, arguments: params });
      return textOf(await tool.execute("synthetic-find-scope", params, new AbortController().signal));
    };
    await t.test("Qwen gets automatic private routing by default and explicit nonexperiment flags stay native", async () => {
      const count = current.calls();
      try {
        for (const flag of [undefined, "", "0", "true", "01", "1 "]) {
          if (flag === undefined) delete process.env.FIND2FD_EXPERIMENTAL_FD;
          else process.env.FIND2FD_EXPERIMENTAL_FD = flag;
          assert.equal(await invoke("type -t find; find tree -name foo.txt"), `${flag === undefined ? "function" : "file"}\ntree/foo.txt\n`);
          assert.equal(current.calls(), count, "small/native-policy Pi calls must not invoke fd");
        }
      } finally { process.env.FIND2FD_EXPERIMENTAL_FD = "1"; }
    });
    await t.test("explicitly experimental Qwen bare shell find reaches fd without rewriting the model command", async () => {
      const count = current.calls();
      assert.equal(await invoke("type -t find; find tree -name foo.txt"), "function\ntree/foo.txt\n");
      assert.equal(current.calls(), count + 1);
      assert.equal(await invoke("printf 'discarded\\n' | find tree -name foo.txt; (find tree -name foo.txt)"), "tree/foo.txt\ntree/foo.txt\n");
      assert.equal(current.calls(), count + 3, "compound pipeline and subshell also use the wrapper");
    });
    await t.test("Qwen child scripts and explicit native bypasses do not reach fd", async () => {
      const count = current.calls();
      assert.equal(await invoke("command find tree -name foo.txt; /usr/bin/find tree -name foo.txt; bash child.sh"), "tree/foo.txt\ntree/foo.txt\nfile\ntree/foo.txt\n");
      assert.equal(current.calls(), count);
    });
    await t.test("Pi user ! shell execution retains native GNU find", async () => {
      const count = current.calls();
      const event = await session.extensionRunner.emitUserBash({ type: "user_bash", command: "find tree -name foo.txt", excludeFromContext: false, cwd: current.cwd });
      assert.ok(!event?.operations, "the find2fd extension never intercepts user_bash");
      const result = await session.executeBash("type -t find; find tree -name foo.txt");
      assert.equal(result.output, "file\ntree/foo.txt\n");
      assert.equal(current.calls(), count);
    });
    await t.test("switching to other providers disables the hook without disabling the native Bash tool", async () => {
      const count = current.calls();
      for (const other of models.slice(1)) {
        await session.setModel(other);
        assert.equal(await invoke("type -t find; find tree -name foo.txt"), "file\ntree/foo.txt\n", other.provider);
      }
      assert.equal(current.calls(), count);
      await session.setModel(models[0]);
      assert.equal(await invoke("type -t find; find tree -name foo.txt"), "function\ntree/foo.txt\n");
      assert.equal(current.calls(), count + 1, "returning to Qwen restores routing on the next invocation");
    });
    await t.test("a configured exact provider list replaces the default and is read on each invocation", async () => {
      const count = current.calls();
      process.env.FIND2FD_PI_PROVIDERS = " fixture, qwen-r9700-other ";
      assert.equal(await invoke("type -t find; find tree -name foo.txt"), "file\ntree/foo.txt\n", "the default Qwen provider is not implicitly retained");
      assert.equal(current.calls(), count);
      await session.setModel(models[1]);
      assert.equal(await invoke("type -t find; find tree -name foo.txt"), "function\ntree/foo.txt\n");
      await session.setModel(models[3]);
      assert.equal(await invoke("type -t find; find tree -name foo.txt"), "function\ntree/foo.txt\n");
      assert.equal(current.calls(), count + 2);
      await session.setModel(models[2]);
      assert.equal(await invoke("type -t find; find tree -name foo.txt"), "file\ntree/foo.txt\n", "a model name containing qwen never authorizes its provider");
      assert.equal(current.calls(), count + 2);
      await session.setModel(models[0]);
      process.env.FIND2FD_PI_PROVIDERS = "";
      assert.equal(await invoke("type -t find; find tree -name foo.txt"), "file\ntree/foo.txt\n", "an explicit empty provider list disables adaptation");
      assert.equal(current.calls(), count + 2);
      delete process.env.FIND2FD_PI_PROVIDERS;
      assert.equal(await invoke("type -t find; find tree -name foo.txt"), "function\ntree/foo.txt\n");
      assert.equal(current.calls(), count + 3, "removing the setting immediately restores the default");
    });
    assert.deepEqual(errors, []);
    assert.equal(networkRequests, 0);
    assert.equal(inferenceRequests, 0);
    t.diagnostic(JSON.stringify({ campaign: "pi-sdk-scope", actualFdInvocations: current.calls(), networkRequests, inferenceRequests, extension: "pi/find2fd.ts", nativeToolName: "bash" }));
  });
}
