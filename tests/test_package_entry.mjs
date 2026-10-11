// GNU find is the independent oracle; exercise the real public Bash executable.
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { exact, fixture, ROOT, run } from './helpers.mjs';
const root = resolve(process.env.FIND2FD_TEST_PACKAGE_ROOT ?? ROOT);
const cli = process.env.FIND2FD_TEST_ENTRY_BIN ?? join(root, 'bin/find2fd');
const prefixCli = process.env.FIND2FD_TEST_PREFIX_BIN ?? join(root, 'bin/find2fd-shell-prefix.mjs');
const bash = (command, current) => run('/usr/bin/bash', ['--noprofile', '--norc', '-c', command], current.cwd, { env: current.env });
function prefix(program, current) {
  const result = run(program, [], current.cwd, { env: current.env });
  assert.equal(result.status, 0); assert.equal(result.stderr.length, 0); return result.stdout.toString();
}
test('installed find2fd preserves GNU arguments, exact output/status, stdin and native expression behavior', (t) => {
  const current = fixture(t);
  const cases = [[], ['tree'], ['tree', '-print0'], ['tree', '-name', '*.txt'], ['tree', '-type', 'd'], ['tree', '-maxdepth', '0'], ['tree/empty'], ['tree', 'tree', '-name', 'foo.txt'], ['tree/z-dir', 'tree', '-print0'], ['tree', '-name', 'missing'], ['tree/foo.txt'], ['missing', 'tree/foo.txt', '-print0'], ['tree', '-name', 'foo.txt', '-o', '-name', 'Foo.txt', '-print0'], ['tree', '(', '-name', 'foo.txt', '-o', '-name', 'Foo.txt', ')', '-print0'], ['tree', '-prune'], ['tree', '-quit'], ['tree', '-printf', '%p:%f\n'], ['-files0-from', '-', '-print0'], ['--help'], ['--version'], ['--invalid-wrapper-option'], ['tree', '-name']];
  for (const argv of cases) {
    const extras = { env: current.env, input: Buffer.from('tree/foo.txt\0tree/Foo.txt\0') };
    exact(run(cli, argv, current.cwd, extras), run('/usr/bin/find', argv, current.cwd, extras), JSON.stringify(argv));
  }
  t.diagnostic(JSON.stringify({ campaign: 'package-entry', actualGNUComparisons: cases.length, executable: cli, actualFdInvocations: current.actualSearchCalls() }));
});
test('shell-prefix executable adapts only private bare find and preserves native bypasses, children and outside shells', (t) => {
  const current = fixture(t), helper = prefix(prefixCli, current);
  assert.equal(current.actualSearchCalls(), 0, 'printing the prefix has no search side effect');
  const result = bash(helper + "type -t find; printf 'ignored\\n' | find tree -name foo.txt; (find tree -name foo.txt); for path in tree; do find \"$path\" -name foo.txt; done", current);
  assert.equal(result.status, 0); assert.equal(result.stderr.length, 0);
  assert.deepEqual(result.stdout, Buffer.from('function\ntree/foo.txt\ntree/foo.txt\ntree/foo.txt\n'));
  assert.equal(current.actualSearchCalls(), 3);
  const command = "command find tree -name foo.txt; /usr/bin/find tree -name foo.txt; bash -c 'type -t find; find tree -name foo.txt'; export -pf | /usr/bin/grep '^declare -fx find' || :; printenv | /usr/bin/grep '^BASH_FUNC_find%%=' || :";
  exact(bash(helper + command, current), bash(command, current), 'native bypasses and children');
  assert.deepEqual(bash('type -t find; find tree -name foo.txt', current).stdout, Buffer.from('file\ntree/foo.txt\n'));
  assert.equal(current.actualSearchCalls(), 3);
  const invalid = run(prefixCli, ['unexpected'], current.cwd); assert.equal(invalid.status, 2); assert.equal(invalid.stdout.length, 0); assert.match(invalid.stderr.toString(), /^Usage: find2fd-shell-prefix\n$/);
  t.diagnostic(JSON.stringify({ campaign: 'package-prefix', actualFdInvocations: 3, nativeScopeComparisons: 1 }));
});
test('shell-prefix and public launcher safely handle metacharacter paths and installation symlink chains', (t) => {
  const current = fixture(t), marker = join(current.cwd, 'should-never-exist');
  const tricky = join(current.cwd, "package ' $(touch should-never-exist) `touch should-never-exist`"); mkdirSync(tricky);
  for (const directory of ['src', 'bin']) cpSync(join(root, directory), join(tricky, directory), { recursive: true });
  const helper = prefix(join(tricky, 'bin/find2fd-shell-prefix.mjs'), current);
  exact(bash(helper + 'find tree -name foo.txt', current), run('/usr/bin/find', ['tree', '-name', 'foo.txt'], current.cwd), 'quoted prefix path');
  const linked = join(current.cwd, 'first link'), chained = join(current.cwd, 'second link'); symlinkSync(cli, linked); symlinkSync(linked, chained);
  for (const program of [chained, join(tricky, 'bin/find2fd')]) exact(run(program, ['tree', '-name', 'foo.txt'], current.cwd), run('/usr/bin/find', ['tree', '-name', 'foo.txt'], current.cwd), 'public launcher path');
  assert.equal(existsSync(marker), false, 'shell substitutions in paths are never executed');
});
test('public launcher retains valid Unicode and invalid UTF-8 argv without Node decoding', (t) => {
  const current = fixture(t), rawName = Buffer.from([0xff, 0xfe, ...Buffer.from('.txt')]);
  const rawBin = join(current.cwd, 'raw-bin'); mkdirSync(rawBin);
  // Keep the fd recorder, but invoke real native GNU directly: a Node-based
  // native recorder would itself destroy the raw argv bytes under test.
  for (const name of ['fd', 'fdfind']) cpSync(join(current.bin, name), join(rawBin, name));
  const rawEnv = { ...current.env, PATH: `${rawBin}:${process.env.PATH ?? ''}` };
  writeFileSync(Buffer.concat([Buffer.from(current.cwd + '/tree/'), rawName]), 'raw name\n'); current.put('tree/π.txt');
  const cases = [[Buffer.from('tree'), Buffer.from('-name'), rawName, Buffer.from('-print0')], [Buffer.concat([Buffer.from('tree/'), rawName]), Buffer.from('-print0')], [Buffer.from('tree'), Buffer.from('-name'), Buffer.from('π.txt'), Buffer.from('-print0')], [Buffer.from('tree/π.txt'), Buffer.from('-print0')]].map((argv) => argv.map((bytes) => bytes.toString('hex')));
  const script = `import base64,json,os,subprocess,sys
output=[]
for encoded in json.loads(sys.argv[2]):
    args=[bytes.fromhex(value) for value in encoded]
    actual=subprocess.run([os.fsencode(sys.argv[1]),*args],capture_output=True)
    expected=subprocess.run([b'find',*args],executable=b'/usr/bin/find',capture_output=True)
    pack=lambda result:[result.returncode,base64.b64encode(result.stdout).decode(),base64.b64encode(result.stderr).decode()]
    output.append({'actual':pack(actual),'expected':pack(expected)})
print(json.dumps(output))
`;
  const result = run('python3', ['-c', script, cli, JSON.stringify(cases)], current.cwd, { env: rawEnv }); assert.equal(result.status, 0, result.stderr.toString());
  const comparisons = JSON.parse(result.stdout); assert.equal(comparisons.length, cases.length);
  for (const [index, comparison] of comparisons.entries()) assert.deepEqual(comparison.actual, comparison.expected, `raw argv case ${index}`);
  assert.equal(current.actualSearchCalls(), 0, 'non-ASCII argv stay native before Node');
  t.diagnostic(JSON.stringify({ campaign: 'package-argv-bytes', actualGNUComparisons: comparisons.length, argvSource: 'Python byte argv to real executable' }));
});

test('invalid UTF-8 working directories remain inherited for public, private and native fallback calls', (t) => {
  const current = fixture(t);
  const helper = prefix(prefixCli, current);
  const script = `import base64,json,os,subprocess,sys
owned=os.fsencode(sys.argv[1]);cwd=owned+b'/raw-cwd-'+bytes([255]);os.mkdir(cwd);os.mkdir(cwd+b'/tree');open(cwd+b'/tree/foo.txt','wb').write(b'synthetic\\n')
pack=lambda result:[result.returncode,base64.b64encode(result.stdout).decode(),base64.b64encode(result.stderr).decode()]
output=[]
for args in [[b'tree',b'-name',b'foo.txt',b'-print0'],[b'tree',b'-name',b'foo.txt',b'-o',b'-print0']]:
    expected=subprocess.run([b'find',*args],executable=b'/usr/bin/find',cwd=cwd,capture_output=True)
    actual=subprocess.run([os.fsencode(sys.argv[2]),*args],cwd=cwd,capture_output=True)
    output.append({'actual':pack(actual),'expected':pack(expected)})
command=sys.argv[3]+'find tree -name foo.txt -print0'
actual=subprocess.run(['/usr/bin/bash','--noprofile','--norc','-c',command],cwd=cwd,capture_output=True)
expected=subprocess.run([b'find',b'tree',b'-name',b'foo.txt',b'-print0'],executable=b'/usr/bin/find',cwd=cwd,capture_output=True)
output.append({'actual':pack(actual),'expected':pack(expected)})
print(json.dumps(output))
`;
  const result = run('python3', ['-c', script, current.cwd, cli, helper], current.cwd, { env: current.env }); assert.equal(result.status, 0, result.stderr.toString());
  const comparisons = JSON.parse(result.stdout); assert.equal(comparisons.length, 3);
  for (const comparison of comparisons) assert.deepEqual(comparison.actual, comparison.expected, 'inherited raw cwd');
  t.diagnostic(JSON.stringify({ campaign: 'package-cwd-bytes', actualGNUComparisons: comparisons.length, cwdSource: 'Python byte cwd to real executable and private prefix' }));
});
