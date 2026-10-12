import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { PUBLIC, ROOT, exact, fixture, quote, run } from './helpers.mjs';
import { withFindWrapper } from '../src/find-wrapper.mjs';

function defaultFixture(t) {
  const f = fixture(t, { rawNames: true });
  delete f.env.FIND2FD_EXPERIMENTAL_FD;
  const recorder = join(f.cwd, 'native-recorder.py'), preload = join(f.cwd, 'unexpected-node.cjs'), nodeTrace = join(f.cwd, 'unexpected-node.log');
  writeFileSync(recorder, 'import json,os,sys\nwith open(os.environ["FIND2FD_NATIVE_TRACE"],"a") as output: output.write(json.dumps(sys.argv[1:])+"\\n")\n');
  writeFileSync(join(f.bin, 'find'), `#!/usr/bin/env bash\npython3 ${quote(recorder)} "$@"\nexec -a find /usr/bin/find "$@"\n`, { mode: 0o700 });
  writeFileSync(preload, 'require("node:fs").appendFileSync(process.env.FIND2FD_UNEXPECTED_NODE,"Node\\n");throw new Error("default GNU route unexpectedly invoked Node");\n');
  f.env.NODE_OPTIONS = `--require ${preload}`;
  f.env.FIND2FD_UNEXPECTED_NODE = nodeTrace;
  const assertNativeOnly = () => {
    assert.equal(existsSync(nodeTrace), false, 'public/private default calls must never start Node, including private absolute Node dispatch');
    assert.equal(f.calls().length, 0, 'default calls must not probe or execute fd/fdfind');
    assert.ok(f.nativeCalls().every((argv) => !argv.includes('-files0-from') || !argv.includes('/dev/null')), 'default calls must not compile GNU expressions separately');
  };
  const invoke = (argv, route, env = f.env, extras = {}) => route === 'public'
    ? run(PUBLIC, argv, f.cwd, { env, ...extras })
    : run('/usr/bin/bash', ['--noprofile', '--norc', '-c', withFindWrapper({ command: 'find "$@"' }, '/usr/bin/bash').command,
      'owned-default-find', ...argv], f.cwd, { env, ...extras });
  return { ...f, invoke, assertNativeOnly };
}

function GNU(argv, f, extra = {}) { return run('/usr/bin/find', argv, f.cwd, { env: f.env, ...extra }); }

test('source-only installation and nonexact experiment values preserve GNU argv with zero Node or fd work', (t) => {
  const f = defaultFixture(t); let comparisons = 0;
  for (const flag of [undefined, '', '0', 'true', '01', '1 ']) for (const route of ['public', 'private-Bash'])
    for (const argv of [['tree', '-name', '*.txt', '-print0'], ['tree', '-size', '+0c', '-printf', String.raw`%p|%s\n`], ['tree', '-unknown']]) {
      const env = { ...f.env, FIND2FD_RUST_BINARY: join(f.cwd, 'unbuilt-release') }; if (flag === undefined) delete env.FIND2FD_EXPERIMENTAL_FD; else env.FIND2FD_EXPERIMENTAL_FD = flag;
      const before = f.nativeCalls().length;
      exact(f.invoke(argv, route, env), GNU(argv, f), JSON.stringify({ flag: flag ?? 'absent', route, argv }));
      assert.deepEqual(f.nativeCalls().slice(before), [argv], 'exact original GNU argv runs once'); comparisons++;
    }
  f.assertNativeOnly();
  t.diagnostic(JSON.stringify({ campaign: 'source-only-GNU-policy', actualGNUComparisons: comparisons, CLIEntryRoutes: 2,
    actualOriginalGNUInvocations: comparisons, actualNodeInvocations: 0, actualFdInvocations: 0, actualGNUPreflightInvocations: 0,
    missingBuildFallsBack: true, acceptedExperimentalValue: '1', rejectedValues: ['', '0', 'true', '01', '1 '] }));
});

test('small-tree direct API selects GNU and an exact opt-in has independently witnessed real fd contribution', (t) => {
  const f = defaultFixture(t), argv = ['tree', '-name', 'foo.txt', '-print0'];
  const module = pathToFileURL(join(ROOT, 'src/find-wrapper.mjs')).href;
  const source = `import assert from 'node:assert/strict';import {planFind,runFind} from ${JSON.stringify(module)};const args=process.argv.slice(1);const plan=planFind(args,{cwd:process.cwd()});assert.equal(plan.backend,'find');assert.deepEqual(plan.args,args);process.exitCode=await runFind(args);`;
  let comparisons = 0;
  for (const flag of [undefined, '0', 'true']) {
    const env = { ...f.env }; delete env.NODE_OPTIONS;
    if (flag === undefined) delete env.FIND2FD_EXPERIMENTAL_FD; else env.FIND2FD_EXPERIMENTAL_FD = flag;
    const before = f.nativeCalls().length;
    exact(run(process.execPath, ['--input-type=module', '-e', source, ...argv], f.cwd, { env }), GNU(argv, f));
    assert.deepEqual(f.nativeCalls().slice(before), [argv]); comparisons++;
  }
  f.assertNativeOnly();
  const optIn = { ...f.env, FIND2FD_EXPERIMENTAL_FD: '1' }; delete optIn.NODE_OPTIONS;
  const before = f.nativeCalls().length;
  exact(f.invoke(argv, 'public', optIn), GNU(argv, f));
  assert.equal(f.actualSearchCalls(), 1, 'the experiment must actually invoke the real fd engine');
  assert.deepEqual(f.nativeCalls().slice(before), [], 'pure experimental route must not replay the original GNU command');
  t.diagnostic(JSON.stringify({ campaign: 'default-direct-API-and-explicit-experiment', actualGNUComparisons: comparisons + 1,
    directAPINativeComparisons: comparisons, actualOriginalGNUInvocations: comparisons, experimentalGNUComparisons: 1,
    experimentalActualFdInvocations: 1, speedClaim: 'none' }));
});

test('default public/private routes preserve invalid UTF-8 argv and caller FD3, FD63 and confirmed FD4097', (t) => {
  const f = defaultFixture(t), raw = Buffer.from([0xff, 0xfe]);
  const prefix = withFindWrapper({ command: 'find "$@"' }, '/usr/bin/bash').command;
  const script = String.raw`import json,subprocess,sys
raw=bytes.fromhex(sys.argv[3]); results=[]
for argv in [[b'tree',b'-name',raw+b'.txt',b'-print0'],[b'tree/'+raw+b'.txt',b'-print0']]:
    expected=subprocess.run([b'/usr/bin/find']+argv,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    for command in [[sys.argv[1].encode()]+argv,[b'/usr/bin/bash',b'--noprofile',b'--norc',b'-c',sys.argv[2].encode(),b'owned-raw-default']+argv]:
        actual=subprocess.run(command,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        pack=lambda r:{'status':r.returncode,'stdoutHex':r.stdout.hex(),'stderrHex':r.stderr.hex()}
        results.append({'actual':pack(actual),'expected':pack(expected)})
print(json.dumps(results))`;
  const rawResult = run('python3', ['-c', script, PUBLIC, prefix, raw.toString('hex')], f.cwd, { env: f.env });
  assert.equal(rawResult.status, 0, rawResult.stderr.toString());
  const rawCases = JSON.parse(rawResult.stdout); assert.equal(rawCases.length, 4);
  for (const item of rawCases) { assert.deepEqual(item.actual, item.expected); assert.equal(item.expected.status, 0); assert.ok(item.expected.stdoutHex.length > 0); }
  let descriptors = 0;
  for (const fd of [3, 4097]) for (const route of ['public', 'private-Bash']) {
    const marker = join(f.cwd, `owned-default-fd${fd}`), argv = ['tree', '-maxdepth', '0', '-exec', '/usr/bin/bash', '-c', `printf owned >&${fd}`, ';'];
    const invocation = route === 'public' ? `${quote(PUBLIC)} "$@"` : withFindWrapper({ command: 'find "$@"' }, '/usr/bin/bash').command;
    const prepare = `ulimit -S -n 8192; exec ${fd}>${quote(marker)}; `;
    const expected = run('/usr/bin/bash', ['--noprofile', '--norc', '-c', prepare + 'exec -a find /usr/bin/find "$@"', 'owned-default-native-fd', ...argv], f.cwd, { env: f.env });
    const expectedBytes = readFileSync(marker); assert.deepEqual(expectedBytes, Buffer.from('owned'), 'native FD must actually be open and writable');
    writeFileSync(marker, '');
    const actual = run('/usr/bin/bash', ['--noprofile', '--norc', '-c', prepare + invocation, 'owned-default-wrapped-fd', ...argv], f.cwd, { env: f.env });
    exact(actual, expected); assert.equal(expected.status, 0); assert.deepEqual(readFileSync(marker), expectedBytes); descriptors++;
  }
  for (const route of ['public', 'private-Bash']) {
    const argv = ['-H', 'tree', '-samefile', '/dev/fd/63', '-print0'];
    const prepare = 'exec 63<tree/foo.txt; ';
    const expected = run('/usr/bin/bash', ['--noprofile', '--norc', '-c', prepare + 'exec -a find /usr/bin/find "$@"', 'owned-native-ref', ...argv], f.cwd, { env: f.env });
    const invocation = route === 'public' ? `${quote(PUBLIC)} "$@"` : withFindWrapper({ command: 'find "$@"' }, '/usr/bin/bash').command;
    exact(run('/usr/bin/bash', ['--noprofile', '--norc', '-c', prepare + invocation, 'owned-wrapper-ref', ...argv], f.cwd, { env: f.env }), expected);
    assert.equal(expected.status, 0); assert.deepEqual(expected.stdout, Buffer.from('tree/foo.txt\0')); descriptors++;
  }
  f.assertNativeOnly();
  t.diagnostic(JSON.stringify({ campaign: 'default-raw-argv-and-descriptors', actualGNUComparisons: rawCases.length + descriptors,
    rawInvalidUTF8ArgvComparisons: rawCases.length, descriptorComparisons: descriptors, actualHighFD4097OpenAndWriteConfirmed: 2,
    actualNodeInvocations: 0, actualFdInvocations: 0 }));
});

test('default public/private routes retain GNU closed-standard-descriptor errors and unused/used stdin behavior', (t) => {
  const f = defaultFixture(t); let comparisons = 0;
  for (const [argv, closure] of [[['tree', '-maxdepth', '0', '-print'], '1>&-'],
    [['missing', 'tree/foo.txt', '-print0'], '2>&-'], [['tree/foo.txt', '-print0'], '0<&-'], [['-files0-from', '-', '-print0'], '0<&-']])
    for (const route of ['public', 'private-Bash']) {
      const expected = run('/usr/bin/bash', ['--noprofile', '--norc', '-c', `exec -a find /usr/bin/find "$@" ${closure}`, 'owned-default-native-stdio', ...argv], f.cwd, { env: f.env });
      const invocation = route === 'public' ? `${quote(PUBLIC)} "$@" ${closure}` : withFindWrapper({ command: `find "$@" ${closure}` }, '/usr/bin/bash').command;
      exact(run('/usr/bin/bash', ['--noprofile', '--norc', '-c', invocation, 'owned-default-wrapper-stdio', ...argv], f.cwd, { env: f.env }), expected);
      comparisons++;
    }
  f.assertNativeOnly();
  t.diagnostic(JSON.stringify({ campaign: 'default-closed-standard-descriptors', actualGNUComparisons: comparisons,
    actualNodeInvocations: 0, actualFdInvocations: 0, testedClosures: ['stdout', 'stderr', 'stdin unused', 'stdin used'] }));
});

test('default GNU executes owned actions exactly once and receives original raw NUL stdin roots', (t) => {
  const f = defaultFixture(t), marker = join(f.cwd, 'owned-default-actions'); let comparisons = 0;
  const argv = ['tree', '-maxdepth', '0', '-exec', '/usr/bin/bash', '-c', `printf owned >> ${quote(marker)}`, ';', '-print0'];
  for (const route of ['public', 'private-Bash']) {
    writeFileSync(marker, ''); const expected = GNU(argv, f), effects = readFileSync(marker);
    assert.deepEqual(effects, Buffer.from('owned')); writeFileSync(marker, '');
    exact(f.invoke(argv, route), expected); assert.deepEqual(readFileSync(marker), effects); comparisons++;
  }
  const input = Buffer.concat([Buffer.from('tree/foo.txt\0tree/'), Buffer.from([0xff, 0xfe]), Buffer.from('.txt\0tree/foo.txt\0')]);
  const roots = ['-files0-from', '-', '-print0'];
  for (const route of ['public', 'private-Bash']) {
    const expected = GNU(roots, f, { input }); exact(f.invoke(roots, route, f.env, { input }), expected);
    assert.equal(expected.status, 0); assert.ok(expected.stdout.includes(Buffer.from([0xff, 0xfe]))); comparisons++;
  }
  f.assertNativeOnly();
  t.diagnostic(JSON.stringify({ campaign: 'default-actions-and-raw-stdin', actualGNUComparisons: comparisons,
    ownedActionComparisons: 2, rawNULStdinComparisons: 2, actualNodeInvocations: 0, actualFdInvocations: 0 }));
});
