import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { lstatSync, mkdirSync, readFileSync, readdirSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { constants as osConstants } from 'node:os';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { incrementalFixture } from './find_incremental_helpers.mjs';
import { PUBLIC, exact, run } from './helpers.mjs';
import { withFindWrapper } from '../src/find-wrapper.mjs';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(predicate, timeout = 8000) {
  const end = Date.now() + timeout;
  while (!predicate()) { assert.ok(Date.now() < end, 'owned process readiness deadline'); await delay(10); }
}

test('incremental fd errors and malformed candidates continue through local GNU discovery without replaying output', (t) => {
  const f = incrementalFixture(t);
  for (const failure of ['process.stderr.write("owned fd failure\\n");process.exitCode=1;', 'process.stdout.write("not-an-absolute-path\\0");']) {
    for (const name of ['fd', 'fdfind']) writeFileSync(join(f.bin, name), `#!${process.execPath}\nconst fs=require('node:fs');const argv=process.argv.slice(2);if(argv.includes('--version')){process.stdout.write('fd owned-test\\n');process.exit(0);}fs.appendFileSync(process.env.FIND2FD_TRACE,JSON.stringify(argv)+'\\n');${failure}\n`, { mode: 0o700 });
    const before = f.metrics.actualGNUDiscoveryInvocations;
    const { actual } = f.compare(['tree', '-maxdepth', '8', '-false', '-a', '-quit', '-o', '-print0']);
    assert.ok(f.metrics.actualGNUDiscoveryInvocations > before, 'continuation must perform depth-one discovery');
    const root = Buffer.from('tree\0');
    assert.equal(actual.stdout.subarray(0, root.length).equals(root), true);
    assert.equal(actual.stdout.toString('hex').split(root.toString('hex')).length - 1, 1, 'already printed root must not be replayed');
  }
  t.diagnostic(JSON.stringify({ campaign: 'incremental-fd-fault-continuation', actualGNUComparisons: f.metrics.actualGNUComparisons,
    injectedFdSearchAttempts: f.metrics.actualImmediateFdInvocations, actualFdInvocations: 0,
    actualGNUDiscoveryInvocations: f.metrics.actualGNUDiscoveryInvocations, actualOriginalGNUInvocations: f.metrics.actualOriginalGNUInvocations }));
});

test('incremental unavailable helpers and scratch paths inside roots retain original GNU before evaluation', (t) => {
  for (const failure of ['fd-version', 'script-exit', 'scratch-symlink']) {
    const f = incrementalFixture(t), argv = ['tree', '-maxdepth', '8', '-false', '-a', '-quit', '-o', '-print0'];
    if (failure === 'fd-version') for (const name of ['fd', 'fdfind'])
      writeFileSync(join(f.bin, name), `#!${process.execPath}\nprocess.exit(42);\n`, { mode: 0o700 });
    if (failure === 'script-exit')
      writeFileSync(join(f.bin, 'script'), `#!${process.execPath}\nprocess.exit(42);\n`, { mode: 0o700 });
    if (failure === 'scratch-symlink') {
      const target = join(f.cwd, 'tree', 'scratch'), link = join(f.cwd, 'scratch-link');
      mkdirSync(target); symlinkSync(target, link); f.env.TMPDIR = link;
    }
    f.compare(argv, { fd: 'native' });
    assert.equal(f.metrics.actualGNUEvaluatorInvocations, 0, 'original GNU fallback precedes persistent evaluator startup');
    assert.equal(f.metrics.actualImmediateFdInvocations, 0);
    if (failure === 'scratch-symlink') assert.deepEqual(readdirSync(join(f.cwd, 'tree', 'scratch')), []);
  }
  t.diagnostic(JSON.stringify({ campaign: 'incremental-prestart-native-boundaries', actualGNUComparisons: 3,
    actualOriginalGNUInvocations: 3, actualFdInvocations: 0, actualGNUEvaluatorInvocations: 0 }));
});

test('a disposable ignored-prune mutant is rejected by actual GNU output and no-descent atime oracles', (t) => {
  const f = incrementalFixture(t), source = fileURLToPath(new URL('../src/', import.meta.url));
  const directory = join(f.cwd, 'mutant'); mkdirSync(directory);
  for (const name of readdirSync(source).filter((name) => name.endsWith('.mjs') || name.endsWith('.sh'))) writeFileSync(join(directory, name), readFileSync(join(source, name)));
  const path = join(directory, 'find-incremental.mjs'), text = readFileSync(path, 'utf8');
  const before = '!record.directory || result.pruned ||';
  assert.equal(text.split(before).length, 2, 'semantic mutant must affect the real prune-descent condition once');
  const argv = ['tree', '-maxdepth', '8', '-prune', '-print0'];
  const expected = run('/usr/bin/find', argv, f.cwd, { env: f.env });
  const root = join(f.cwd, 'tree'), mtime = lstatSync(root).mtime;
  utimesSync(root, 946684800, mtime);
  exact(run(process.execPath, [join(directory, 'find-wrapper.mjs'), ...argv], f.cwd, { env: f.env }), expected);
  assert.equal(lstatSync(root, { bigint: true }).atimeNs, 946684800000000000n);
  writeFileSync(path, text.replace(before, '!record.directory || false ||'));
  utimesSync(root, 946684800, mtime);
  const actual = run(process.execPath, [join(directory, 'find-wrapper.mjs'), ...argv], f.cwd, { env: f.env });
  assert.equal(actual.stderr.length, 0, 'syntax/dependency failures do not count as semantic rejection');
  assert.equal(actual.status, 0);
  assert.notDeepEqual(actual.stdout, expected.stdout, 'GNU must reject accidental descent through a pruned root');
  assert.ok(lstatSync(root, { bigint: true }).atimeNs > 946684800000000000n, 'mutant must actually open the pruned directory');
  t.diagnostic(JSON.stringify({ campaign: 'incremental-prune-semantic-mutant', actualGNUComparisons: 1,
    negativeControlExecutions: 1, semanticNegativeControlRejected: true }));
});

test('incremental GNU output honors paused consumers while preserving every byte', async (t) => {
  const f = incrementalFixture(t); const argv = ['tree', '-maxdepth', '8', '-false', '-a', '-quit', '-o', '-printf', 'x'.repeat(8000) + '\n'];
  const expected = run('/usr/bin/find', argv, f.cwd, { env: f.env });
  assert.equal(expected.status, 0); assert.ok(expected.stdout.length > 256 * 1024);
  const child = spawn(PUBLIC, argv, { cwd: f.cwd, env: f.env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const errors = [], output = []; child.stdout.pause(); child.stderr.on('data', (chunk) => errors.push(chunk));
  const guard = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 15000);
  t.after(() => { clearTimeout(guard); if (child.exitCode === null) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} } });
  child.stdout.read(0);
  await waitFor(() => child.stdout.readableLength > 0 && f.calls().some((args) => args.includes('--max-depth')));
  await delay(250); assert.equal(child.exitCode, null, 'GNU broker remains blocked while the owned sink is paused');
  child.stdout.on('data', (chunk) => output.push(chunk)); child.stdout.resume();
  const result = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (status, signal) => resolve({ status, signal })); });
  clearTimeout(guard); assert.equal(result.signal, null);
  exact({ status: result.status, stdout: Buffer.concat(output), stderr: Buffer.concat(errors) }, expected);
  t.diagnostic(JSON.stringify({ campaign: 'incremental-paused-output', actualGNUComparisons: 1,
    actualImmediateFdInvocations: f.calls().filter((args) => args.includes('--max-depth')).length,
    exactOutputBytes: expected.stdout.length, pausedMilliseconds: 250 }));
});

test('incremental paused-output cancellation exits promptly and removes owned FIFO and PTY state', async (t) => {
  const f = incrementalFixture(t), temporary = join(f.cwd, 'private-temporary'); mkdirSync(temporary, { mode: 0o700 });
  const argv = ['tree', '-maxdepth', '8', '-false', '-a', '-quit', '-o', '-printf', 'x'.repeat(8000) + '\n'];
  for (const route of ['public', 'private-wrapper']) for (const [signal, expectedStatus] of [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129]]) {
    const environment = { ...f.env, TMPDIR: temporary };
    const command = route === 'public' ? [PUBLIC, argv] : [process.execPath, [fileURLToPath(new URL('../src/find-wrapper.mjs', import.meta.url)), ...argv]];
    const child = spawn(command[0], command[1], { cwd: f.cwd, env: environment, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const errors = []; child.stdout.pause(); child.stderr.on('data', (chunk) => errors.push(chunk));
    const guard = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 10000);
    t.after(() => { clearTimeout(guard); if (child.exitCode === null) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} } });
    child.stdout.read(0);
    await waitFor(() => child.stdout.readableLength > 0 && readdirSync(temporary).some((name) => name.startsWith('find2fd-incremental-')));
    const exited = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (status, terminationSignal) => resolve({ status, terminationSignal })); });
    t.diagnostic(`owned paused-output cancellation: ${route} ${signal}`);
    child.kill(signal);
    const result = await exited; clearTimeout(guard);
    assert.equal(result.terminationSignal, null, `${route} ${signal} must exit before the guard`); assert.equal(result.status, expectedStatus, `${route} ${signal}`);
    assert.equal(Buffer.concat(errors).length, 0, 'cancellation must not invent protocol diagnostics');
    assert.deepEqual(readdirSync(temporary), [], 'owned FIFO/PTY directory must be removed before CLI exit');
    const closed = new Promise((resolve) => child.once('close', resolve)); child.stdout.resume(); await closed;
  }
  t.diagnostic(JSON.stringify({ campaign: 'incremental-paused-cancellation', CLIEntryRoutes: 2,
    entryRoutes: ['public-Bash-dispatcher', 'private-Node-dispatcher'],
    actualImmediateFdInvocations: f.calls().filter((args) => args.includes('--max-depth')).length,
    handledSignalInvocations: 6, expectedExitStatuses: [130, 143, 129], ownedPrivateDirectoriesRemoved: 6 }));
});

test('private Bash group cancellation and PID-only interrupt match an independent Bash GNU baseline', async (t) => {
  const f = incrementalFixture(t), temporary = join(f.cwd, 'bash-private-temporary'); mkdirSync(temporary, { mode: 0o700 });
  const argv = ['tree', '-maxdepth', '8', '-false', '-a', '-quit', '-o', '-printf', 'x'.repeat(8000) + '\n'];
  const complete = run('/usr/bin/find', argv, f.cwd, { env: f.env });
  const observed = async (wrapped, signal, pidOnly = false) => {
    const command = wrapped ? withFindWrapper({ command: 'find "$@"' }, '/usr/bin/bash').command
      : 'find() { command /usr/bin/find "$@"; }; find "$@"';
    const child = spawn('/usr/bin/bash', ['--noprofile', '--norc', '-c', command, 'owned-find-bash-cancel', ...argv], {
      cwd: f.cwd, env: { ...f.env, TMPDIR: temporary }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const errors = [], output = []; child.stdout.on('data', (chunk) => output.push(chunk)); child.stdout.pause(); child.stdout.read(0); child.stderr.on('data', (chunk) => errors.push(chunk));
    const exit = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (status, terminationSignal) => resolve({ status, terminationSignal })); });
    const closed = new Promise((resolve) => child.once('close', resolve));
    const guard = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 10000);
    try {
      await waitFor(() => child.stdout.readableLength > 0 && (!wrapped || readdirSync(temporary).some((name) => name.startsWith('find2fd-incremental-'))));
      if (pidOnly) {
        child.kill('SIGINT'); await delay(200);
        assert.equal(child.exitCode, null, 'PID-only outer Bash SIGINT leaves its blocked foreground child active');
        assert.equal(child.signalCode, null);
      }
      process.kill(-child.pid, signal);
      const result = await exit;
      child.stdout.resume(); await closed;
      await waitFor(() => readdirSync(temporary).length === 0, 3000);
      assert.deepEqual(Buffer.concat(errors), Buffer.alloc(0));
      const bytes = Buffer.concat(output);
      assert.ok(bytes.length > 0, 'both native and wrapped foreground children publish real bytes before cancellation');
      assert.ok(complete.stdout.subarray(0, bytes.length).equals(bytes), 'cancelled output is an exact prefix of independent complete GNU output');
      return result;
    } finally { clearTimeout(guard); if (child.exitCode === null && child.signalCode === null) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} } }
  };
  const observations = [], shellStatus = (result) => result.status ?? 128 + osConstants.signals[result.terminationSignal];
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    const actual = await observed(true, signal), expected = await observed(false, signal);
    assert.equal(shellStatus(actual), shellStatus(expected), `${signal}: independent private Bash shell exit status`);
    observations.push({ signal, actual, expected, shellStatus: shellStatus(actual) });
  }
  const actual = await observed(true, 'SIGTERM', true), expected = await observed(false, 'SIGTERM', true);
  assert.equal(shellStatus(actual), shellStatus(expected), 'PID-only Bash interrupt preserves native non-forwarding behavior');
  t.diagnostic(JSON.stringify({ campaign: 'incremental-private-Bash-cancellation', actualGNUCompleteOutputComparisons: 1,
    actualGNUGroupCancellationBaselines: 3, privateBashGroupCancellationInvocations: 3,
    actualImmediateFdInvocations: f.calls().filter((args) => args.includes('--max-depth')).length,
    groupTerminationObservations: observations,
    PIDOnlyOuterBashInterruptBaselines: 1, PIDOnlyOuterBashInterruptWrapperInvocations: 1,
    cancellationOutputAssertion: 'exact prefix of independent full GNU output; partial byte counts depend on scheduling' }));
});
