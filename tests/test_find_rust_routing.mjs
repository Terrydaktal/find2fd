// Exercise the actual compiled CLI and private Bash hook. Route metadata alone
// cannot prove that Pi avoided a Node helper or delegated only once to GNU.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { withFindWrapper } from '../src/find-wrapper.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const BINARY = process.env.FIND2FD_RUST_BINARY || join(ROOT, 'rust/target/release/find2fd-rust');
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
const BASE_ENV = { ...process.env, PATH: '/usr/bin:/bin', LC_ALL: 'C', LANG: 'C', TERM: 'dumb' };
for (const key of Object.keys(BASE_ENV)) if (key.startsWith('FIND2FD_')) delete BASE_ENV[key];
delete BASE_ENV.POSIXLY_CORRECT;

function fixture(t) {
  assert.ok(existsSync(BINARY), `Build the real Rust release before routing qualification: ${BINARY}`);
  const cwd = mkdtempSync(join(tmpdir(), 'find2fd-rust-routing-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const metrics = { artifactSHA256: createHash('sha256').update(readFileSync(BINARY)).digest('hex'),
    comparisons: 0, rustSearches: 0, gnuFallbacks: 0, ioComparisons: 0, failures: 0, classes: {} };
  mkdirSync(join(cwd, 'tree')); mkdirSync(join(cwd, 'tree/sub'));
  for (const name of ['tree/last.txt', 'tree/.hidden', 'tree/first.txt', 'tree/sub/target.txt', 'tree/spaced name.txt', 'tree/line\nbreak.txt'])
    writeFileSync(join(cwd, name), 'owned synthetic fixture\n');
  symlinkSync('sub', join(cwd, 'tree/link'));
  const preload = join(cwd, 'no-node.cjs');
  writeFileSync(preload, 'throw new Error("Ordinary Rust routing started Node");\n');
  const env = { ...BASE_ENV, FIND2FD_RUST_BINARY: BINARY, NODE_OPTIONS: `--require ${preload}` };
  const invoke = (program, argv, environment = env, trace) => {
    const result = spawnSync(trace ? '/usr/bin/strace' : program,
      trace ? ['-qq', '-f', '-s', '65536', '-e', 'trace=execve', '-o', trace, program, ...argv] : argv,
      { cwd, env: environment, timeout: 15000, maxBuffer: 4 * 1024 * 1024, argv0: program === '/usr/bin/find' ? 'find' : undefined });
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.signal, null, result.signal);
    return result;
  };
  const compare = (actual, expected, route, label) => {
    assert.equal(actual.status, expected.status, `${label}: status`);
    assert.deepEqual(actual.stdout, expected.stdout, `${label}: all output bytes/order`);
    assert.deepEqual(actual.stderr, expected.stderr, `${label}: all diagnostic bytes`);
    metrics.comparisons++; metrics[route === 'native' ? 'rustSearches' : route === 'gnu' ? 'gnuFallbacks' : 'ioComparisons']++;
    metrics.classes[label] = (metrics.classes[label] || 0) + 1;
  };
  const successfulExecs = trace => [...readFileSync(trace, 'utf8').matchAll(/execve\("((?:\\.|[^"\\])*)", .*\)\s*=\s*0/g)]
    .map(match => JSON.parse(`"${match[1]}"`));
  const assertExecs = (trace, { rust = 1, GNU = 0, binary = BINARY } = {}) => {
    const executions = successfulExecs(trace);
    assert.equal(executions.filter(path => resolve(path) === resolve(binary)).length, rust, `Rust exec count: ${executions}`);
    assert.equal(executions.filter(path => path === '/usr/bin/find' || path === '/bin/find').length, GNU, `GNU exec count: ${executions}`);
    assert.ok(executions.every(path => !/(?:^|\/)(?:node|fd|fdfind)(?:$|[-.])/.test(path)), `No Node/fd helper: ${executions}`);
    return executions;
  };
  t.after(() => t.diagnostic(JSON.stringify({ campaign: 'compiled-public-and-Pi-routing', ...metrics })));
  return { cwd, env, metrics, invoke, compare, successfulExecs, assertExecs };
}

function launch(argv, route, { cli = join(ROOT, 'bin/find2fd'), hook = withFindWrapper } = {}) {
  return route === 'public' ? [cli, argv] : ['/usr/bin/bash', ['--noprofile', '--norc', '-c',
    hook({ command: 'find "$@"' }, '/usr/bin/bash').command, 'owned-Pi-model-command', ...argv]];
}

test('compiled public CLI and Pi hook use Rust for ordinary searches, with no Node/fd/GNU helper', t => {
  const f = fixture(t);
  const cases = [
    ['tree', '-name', '*.txt', '-print0'],
    ['tree', '-mindepth', '1', '-maxdepth', '2', '-type', 'f', '-print0', '-print0'],
    ['tree', '(', '-name', 'first.txt', '-o', '-name', 'target.txt', ')', '-print0'],
    ['tree', '-name', '?irst.txt', '-print0', ',', '-name', '.hidden', '-print0'],
    ['tree/sub', 'tree/first.txt', 'tree/sub', '-type', 'f', '-print0'],
  ];
  for (const argv of cases) for (const route of ['public', 'private-Bash']) {
    const expected = f.invoke('/usr/bin/find', argv), trace = join(f.cwd, `native-${f.metrics.comparisons}.trace`);
    const [program, args] = launch(argv, route);
    f.compare(f.invoke(program, args, f.env, trace), expected, 'native', `native-${route}`);
    f.assertExecs(trace);
  }
});

test('Rust delegates unsupported expressions once, retaining GNU diagnostics and action boundaries', t => {
  const f = fixture(t), marker = join(f.cwd, 'actions');
  const cases = [
    ['tree', '-size', '+0c', '-printf', '%p:%s\n'],
    ['-H', 'tree/link', '-type', 'f', '-print0'],
    ['tree', '-unknown'],
    ['tree', '-maxdepth', '0', '-exec', '/usr/bin/bash', '-c', `printf x >> ${quote(marker)}`, ';', '-print0'],
  ];
  for (const argv of cases) for (const route of ['public', 'private-Bash']) {
    writeFileSync(marker, '');
    const expected = f.invoke('/usr/bin/find', argv), effects = readFileSync(marker);
    writeFileSync(marker, '');
    const trace = join(f.cwd, `fallback-${f.metrics.comparisons}.trace`), [program, args] = launch(argv, route);
    f.compare(f.invoke(program, args, f.env, trace), expected, 'gnu', `delegation-${route}`);
    f.assertExecs(trace, { GNU: 1 });
    assert.deepEqual(readFileSync(marker), effects, 'requested actions run exactly once');
    const GNUexec = readFileSync(trace, 'utf8').split('\n').find(line => line.includes('execve("/usr/bin/find"'));
    assert.ok(GNUexec.includes('["find", '), `GNU receives its original program identity: ${GNUexec}`);
  }
});

test('explicit optouts and missing builds use GNU without launching Rust, Node or fd', t => {
  const f = fixture(t), argv = ['tree', '-name', '*.txt', '-print0'];
  const controls = [
    { FIND2FD_ACCELERATION: 'off' }, { FIND2FD_ACCELERATION: '0' },
    ...['', '0', 'true', '01', '1 '].map(FIND2FD_EXPERIMENTAL_FD => ({ FIND2FD_EXPERIMENTAL_FD })),
    { FIND2FD_RUST_BINARY: join(f.cwd, 'unbuilt-release') },
  ];
  for (const control of controls) for (const route of ['public', 'private-Bash']) {
    const trace = join(f.cwd, `optout-${f.metrics.comparisons}.trace`), [program, args] = launch(argv, route);
    f.compare(f.invoke(program, args, { ...f.env, ...control }, trace), f.invoke('/usr/bin/find', argv), 'gnu', `optout-${route}`);
    f.assertExecs(trace, { rust: 0, GNU: 1 });
  }
});

test('private Rust function stays local to model commands; bypasses and child/user shells retain GNU', t => {
  const f = fixture(t), argv = ['tree', '-name', 'first.txt', '-print0'];
  const command = `find tree -name first.txt -print0; command find tree -name first.txt -print0; /usr/bin/find tree -name first.txt -print0; /usr/bin/bash -c 'type -t find; find tree -name first.txt -print0'; export -pf | /usr/bin/grep '^declare -fx find' || :`;
  const expected = f.invoke('/usr/bin/bash', ['--noprofile', '--norc', '-c', command]);
  const trace = join(f.cwd, 'scope.trace');
  const actual = f.invoke('/usr/bin/bash', ['--noprofile', '--norc', '-c', withFindWrapper({ command }, '/usr/bin/bash').command], f.env, trace);
  f.compare(actual, expected, 'transport', 'private-scope');
  f.assertExecs(trace, { rust: 1, GNU: 3 });
  const outsideTrace = join(f.cwd, 'user-shell.trace');
  f.compare(f.invoke('/usr/bin/bash', ['--noprofile', '--norc', '-c', 'find "$@"', 'owned-user-command', ...argv], f.env, outsideTrace),
    f.invoke('/usr/bin/find', argv), 'gnu', 'outside-user-shell');
  f.assertExecs(outsideTrace, { rust: 0, GNU: 1 });
  for (const shell of ['/bin/sh', '/usr/bin/fish', '/bin/zsh']) {
    const context = { command: 'find tree -print0', cwd: f.cwd, env: f.env };
    assert.equal(withFindWrapper(context, shell), context, 'non-Bash commands remain untouched');
  }
});

test('standard package-relative Rust lookup survives symlink chains and shell-metacharacter install paths', async t => {
  const f = fixture(t), packageRoot = join(f.cwd, "package ' $(touch must-not-exist) `touch must-not-exist`");
  mkdirSync(packageRoot);
  cpSync(join(ROOT, 'src'), join(packageRoot, 'src'), { recursive: true });
  mkdirSync(join(packageRoot, 'bin')); cpSync(join(ROOT, 'bin/find2fd'), join(packageRoot, 'bin/find2fd'));
  const installedBinary = join(packageRoot, 'rust/target/release/find2fd-rust');
  mkdirSync(dirname(installedBinary), { recursive: true }); symlinkSync(BINARY, installedBinary);
  const chained = join(f.cwd, 'CLI second link');
  symlinkSync(join(packageRoot, 'bin/find2fd'), join(f.cwd, 'CLI first link')); symlinkSync(join(f.cwd, 'CLI first link'), chained);
  const hook = (await import(pathToFileURL(join(packageRoot, 'src/find-wrapper.mjs')).href)).withFindWrapper;
  const env = { ...f.env }; delete env.FIND2FD_RUST_BINARY;
  const argv = ['tree', '-name', '*.txt', '-print0'];
  for (const route of ['public', 'private-Bash']) {
    const [program, args] = launch(argv, route, { cli: chained, hook }), trace = join(f.cwd, `${route}-relocation.trace`);
    f.compare(f.invoke(program, args, env, trace), f.invoke('/usr/bin/find', argv), 'native', `relocated-${route}`);
    f.assertExecs(trace, { binary: installedBinary });
  }
  assert.equal(existsSync(join(f.cwd, 'must-not-exist')), false, 'installation paths never execute substitutions');
});

test('closed stdin/stdout delegate before runtime initialization can replace their descriptor state', t => {
  const f = fixture(t);
  for (const [argv, closure] of [[['tree', '-maxdepth', '0', '-print'], '1>&-'], [['-files0-from', '-', '-print0'], '0<&-']])
    for (const route of ['public', 'private-Bash']) {
      const command = route === 'public' ? `${quote(join(ROOT, 'bin/find2fd'))} "$@" ${closure}`
        : withFindWrapper({ command: `find "$@" ${closure}` }, '/usr/bin/bash').command;
      const trace = join(f.cwd, `closed-${f.metrics.comparisons}.trace`);
      const expected = f.invoke('/usr/bin/bash', ['--noprofile', '--norc', '-c', `exec -a find /usr/bin/find "$@" ${closure}`, 'owned-GNU-descriptor', ...argv]);
      assert.equal(expected.status, 1, 'GNU independently confirms a real EBADF failure');
      f.compare(f.invoke('/usr/bin/bash', ['--noprofile', '--norc', '-c', command, 'owned-Rust-descriptor', ...argv], f.env, trace), expected, 'gnu', `closed-descriptor-${route}`);
      f.assertExecs(trace, { rust: 0, GNU: 1 });
    }
});
