import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { compare, engine, ENV, exact, fixture, INTERNAL, quote, ROOT, run } from './helpers.mjs';
import { withFindWrapper } from '../src/find-wrapper.mjs';

function peer(current, code) {
  const program = `#!${process.execPath}\nrequire('node:fs').appendFileSync(process.env.FIND2FD_TRACE,JSON.stringify(process.argv.slice(2))+'\\n');\n${code}\n`;
  for (const name of ['fd', 'fdfind']) writeFileSync(join(current.bin, name), program, { mode: 0o700 });
}
const faults = [
  ['partial stdout plus nonzero status', 'process.stdout.write(candidate+"\\0");process.exitCode=1;'],
  ['stderr after candidate output', 'process.stdout.write(candidate+"\\0");process.stderr.write("synthetic fd warning\\n");'],
  ['unterminated final record', 'process.stdout.write(candidate);'],
  ['empty record', 'process.stdout.write("\\0");'],
  ['duplicate candidate', 'process.stdout.write(candidate+"\\0"+candidate+"\\0");'],
  ['relative path', 'process.stdout.write("tree/foo.txt\\0");'],
  ['outside-root candidate', 'process.stdout.write(process.cwd()+"/outside-root\\0");'],
  ['candidate cap', 'process.stdout.write((candidate+"\\0").repeat(100001));'],
  ['byte cap', 'process.stdout.write(Buffer.alloc(33*1024*1024,97));'],
];
for (const [label, code] of faults) test(`fd ${label} falls back before publishing any candidate bytes`, (t) => {
  const current = fixture(t); current.put('outside-root', 'synthetic\n');
  peer(current, `const candidate=${JSON.stringify(join(current.cwd, 'tree/foo.txt'))};${code}`);
  compare(['tree', '-print0'], current, { env: current.env, timeout: 15000 });
  assert.equal(current.actualSearchCalls(), 1, 'fault was exercised through the actual fd subprocess');
});
test('fragmented valid NUL records retain exact GNU output', (t) => {
  const current = fixture(t), value = join(current.cwd, 'tree/foo.txt') + '\0';
  peer(current, `const value=Buffer.from(${JSON.stringify(value)});let index=0;const emit=()=>{if(index===value.length)return;process.stdout.write(value.subarray(index,index+1));index++;setImmediate(emit);};emit();`);
  compare(['tree', '-name', 'foo.txt', '-print0'], current, { env: current.env });
  assert.equal(current.actualSearchCalls(), 1);
});
test('missing fd retains the original GNU invocation and filesystem errors', (t) => {
  const current = fixture(t), empty = join(current.cwd, 'no-fd'); mkdirSync(empty);
  symlinkSync('/usr/bin/find', join(empty, 'find'));
  for (const argv of [['tree', '-name', '*.txt'], ['missing', 'tree/foo.txt', '-print0']]) compare(argv, current, { env: { ...ENV, PATH: empty } });
});
test('a fdfind-only PATH accelerates eligible calls while existing fd failures never retry another engine', (t) => {
  const current = fixture(t), aliases = join(current.cwd, 'fdfind-only'); mkdirSync(aliases);
  symlinkSync('/usr/bin/find', join(aliases, 'find'));
  writeFileSync(join(aliases, 'fdfind'), `#!${process.execPath}\nrequire('node:fs').appendFileSync(process.env.FIND2FD_TRACE,JSON.stringify(process.argv.slice(2))+'\\n');const result=require('node:child_process').spawnSync(${JSON.stringify(engine())},process.argv.slice(2),{stdio:'inherit'});process.exitCode=result.status??1;\n`, { mode: 0o700 });
  compare(['tree', '-name', 'foo.txt'], current, { env: { ...current.env, PATH: aliases } });
  assert.equal(current.actualSearchCalls(), 1, 'the alternative binary actually executes');
  writeFileSync(join(aliases, 'fd'), `#!${process.execPath}\nprocess.stderr.write('synthetic unsupported fd\\n');process.exitCode=1;\n`, { mode: 0o700 });
  compare(['tree', '-name', 'foo.txt'], current, { env: { ...current.env, PATH: aliases } });
  assert.equal(current.actualSearchCalls(), 1, 'an existing failed fd gets GNU fallback, without fdfind retry');
});
test('large directory ordering falls back before output instead of losing GNU FTS order', (t) => {
  const current = fixture(t); mkdirSync(join(current.cwd, 'wide'));
  for (let index = 0; index < 10001; index++) current.put(`wide/${String(index).padStart(5, '0')}`, '');
  compare(['wide', '-print0'], current, { env: current.env, timeout: 15000 });
  assert.ok(current.actualSearchCalls() > 0, 'the candidate/order boundary is exercised');
});
test('TTY -print follows native GNU quoting while ordinary pipes retain raw bytes', (t) => {
  const current = fixture(t);
  const script = `import base64,json,os,pty,select,subprocess,sys,termios,time
+def invoke(argv):
+    master,slave=pty.openpty(); attrs=termios.tcgetattr(slave);attrs[1]&=~termios.OPOST;termios.tcsetattr(slave,termios.TCSANOW,attrs)
+    child=subprocess.Popen(argv,stdout=slave,stderr=subprocess.PIPE);os.close(slave);output=b'';deadline=time.monotonic()+8
+    while time.monotonic()<deadline:
+        ready,_,_=select.select([master],[],[],0.1)
+        if ready:
+            try: block=os.read(master,65536)
+            except OSError: break
+            if not block: break
+            output+=block
+        elif child.poll() is not None: break
+    if child.poll() is None:child.kill()
+    status=child.wait();error=child.stderr.read();os.close(master);return [status,base64.b64encode(output).decode(),base64.b64encode(error).decode()]
+print(json.dumps([invoke(json.loads(sys.argv[1])),invoke(json.loads(sys.argv[2]))]))
+`.replaceAll('\n+', '\n');
  const argv = ['tree', '-name', 'space*'];
  const result = run('python3', ['-c', script, JSON.stringify(['/usr/bin/find', ...argv]), JSON.stringify([process.execPath, INTERNAL, ...argv])], current.cwd);
  assert.equal(result.status, 0, result.stderr.toString());
  const [expected, actual] = JSON.parse(result.stdout); assert.deepEqual(actual, expected);
});
test('a broken output pipe terminates the owned adapter without hanging', async (t) => {
  const current = fixture(t);
  const child = spawn(process.execPath, [INTERNAL, 'tree', '-print0'], { cwd: current.cwd, env: current.env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.destroy(); let stderr = ''; child.stderr.on('data', (data) => { stderr += data; });
  const deadline = setTimeout(() => child.kill('SIGKILL'), 5000);
  const outcome = await new Promise((done) => child.once('close', (status, signal) => done({ status, signal })));
  clearTimeout(deadline); assert.notEqual(outcome.signal, 'SIGKILL', 'a closed consumer must not hang');
  assert.notEqual(outcome.status, 0, 'failed output must not receive success status');
  assert.doesNotMatch(stderr, /Unhandled|MaxListenersExceededWarning/);
});
test('test-only mutations prove root/order/fallback assertions detect semantic failures', (t) => {
  const current = fixture(t), original = readFileSync(INTERNAL, 'utf8');
  const directory = join(current.cwd, 'mutated-package'); mkdirSync(directory);
  cpSync(join(ROOT, 'src'), join(directory, 'src'), { recursive: true }); mkdirSync(join(directory, 'bin'));
  const entry = join(directory, 'bin/find2fd.mjs');
  const mutants = [
    ['root omission', "const write=process.stdout.write.bind(process.stdout);let first=true;process.stdout.write=(value,...rest)=>{if(first){first=false;const bytes=Buffer.from(value);const cut=bytes.indexOf(0);if(cut>=0)return write(bytes.subarray(cut+1),...rest);}return write(value,...rest);};\n", ['tree', '-print0']],
    ['order reversal', "const write=process.stdout.write.bind(process.stdout);process.stdout.write=(value,...rest)=>{const bytes=Buffer.from(value);if(bytes.includes(0)){const records=bytes.toString().split('\\0');records.pop();return write(records.reverse().join('\\0')+'\\0',...rest);}return write(value,...rest);};\n", ['tree', '-print0']],
    ['fallback argv corruption', "const pattern=process.argv.indexOf('-name');process.argv[pattern+1]='*';\n", ['tree', '-name', 'foo.txt', '-o', '-print0']],
  ];
  for (const [name, injection, argv] of mutants) {
    writeFileSync(entry, original); const expected = run('/usr/bin/find', argv, current.cwd); exact(run(process.execPath, [entry, ...argv], current.cwd), expected, `negative control ${name}`);
    const code = original.startsWith('#!') ? original.slice(original.indexOf('\n') + 1) : original;
    writeFileSync(entry, injection + code);
    const altered = run(process.execPath, [entry, ...argv], current.cwd);
    assert.equal(altered.stderr.length, 0, `${name}: syntax/infrastructure errors receive no mutation credit`);
    assert.ok(altered.status !== expected.status || !altered.stdout.equals(expected.stdout), `${name}: semantic oracle must reject mutation`);
  }
  t.diagnostic(JSON.stringify({ campaign: 'mutations', rejectedSemanticMutants: mutants.length, cleanNegativeControls: mutants.length }));
});

function processAlive(pid) {
  try { const state = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ')[0]; return state !== 'Z' && state !== 'X'; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
async function waitFor(predicate, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) { assert.ok(Date.now() < deadline, 'owned child condition deadline'); await new Promise((done) => setTimeout(done, 10)); }
}
const hangingChild = `const fs=require('node:fs');const helper=require('node:child_process').spawn('/usr/bin/sleep',['60'],{stdio:'ignore'});fs.writeFileSync(process.env.FIND2FD_PID_FILE,JSON.stringify({tool:process.pid,helper:helper.pid}));setInterval(()=>{},1000);`;
const stubbornChild = `process.on('SIGTERM',()=>{});require('node:fs').writeFileSync(process.env.FIND2FD_HELPER_READY,'ready');setInterval(()=>{},1000);`;
function stubbornLeader(warning = false) {
  return `const fs=require('node:fs');const helper=require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(stubbornChild)}],{stdio:'ignore'});const ready=setInterval(()=>{if(!fs.existsSync(process.env.FIND2FD_HELPER_READY))return;clearInterval(ready);fs.writeFileSync(process.env.FIND2FD_PID_FILE,JSON.stringify({tool:process.pid,helper:helper.pid}));${warning ? "process.stderr.write('synthetic fd warning\\n',()=>process.exit(0));" : ''}},5);setInterval(()=>{},1000);`;
}
for (const warning of [false, true]) test(`stubborn fd helper is gone before ${warning ? 'stderr fallback publishes GNU output' : 'SIGTERM cancellation returns'}`, { timeout: 10000 }, async (t) => {
  const current = fixture(t), pidFile = join(current.cwd, 'stubborn-pids.json'); peer(current, stubbornLeader(warning));
  const env = { ...current.env, FIND2FD_PID_FILE: pidFile, FIND2FD_HELPER_READY: join(current.cwd, 'helper-ready') };
  const argv = ['tree', '-name', 'foo.txt'], expected = run('/usr/bin/find', argv, current.cwd, { env });
  const child = spawn(process.execPath, [INTERNAL, ...argv], { cwd: current.cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const output = [], errors = []; child.stdout.on('data', (bytes) => output.push(bytes)); child.stderr.on('data', (bytes) => errors.push(bytes));
  const outcome = new Promise((done) => child.once('close', (status, signal) => done({ status, signal, stdout: Buffer.concat(output), stderr: Buffer.concat(errors) })));
  const guard = setTimeout(() => child.kill('SIGKILL'), 8000); let owned;
  t.after(() => { clearTimeout(guard); if (owned) for (const pid of Object.values(owned)) if (processAlive(pid)) { try { process.kill(pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; } } });
  await waitFor(() => { try { owned = JSON.parse(readFileSync(pidFile, 'utf8')); return true; } catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return false; throw error; } });
  if (!warning) child.kill('SIGTERM');
  const actual = await outcome; clearTimeout(guard);
  assert.equal(actual.signal, null);
  if (warning) exact(actual, expected, 'stubborn helper fallback');
  else { assert.equal(actual.status, 143); assert.equal(actual.stdout.length, 0); assert.equal(actual.stderr.length, 0); }
  await waitFor(() => !processAlive(owned.tool) && !processAlive(owned.helper), 350);
});
test('a cleanup-timer mutation reproduces the helper leak and the clean copied package rejects it', { timeout: 10000 }, async (t) => {
  const current = fixture(t), copy = join(current.cwd, 'cleanup-package'); mkdirSync(copy);
  cpSync(join(ROOT, 'src'), join(copy, 'src'), { recursive: true }); mkdirSync(join(copy, 'bin'));
  const entry = join(copy, 'bin/find2fd.mjs'); cpSync(INTERNAL, entry);
  const path = join(copy, 'src/find-runtime.mjs'), source = readFileSync(path, 'utf8');
  const start = source.indexOf('function captureFd('), end = source.indexOf('function writeOutput(', start);
  assert.ok(start >= 0 && end > start);
  const original = source.slice(start, end);
  const changes = [
    ['missing = false, cleanup;', 'missing = false, cleanup, mutantKillTimer;'],
    ['cleanup = new Promise((resolveCleanup) => setTimeout(() => {', 'cleanup = new Promise((resolveCleanup) => { mutantKillTimer = setTimeout(() => {'],
    ['}, 250));', '}, 250); });'],
    ['if (cleanup) await cleanup;', 'clearTimeout(mutantKillTimer);'],
  ];
  let mutant = original;
  for (const [before, after] of changes) { assert.equal(mutant.split(before).length, 2, `unambiguous semantic mutation: ${before}`); mutant = mutant.replace(before, after); }
  for (const altered of [false, true]) {
    writeFileSync(path, altered ? source.slice(0, start) + mutant + source.slice(end) : source);
    const ownedFixture = fixture(t), pidFile = join(ownedFixture.cwd, 'mutation-pids.json'); peer(ownedFixture, stubbornLeader());
    const env = { ...ownedFixture.env, FIND2FD_PID_FILE: pidFile, FIND2FD_HELPER_READY: join(ownedFixture.cwd, 'helper-ready') };
    const child = spawn(process.execPath, [entry, 'tree', '-name', 'foo.txt'], { cwd: ownedFixture.cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const errors = []; child.stderr.on('data', (bytes) => errors.push(bytes)); child.stdout.resume();
    const outcome = new Promise((done) => child.once('close', (status, signal) => done({ status, signal })));
    let owned; const guard = setTimeout(() => child.kill('SIGKILL'), 7000);
    t.after(() => { clearTimeout(guard); if (owned) for (const pid of Object.values(owned)) if (processAlive(pid)) { try { process.kill(pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; } } });
    await waitFor(() => { try { owned = JSON.parse(readFileSync(pidFile, 'utf8')); return true; } catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return false; throw error; } });
    child.kill('SIGTERM'); const actual = await outcome; clearTimeout(guard);
    assert.deepEqual(actual, { status: 143, signal: null }); assert.equal(Buffer.concat(errors).length, 0, 'syntax/infrastructure failures receive no mutation credit');
    await new Promise((done) => setTimeout(done, 350));
    assert.equal(processAlive(owned.helper), altered, altered ? 'the cancelled-timer mutant must reproduce the behavioral leak' : 'clean copied source must terminate the helper');
  }
  t.diagnostic(JSON.stringify({ campaign: 'cleanup-mutation', rejectedSemanticMutants: 1, cleanNegativeControls: 1, defect: 'cancelled escalation timer leaks ignored-stdio helper' }));
});
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) for (const backend of ['fd', 'native']) test(`${signal} terminates only the owned ${backend} process group and helper descendants`, { timeout: 12000 }, async (t) => {
  const current = fixture(t), pidFile = join(current.cwd, 'owned-pids.json');
  const env = { ...current.env, FIND2FD_PID_FILE: pidFile };
  let argv;
  if (backend === 'fd') { peer(current, hangingChild); argv = ['tree', '-print0']; }
  else { env.PATH = process.env.PATH; argv = ['tree', '-maxdepth', '0', '-exec', process.execPath, '-e', hangingChild, ';']; }
  const child = spawn(process.execPath, [INTERNAL, ...argv], { cwd: current.cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const stderr = []; child.stderr.on('data', (data) => stderr.push(data));
  const outcome = new Promise((done) => child.once('close', (status, closedSignal) => done({ status, signal: closedSignal })));
  const guard = setTimeout(() => child.kill('SIGKILL'), 10000);
  let owned;
  t.after(() => { clearTimeout(guard); if (owned) for (const pid of Object.values(owned)) if (processAlive(pid)) { try { process.kill(pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; } } });
  await waitFor(() => { try { owned = JSON.parse(readFileSync(pidFile, 'utf8')); return true; } catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return false; throw error; } });
  assert.ok(processAlive(owned.helper)); child.kill(signal);
  const result = await outcome; clearTimeout(guard);
  assert.equal(result.signal, null, 'the adapter handles the signal and reports its conventional status');
  assert.equal(result.status, { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 }[signal]);
  await waitFor(() => !processAlive(owned.tool) && !processAlive(owned.helper), 2000);
  assert.equal(Buffer.concat(stderr).length, 0, 'cancellation produces no unhandled runtime error');
});
test('an already running shell preserves GNU behavior after its owned cwd is removed', (t) => {
  const current = fixture(t), vanished = join(current.cwd, 'vanished');
  const prepare = 'cd vanished; /usr/bin/rmdir ../vanished; ';
  const commands = [
    prepare + `command ${quote(process.execPath)} ${quote(INTERNAL)} . -maxdepth 0`,
    withFindWrapper({ command: prepare + 'find . -maxdepth 0' }, '/usr/bin/bash').command,
  ];
  for (const command of commands) {
    mkdirSync(vanished);
    const expected = run('/usr/bin/bash', ['--noprofile', '--norc', '-c', prepare + '/usr/bin/find . -maxdepth 0'], current.cwd, { env: ENV });
    assert.equal(expected.status, 0); assert.deepEqual(expected.stdout, Buffer.from('.\n'));
    mkdirSync(vanished);
    exact(run('/usr/bin/bash', ['--noprofile', '--norc', '-c', command], current.cwd, { env: ENV }), expected, 'inherited deleted cwd');
  }
});
test('the fd deadline kills its helper group and then transparently executes native GNU', { timeout: 15000 }, async (t) => {
  const current = fixture(t), pidFile = join(current.cwd, 'timeout-pids.json'); peer(current, hangingChild);
  const env = { ...current.env, FIND2FD_PID_FILE: pidFile };
  const expected = run('/usr/bin/find', ['tree', '-name', 'foo.txt'], current.cwd, { env });
  const actual = await new Promise((done) => {
    const child = spawn(process.execPath, [INTERNAL, 'tree', '-name', 'foo.txt'], { cwd: current.cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const output = [], errors = []; child.stdout.on('data', (data) => output.push(data)); child.stderr.on('data', (data) => errors.push(data));
    const guard = setTimeout(() => child.kill('SIGKILL'), 13000);
    child.once('close', (status, signal) => { clearTimeout(guard); done({ status, signal, stdout: Buffer.concat(output), stderr: Buffer.concat(errors) }); });
  });
  const owned = JSON.parse(readFileSync(pidFile, 'utf8'));
  t.after(() => { for (const pid of Object.values(owned)) if (processAlive(pid)) { try { process.kill(pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; } } });
  exact(actual, expected, 'timeout native fallback'); assert.equal(actual.signal, null);
  await waitFor(() => !processAlive(owned.tool) && !processAlive(owned.helper), 2000);
  assert.equal(current.nativeCalls().length, 1, 'deadline fallback invokes the original GNU call once');
});
