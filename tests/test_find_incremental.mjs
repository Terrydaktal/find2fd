import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { classifyGNU, finiteDepth, incrementalFixture } from './find_incremental_helpers.mjs';
import { PUBLIC, run } from './helpers.mjs';

test('incremental root controls preserve GNU truth, implicit printing and no-descent access times', (t) => {
  const f = incrementalFixture(t), directory = join(f.cwd, 'tree');
  const old = 946684800, mtime = Number(lstatSync(directory, { bigint: true }).mtimeNs) / 1e9;
  const reset = () => utimesSync(directory, old, mtime);
  const observe = () => lstatSync(directory, { bigint: true }).atimeNs.toString();
  for (const expression of [['-prune'], ['!', '-prune'], ['-prune', '-print0'], ['-prune', '-o', '-print0'],
    ['-false', ',', '-prune'], ['-quit'], ['-print0', ',', '-quit'], ['-true', '-o', '-quit']]) {
    const noDescent = !expression.includes('-true');
    const result = f.compare(['tree', '-maxdepth', '8', ...expression], { fd: noDescent ? 'zero' : 'positive', beforeEach: reset,
      afterEach: () => noDescent ? observe() : BigInt(observe()) > 946684800000000000n });
    if (noDescent) assert.equal(observe(), '946684800000000000', 'prune/quit must not open the starting directory');
    assert.equal(result.actual.status, 0);
  }
  t.diagnostic(JSON.stringify(f.diagnostic('incremental-root-control-truth')));
});

test('incremental branch pruning and quitting preserve short circuit, comma and default-print behavior', (t) => {
  const f = incrementalFixture(t);
  const expressions = [
    ['-name', 'z-dir', '-prune', '-o', '-print0'], ['-name', 'z-dir', '-prune'],
    ['-path', 'tree/z-dir', '-prune', '-o', '-name', 'target.txt', '-print0'],
    ['!', '(', '-name', 'z-dir', '-prune', ')'], ['-false', '-a', '-prune', '-o', '-print0'],
    ['-false', '-a', '-quit', '-o', '-print0'], ['-name', 'target.txt', '-print0', '-quit'],
    ['-name', 'z-dir', '-prune', ',', '-print0'],
    ['(', '-type', 'd', '-a', '-name', 'z-dir', '-prune', ')', '-o', '(', '-type', 'f', '-print0', ')'],
    ['-name', 'z-dir', '-prune', '-o', '-name', 'foo.txt'],
    ['-name', 'z-dir', '-prune', '-o', '(', '-name', 'foo.txt', '-print0', ',', '-false', ')'],
  ];
  for (const [index, expression] of expressions.entries())
    f.compare(['tree', '-maxdepth', '8', ...expression], { route: index % 2 ? 'private' : 'public' });
  t.diagnostic(JSON.stringify(f.diagnostic('incremental-branch-control-operators')));
});

test('incremental controls preserve overlapping roots, raw bytes, symlinks and GNU metadata references', (t) => {
  const f = incrementalFixture(t);
  const controls = ['-false', '-a', '-quit', '-o'];
  for (const argv of [
    ['tree', 'tree/z-dir', 'tree', ...controls, '-print0'],
    ['tree/', './tree/z-dir/', ...controls, '-print0'],
    ['tree', ...controls, '-type', 'l', '-print0'],
    ['tree', ...controls, '-samefile', 'tree/foo.txt', '-print0'],
    ['tree', ...controls, '-regex', '.*\\.txt', '-print0'],
    ['tree', ...controls, '-name', '*', '-printf', String.raw`%p|%f|%y\0`],
    ['tree', '-maxdepth', '2', ...controls, '-print0'],
    ['tree', '-mindepth', '1', ...controls, '-print0'],
  ]) f.compare(finiteDepth(argv));
  for (const root of ['tree/linkdir', 'tree/linkfile', 'tree/dangling', 'tree/π.txt'])
    f.compare([root, '-maxdepth', '0', '-prune', '-print0'], { fd: 'zero' });
  t.diagnostic(JSON.stringify(f.diagnostic('incremental-roots-rawbytes-metadata')));
});

test('incremental controls retain original GNU for unsafe traversal and action combinations', (t) => {
  const f = incrementalFixture(t);
  for (const argv of [['-L', 'tree', '-maxdepth', '8', '-prune'], ['-H', 'tree', '-maxdepth', '8', '-prune'], ['tree', '-maxdepth', '8', '-depth', '-prune'],
    ['tree', '-maxdepth', '8', '-xdev', '-prune'], ['tree', '-maxdepth', '8', '-follow', '-prune'], ['tree', '-maxdepth', '8', '-prune', '-printf', '%d:%H:%P\n'],
    ['missing', 'tree', '-maxdepth', '8', '-prune'], ['tree', '-maxdepth', '8', '-false', '-a', '-prune', '-o', '-exec', '/usr/bin/true', ';']])
    f.compare(argv, { fd: 'native' });
  t.diagnostic(JSON.stringify(f.diagnostic('incremental-unsafe-combination-native')));
});

test('unbounded controls and beyond-PATH_MAX descendants preserve original full GNU traversal without fd credit', (t) => {
  const f = incrementalFixture(t);
  for (const expression of [['-prune'], ['-quit'], ['-name', 'z-dir', '-prune', '-o', '-print0'], ['-false', '-a', '-quit', '-o', '-print0']])
    f.compare(['tree', ...expression], { fd: 'native' });
  const longRoot = join(f.cwd, 'long-tree');
  const build = String.raw`import os,sys
os.mkdir(sys.argv[1]); descriptor=os.open(sys.argv[1],os.O_RDONLY|os.O_DIRECTORY)
try:
    for level in range(20):
        name=('%02d_' % level)+'a'*217
        os.mkdir(name,dir_fd=descriptor)
        child=os.open(name,os.O_RDONLY|os.O_DIRECTORY,dir_fd=descriptor)
        os.close(descriptor); descriptor=child
    output=os.open('owned-leaf',os.O_WRONLY|os.O_CREAT,0o600,dir_fd=descriptor)
    os.write(output,b'owned\n'); os.close(output)
finally: os.close(descriptor)`;
  assert.equal(run('python3', ['-c', build, longRoot], f.cwd, { env: f.env }).status, 0);
  let maximumRecordBytes = 0;
  try {
    const { expected } = f.compare(['long-tree', '-maxdepth', '24', '-false', '-a', '-quit', '-o', '-print0'], { fd: 'native' });
    assert.equal(expected.status, 0); assert.equal(expected.stderr.length, 0);
    maximumRecordBytes = Math.max(...expected.stdout.toString('latin1').split('\0').map((path) => Buffer.byteLength(path, 'latin1')));
    assert.ok(maximumRecordBytes > 4096, 'GNU must really traverse and print a path beyond PATH_MAX');
    assert.ok(expected.stdout.includes(Buffer.from('/owned-leaf\0')));
  } finally {
    assert.equal(run('python3', ['-c', 'import shutil,sys;shutil.rmtree(sys.argv[1])', longRoot], f.cwd, { env: f.env }).status, 0);
  }
  t.diagnostic(JSON.stringify({ ...f.diagnostic('incremental-unbounded-and-path-budget-native'),
    ownedLongTreeLevels: 20, maximumGNURecordBytes: maximumRecordBytes }));
});

test('native root actions preserve newly created, deleted and modified next entries without false fd credit', (t) => {
  const f = incrementalFixture(t), mutation = join(f.cwd, 'mutation');
  for (const [prepare, command, predicate = []] of [
    [[], 'if [ "$1" = mutation ]; then printf owned > mutation/new; fi'],
    [['removed', 'kept'], 'if [ "$1" = mutation ]; then rm -f mutation/removed; fi'],
    [['changed', 'kept'], 'if [ "$1" = mutation ]; then printf enlarged-owned-content > mutation/changed; fi', ['-type', 'f', '-size', '+10c']],
  ]) {
    const reset = () => { rmSync(mutation, { recursive: true, force: true }); mkdirSync(mutation);
      for (const name of prepare) writeFileSync(join(mutation, name), 'owned\n'); };
    const argv = ['mutation', '-maxdepth', '1', '-exec', '/usr/bin/bash', '-c', command, 'owned-action', '{}', ';', ...predicate, '-print0'];
    const result = f.compare(argv, { fd: 'native', beforeEach: reset,
      afterEach: () => ({ new: existsSync(join(mutation, 'new')), removed: existsSync(join(mutation, 'removed')),
        changed: existsSync(join(mutation, 'changed')) ? readFileSync(join(mutation, 'changed')).toString('hex') : null }) });
    if (predicate.length) assert.deepEqual(result.expected.stdout, Buffer.from('mutation/changed\0'), 'GNU observes root action metadata changes before evaluating the child');
    else assert.ok(result.expected.stdout.includes(Buffer.from('mutation\0')));
    if (!prepare.length) assert.ok(result.expected.stdout.includes(Buffer.from('mutation/new\0')), 'GNU must see the child created at the root');
    else assert.ok(!result.expected.stdout.includes(Buffer.from('mutation/removed\0')));
  }
  t.diagnostic(JSON.stringify(f.diagnostic('incremental-mutating-actions-native')));
});

test('incremental GNU retains original terminal quoting for print and formatting with real fd listings', (t) => {
  const f = incrementalFixture(t);
  const script = String.raw`import errno,json,os,pty,select,subprocess,sys,time
results=[]
for argv in json.loads(sys.argv[1]):
    master,slave=pty.openpty()
    child=subprocess.Popen(argv,stdin=subprocess.DEVNULL,stdout=slave,stderr=subprocess.PIPE)
    os.close(slave); data=bytearray(); deadline=time.monotonic()+8
    try:
        while True:
            if time.monotonic()>deadline: raise TimeoutError('owned terminal output deadline')
            if not select.select([master],[],[],0.1)[0]: continue
            try: chunk=os.read(master,65536)
            except OSError as error:
                if error.errno==errno.EIO: break
                raise
            if not chunk: break
            data.extend(chunk)
            if len(data)>4*1024*1024: raise ValueError('owned terminal output cap')
        status=child.wait(timeout=2); errors=child.stderr.read()
        results.append({'status':status,'stdoutHex':data.hex(),'stderrHex':errors.hex()})
    finally:
        os.close(master)
        if child.poll() is None: child.kill(); child.wait()
print(json.dumps(results))`;
  for (const output of [['-print'], ['-print0'], ['-printf', String.raw`%p|%f\n`]]) {
    const argv = ['tree', '-maxdepth', '8', '-name', 'z-dir', '-prune', '-o', ...output], fdBefore = f.calls().length, nativeBefore = f.nativeCalls().length;
    const result = run('python3', ['-c', script, JSON.stringify([['/usr/bin/find', ...argv], [PUBLIC, ...argv]])], f.cwd, { env: f.env });
    assert.equal(result.status, 0, result.stderr.toString());
    const [expected, actual] = JSON.parse(result.stdout);
    assert.deepEqual(actual, expected, 'actual PTY bytes/status/stderr match GNU');
    assert.equal(expected.status, 0); assert.ok(expected.stdoutHex.length > 0);
    assert.ok(f.calls().slice(fdBefore).some((args) => args.includes('--max-depth')), 'terminal oracle must use real fd');
    assert.equal(f.nativeCalls().slice(nativeBefore).filter((args) => classifyGNU(args) === 'original').length, 0);
  }
  t.diagnostic(JSON.stringify({ campaign: 'incremental-public-TTY-output', actualGNUComparisons: 3,
    actualImmediateFdInvocations: f.calls().filter((args) => args.includes('--max-depth')).length,
    actualOriginalGNUInvocations: 0, outputDestination: 'real owned PTY', rawFixtureBytes: true }));
});
