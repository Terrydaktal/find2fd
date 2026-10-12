import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const INTERNAL = join(ROOT, 'bin/find2fd.mjs');
export const PUBLIC = join(ROOT, 'bin/find2fd');
export const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
// Semantic engine campaigns opt in explicitly. Separate default-policy tests
// delete or replace this flag and require original GNU with no fd/helper work.
export const ENV = { ...process.env, FIND2FD_EXPERIMENTAL_FD: '1', LC_ALL: 'C', LANG: 'C', TERM: 'xterm', NO_COLOR: '1' };
delete ENV.POSIXLY_CORRECT;
export function run(program, argv, cwd, { input, env = ENV, timeout = 10000 } = {}) {
  const result = spawnSync(program, argv, { cwd, env, input, timeout, maxBuffer: 4 * 1024 * 1024, argv0: program === '/usr/bin/find' ? 'find' : undefined });
  assert.equal(result.error, undefined, `${program}: ${result.error?.message}`);
  assert.equal(result.signal, null, `${program}: ${result.signal}`);
  return result;
}
export function exact(actual, expected, label = '') {
  assert.equal(actual.status, expected.status, `${label}: status`);
  assert.deepEqual(actual.stdout, expected.stdout, `${label}: stdout`);
  assert.deepEqual(actual.stderr, expected.stderr, `${label}: stderr`);
}
export function compare(argv, current, extras = {}) {
  const expected = run('/usr/bin/find', argv, current.cwd, extras);
  const actual = run(process.execPath, [INTERNAL, ...argv], current.cwd, extras);
  exact(actual, expected, JSON.stringify(argv));
  return actual;
}
export function engine() {
  for (const program of ['fd', 'fdfind']) {
    const found = spawnSync('/usr/bin/bash', ['--noprofile', '--norc', '-c', `command -v ${program}`], { encoding: 'utf8', env: ENV });
    if (found.status === 0) return found.stdout.trim();
  }
  throw new Error('Verification requires fd or fdfind in PATH; GNU fallback alone receives no acceleration credit.');
}
export function fixture(t, { rawNames = false, cycle = false } = {}) {
  const cwd = mkdtempSync(join(tmpdir(), 'find2fd-fixture-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const put = (name, bytes = 'synthetic\n') => writeFileSync(join(cwd, name), bytes);
  for (const directory of ['tree', 'tree/z-dir', 'tree/z-dir/deep', 'tree/a-dir', 'tree/.hidden-dir', 'tree/.git', 'tree/empty']) mkdirSync(join(cwd, directory));
  for (const name of ['tree/z-last.txt', 'tree/a-first.txt', 'tree/foo.txt', 'tree/Foo.txt', 'tree/z-dir/target.txt', 'tree/z-dir/deep/target.txt', 'tree/a-dir/target.txt', 'tree/.hidden.txt', 'tree/.hidden-dir/target.txt', 'tree/.git/inside.txt', 'tree/ignored.txt', 'tree/fdignored.txt', 'tree/space name.txt', "tree/apostrophe's.txt", 'tree/line\nbreak.txt', 'tree/-hyphen.txt', 'tree/literal[1].txt', 'tree/literal*.txt']) put(name);
  put('tree/.gitignore', 'ignored.txt\n'); put('tree/.fdignore', 'fdignored.txt\n'); put('tree/.ignore', 'also-ignored\n'); put('tree/also-ignored');
  symlinkSync('z-dir', join(cwd, 'tree/linkdir')); symlinkSync('foo.txt', join(cwd, 'tree/linkfile')); symlinkSync('missing', join(cwd, 'tree/dangling'));
  if (cycle) symlinkSync('..', join(cwd, 'tree/z-dir/cycle'));
  if (rawNames) { put('tree/π.txt'); writeFileSync(Buffer.concat([Buffer.from(cwd + '/tree/'), Buffer.from([0xff, 0xfe]), Buffer.from('.txt')]), 'raw name\n'); }
  assert.equal(spawnSync('mkfifo', [join(cwd, 'tree/pipe')]).status, 0);
  assert.equal(spawnSync('python3', ['-c', 'import socket,sys;peer=socket.socket(socket.AF_UNIX);peer.bind(sys.argv[1])', join(cwd, 'tree/socket')]).status, 0);
  const bin = join(cwd, 'bin'), trace = join(cwd, 'fd-calls.jsonl'), nativeTrace = join(cwd, 'find-calls.jsonl'); mkdirSync(bin);
  writeFileSync(trace, '');
  writeFileSync(nativeTrace, '');
  const executable = engine();
  const recorder = `#!${process.execPath}\nconst fs=require('node:fs');const {spawnSync}=require('node:child_process');const argv=process.argv.slice(2);fs.appendFileSync(process.env.FIND2FD_TRACE,JSON.stringify(argv)+'\\n');const result=spawnSync(${JSON.stringify(executable)},argv,{stdio:'inherit'});process.exitCode=result.status??1;\n`;
  for (const name of ['fd', 'fdfind']) writeFileSync(join(bin, name), recorder, { mode: 0o700 });
  const nativeRecorder = `#!/usr/bin/env bash\n${quote(process.execPath)} -e 'const fs=require("node:fs");fs.appendFileSync(process.env.FIND2FD_NATIVE_TRACE,JSON.stringify(process.argv.slice(1))+"\\n");' -- "$@"\nexec -a find /usr/bin/find "$@"\n`;
  writeFileSync(join(bin, 'find'), nativeRecorder, { mode: 0o700 });
  const env = { ...ENV, PATH: `${bin}:${process.env.PATH ?? ''}`, FIND2FD_TRACE: trace, FIND2FD_NATIVE_TRACE: nativeTrace };
  const calls = () => existsSync(trace) ? readFileSync(trace, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)) : [];
  const nativeCalls = () => readFileSync(nativeTrace, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
  return { cwd, put, bin, trace, env, calls, nativeCalls, actualSearchCalls: () => calls().filter((argv) => !argv.some((arg) => arg === '--version' || arg === '--help')).length };
}
export const digest = (value) => ({ bytes: value.length, sha256: createHash('sha256').update(value).digest('hex'), leadingHex: value.subarray(0, 96).toString('hex') });
