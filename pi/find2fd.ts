import {
  createBashToolDefinition,
  SettingsManager,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { withFindWrapper } from "../src/find-wrapper.mjs";

function enabledForProvider(provider: string | undefined): boolean {
  const configured = process.env.FIND2FD_PI_PROVIDERS;
  const providers = configured === undefined
    ? ["qwen-r9700"]
    : configured.split(",").map((value) => value.trim()).filter(Boolean);
  return provider !== undefined && providers.includes(provider);
}

// Model bash calls are independent of Pi's user !/!! execution path.
export default function find2fd(pi: ExtensionAPI) {
  const native = createBashToolDefinition(process.cwd());
  pi.registerTool({
    ...native,
    execute: (id, params, signal, onUpdate, ctx) => {
      const settings = SettingsManager.create(ctx.cwd, process.env.PI_CODING_AGENT_DIR, {
        projectTrusted: ctx.isProjectTrusted(),
      });
      const shellPath = settings.getShellPath();
      const delegate = createBashToolDefinition(ctx.cwd, {
        shellPath,
        commandPrefix: settings.getShellCommandPrefix(),
        spawnHook: !["off", "0"].includes(process.env.FIND2FD_ACCELERATION ?? "")
          && (process.env.FIND2FD_EXPERIMENTAL_FD === undefined || process.env.FIND2FD_EXPERIMENTAL_FD === "1")
          && enabledForProvider(ctx.model?.provider)
          ? (context) => withFindWrapper(context, shellPath)
          : undefined,
      });
      return delegate.execute(id, params, signal, onUpdate, ctx);
    },
  });
}
