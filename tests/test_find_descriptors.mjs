import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { withFindWrapper } from '../src/find-wrapper.mjs';

const launcher = fileURLToPath(new URL('../bin/find2fd', import.meta.url));
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;

function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'find2fd-descriptors-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  mkdirSync(join(cwd, 'tree')); mkdirSync(join(cwd, 'bin'));
  writeFileSync(join(cwd, 'tree/hit'), 'owned descriptor\n'); writeFileSync(join(cwd, 'tree/other'), 'other\n');
  const trace = join(cwd, 'calls'), inputs = join(cwd, 'inputs'); writeFileSync(trace, ''); writeFileSync(inputs, '');
  const realFd = spawnSync('/usr/bin/bash', ['--noprofile', '--norc', '-c', 'command -v fd || command -v fdfind'], { encoding: 'utf8' });
  assert.equal(realFd.status, 0, 'actual fd or fdfind is mandatory');
  // Bash exec delegation preserves all inherited descriptors. A Node recorder
  // using default stdio would conceal the boundary under test.
  writeFileSync(join(cwd, 'bin/find'), '#!/usr/bin/bash\nkind=native\nfor arg; do\n  case "$arg" in /dev/null) kind=validation ;; /proc/self/fd/[0-9]*) kind=broker; printf "%s\\n" "$arg" >> "$DESCRIPTOR_INPUTS" ;; esac\ndone\nprintf "find:%s\\n" "$kind" >> "$DESCRIPTOR_TRACE"\nexec -a find /usr/bin/find "$@"\n', { mode: 0o700 });
  writeFileSync(join(cwd, 'bin/fd'), `#!/usr/bin/bash\nprintf 'fd:search\\n' >> "$DESCRIPTOR_TRACE"\nexec ${quote(realFd.stdout.trim())} "$@"\n`, { mode: 0o700 });
  const env = { ...process.env, LC_ALL: 'C', LANG: 'C', PATH: `${join(cwd, 'bin')}:${process.env.PATH}`,
    DESCRIPTOR_TRACE: trace, DESCRIPTOR_INPUTS: inputs, DESCRIPTOR_LAUNCHER: launcher, DESCRIPTOR_RESULT: join(cwd, 'result'), DESCRIPTOR_NODE: process.execPath,
    DESCRIPTOR_MODULE: fileURLToPath(new URL('../src/find-wrapper.mjs', import.meta.url)) };
  const calls = () => readFileSync(trace, 'utf8').trim().split('\n').filter(Boolean);
  const metrics = { actualGNUComparisons: 0, actualFdInvocations: 0, actualGNUValidationInvocations: 0, actualNonrecursiveGNUInvocations: 0, actualOriginalGNUInvocations: 0 };
  const inputPaths = () => readFileSync(inputs, 'utf8').trim().split('\n').filter(Boolean);
  function compare(command, route, { broker = false, native = false, record = true, successfulOutput, brokerInputFd } = {}) {
    const environment = record ? env : { ...env, PATH: process.env.PATH };
    // Raise only this owned child limit; SSH shells commonly default to1024.
    const run = (body) => spawnSync('/usr/bin/bash', ['--noprofile', '--norc', '-c', `ulimit -Sn 4098 || exit 125\n${body}`], { cwd, env: environment, timeout: 10000, maxBuffer: 1024 * 1024 });
    const expected = run(`find() { (exec -a find /usr/bin/find "$@"); }\n${command}`);
    const before = calls().length, inputBefore = inputPaths().length;
    const body = route === 'private' ? withFindWrapper({ command }, '/usr/bin/bash').command : route === 'direct'
      ? `find() { command "$DESCRIPTOR_NODE" --input-type=module -e 'const {runFind}=await import(process.env.DESCRIPTOR_MODULE);process.exitCode=await runFind(process.argv.slice(1),{callerDescriptors:[3]});' -- "$@"; }\n${command}`
      : `find() { command "$DESCRIPTOR_LAUNCHER" "$@"; }\n${command}`;
    const actual = run(body);
    for (const result of [expected, actual]) { assert.equal(result.error, undefined); assert.equal(result.signal, null); }
    assert.equal(actual.status, expected.status, `${route}: ${command}`);
    assert.deepEqual(actual.stdout, expected.stdout, `${route} stdout: ${command}`);
    assert.deepEqual(actual.stderr, expected.stderr, `${route} stderr: ${command}`);
    if (successfulOutput !== undefined) {
      assert.equal(expected.status, 0, 'positive GNU descriptor witness must succeed');
      assert.deepEqual(expected.stderr, Buffer.alloc(0), 'paired descriptor-open errors cannot count as coverage');
      assert.ok(expected.stdout.length > 0, 'GNU witness must produce owned content');
      if (successfulOutput !== true) assert.deepEqual(actual.stdout, Buffer.from(successfulOutput));
    }
    const invoked = calls().slice(before);
    metrics.actualGNUComparisons++;
    metrics.actualFdInvocations += invoked.filter((call) => call === 'fd:search').length;
    metrics.actualGNUValidationInvocations += invoked.filter((call) => call === 'find:validation').length;
    metrics.actualNonrecursiveGNUInvocations += invoked.filter((call) => call === 'find:broker').length;
    metrics.actualOriginalGNUInvocations += invoked.filter((call) => call === 'find:native').length;
    if (broker) { assert.ok(invoked.includes('fd:search')); assert.ok(invoked.includes('find:broker')); assert.ok(!invoked.includes('find:native')); }
    if (brokerInputFd !== undefined) assert.deepEqual(inputPaths().slice(inputBefore), [`/proc/self/fd/${brokerInputFd}`], 'private evaluator chooses the unused descriptor without clobbering caller FD3');
    if (native) { assert.equal(invoked.filter((call) => call === 'find:native').length, 1); assert.ok(!invoked.includes('fd:search')); }
  }
  return { compare, metrics };
}

test('public and private find preserve caller FD3 through native actions and metadata brokers', (t) => {
  const f = fixture(t);
  for (const route of ['public', 'private']) {
    f.compare('exec 3>"$DESCRIPTOR_RESULT"\nfind tree/hit -maxdepth 0 -exec /usr/bin/bash -c \'printf "owned-fd3\\n" >&3\' ";"\nstatus=$?\n/usr/bin/cat "$DESCRIPTOR_RESULT"\nexit "$status"', route, { native: true });
    f.compare('exec 3<tree/hit\nfind -L tree -samefile /dev/fd/3 -printf "%p:%s\\n"', route, { broker: true, successfulOutput: true, brokerInputFd: 4 });
    f.compare('exec 3>"$DESCRIPTOR_RESULT"\nfind tree -type f -size +0c -printf "%p:%s\\n"\nstatus=$?\nprintf "caller-fd3-still-open\\n" >&3\n/usr/bin/cat "$DESCRIPTOR_RESULT"\nexit "$status"', route, { broker: true, brokerInputFd: 4 });
    f.compare('exec 3<tree/hit\nfind -H tree -samefile /dev/fd/3 -print0', route, { native: true, successfulOutput: 'tree/hit\0' });
  }
  t.diagnostic(JSON.stringify({ campaign: 'find-caller-fd3', ...f.metrics, privateBrokerInputCannotClobberCallerFD3: true }));
});

test('public and private find preserve high descriptors and process substitution references', (t) => {
  const f = fixture(t);
  const limit = spawnSync('/usr/bin/bash', ['-c', 'ulimit -Hn'], { encoding: 'utf8' });
  assert.equal(limit.status, 0); assert.ok(limit.stdout.trim() === 'unlimited' || Number(limit.stdout) > 4097, 'Linux hard descriptor limit must allow descriptor 4097');
  for (const route of ['public', 'private']) {
    f.compare('exec 4097<tree/hit\nfind -L tree -samefile /dev/fd/4097 -print0', route, { broker: true, successfulOutput: 'tree/hit\0' });
    f.compare('exec 4097>"$DESCRIPTOR_RESULT"\nfind tree/hit -maxdepth 0 -exec /usr/bin/bash -c \'printf "owned-high-fd\\n" >&4097\' ";"\nstatus=$?\n/usr/bin/cat "$DESCRIPTOR_RESULT"\nexit "$status"', route, { native: true, successfulOutput: 'owned-high-fd\n' });
    f.compare('exec 63<tree/hit\nfind -L tree -samefile /dev/fd/63 -print0', route, { broker: true });
    f.compare('find -files0-from <(printf "tree/hit\\0tree/other\\0") -maxdepth 0 -print0', route, { native: true });
  }
  t.diagnostic(JSON.stringify({ campaign: 'find-high-fd-process-substitution', ...f.metrics, highDescriptor: 4097, successfulHighDescriptorOpenWitnesses: 4 }));
});

test('closed caller descriptors retain exact GNU errors instead of exposing private Node descriptors', (t) => {
  const f = fixture(t);
  for (const route of ['public', 'private']) for (const descriptor of [3, 63])
    f.compare(`exec ${descriptor}<&-\nfind -L tree -samefile /dev/fd/${descriptor} -print0`, route, { native: true });
  t.diagnostic(JSON.stringify({ campaign: 'find-closed-caller-fd', ...f.metrics }));
});

test('closed standard descriptors preserve GNU find status, streams and stdin ownership', (t) => {
  const f = fixture(t);
  const cases = [
    'find tree -maxdepth 0 -print 1>&-',
    'find missing-owned-path -print 2>&-',
    'find tree -maxdepth 0 -print 2>&-',
    'find tree -maxdepth 0 -print 0<&-',
    'find -files0-from - -maxdepth 0 -print 0<&-',
  ];
  // Direct GNU executables here: no recorder may reopen a closed standard FD.
  for (const route of ['public', 'private']) for (const command of cases) f.compare(command, route, { record: false });
  t.diagnostic(JSON.stringify({ campaign: 'find-closed-standard-fds', actualGNUComparisons: f.metrics.actualGNUComparisons, closedDescriptors: [0, 1, 2], directExecutablesWithoutRecorder: true }));
});

test('direct runFind explicit callerDescriptors preserves low FD3 for GNU metadata evaluation', (t) => {
  const f = fixture(t);
  f.compare('exec 3<tree/hit\nfind -L tree -samefile /dev/fd/3 -print0', 'direct', { broker: true, successfulOutput: 'tree/hit\0', brokerInputFd: 4 });
  t.diagnostic(JSON.stringify({ campaign: 'find-direct-explicit-caller-fd', ...f.metrics, explicitCallerDescriptors: [3] }));
});
