// The installed GNU executable is the independent byte/status/diagnostic oracle.
// A planning result never grants native credit to a delegated GNU invocation.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const BINARY = process.env.FIND2FD_RUST_BINARY || fileURLToPath(new URL('../rust/target/release/find2fd-rust', import.meta.url));
const CONTRACT = JSON.parse(readFileSync(new URL('./rust-engine-contract.json', import.meta.url), 'utf8'));
const INVENTORY = JSON.parse(readFileSync(new URL('./find_option_inventory.json', import.meta.url), 'utf8'));
const SEED = 0x46444e31;
const CAMPAIGN_CASES = 384;
const BASE_ENV = { ...process.env, LC_ALL: 'C', LANG: 'C', TERM: 'dumb', NO_COLOR: '1' };
for (const key of Object.keys(BASE_ENV)) if (key.startsWith('FIND2FD_')) delete BASE_ENV[key];
delete BASE_ENV.POSIXLY_CORRECT;
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const summary = (result) => ({ status: result.status, signal: result.signal,
  stdoutHex: result.stdout.subarray(0, 4096).toString('hex'), stderrHex: result.stderr.subarray(0, 4096).toString('hex'),
  stdoutBytes: result.stdout.length, stderrBytes: result.stderr.length });

function fixture(t, seed = SEED) {
  assert.ok(existsSync(BINARY), `Build the real release artifact before qualification: ${BINARY}`);
  const cwd = mkdtempSync(join(tmpdir(), 'find2fd-rust-oracle-'));
  const artifactSHA256 = digest(readFileSync(BINARY));
  const metrics = { seed: `0x${seed.toString(16)}`, comparisons: 0, rustSearches: 0, gnuFallbacks: 0, ioComparisons: 0, classes: {}, failures: [] };
  const directory = (name) => mkdirSync(join(cwd, name), { recursive: true });
  const put = (name, bytes = 'owned synthetic fixture\n') => writeFileSync(join(cwd, name), bytes);
  function invoke(program, argv, { input, locale = 'C', transport, env = {}, execTrace } = {}) {
    const options = { cwd, env: { ...BASE_ENV, LC_ALL: locale, ...env }, input,
      timeout: 15000, maxBuffer: 8 * 1024 * 1024, argv0: 'find' };
    const script = transport === 'closed-output'
      ? 'set -o pipefail; program=$1; shift; { exec -a find "$program" "$@"; } | /usr/bin/head -c 1'
      : transport === 'full-output'
        ? 'program=$1; shift; exec -a find "$program" "$@" > /dev/full'
        : transport === 'limited-descriptors'
          ? 'ulimit -n 32; program=$1; shift; exec -a find "$program" "$@"'
          : undefined;
    const descriptorFailure = ['ignored-SIGPIPE', 'nonblocking-full-pipe'].includes(transport);
    const descriptorLauncher = `import os,subprocess,sys
readfd,writefd=os.pipe2(os.O_CLOEXEC | (os.O_NONBLOCK if sys.argv[2]=='nonblocking-full-pipe' else 0))
if sys.argv[2]=='ignored-SIGPIPE':
    os.close(readfd)
else:
    try:
        while True: os.write(writefd,b'x'*4096)
    except BlockingIOError:
        pass
child=subprocess.Popen(['find',*sys.argv[3:]],executable=sys.argv[1],stdin=subprocess.DEVNULL,stdout=writefd,stderr=subprocess.PIPE,restore_signals=False)
_,errors=child.communicate(timeout=5)
os.close(writefd)
if sys.argv[2]!='ignored-SIGPIPE': os.close(readfd)
sys.stderr.buffer.write(errors)
sys.stderr.buffer.flush()
sys.exit(128-child.returncode if child.returncode<0 else child.returncode)
`;
    const result = descriptorFailure
      ? spawnSync('/usr/bin/python3', ['-c', descriptorLauncher, program, transport, ...argv], options)
      : execTrace && program === BINARY
      ? spawnSync('/usr/bin/strace', ['-qq', '-f', '-e', 'trace=execve', '-o', execTrace, program, ...argv], options)
      : script === undefined ? spawnSync(program, argv, options)
      : spawnSync('/usr/bin/bash', ['--noprofile', '--norc', '-c', script, 'owned-find-stream-oracle', program, ...argv], options);
    assert.equal(result.error, undefined, `${program}: ${result.error?.message}`);
    assert.equal(result.signal, null, `${program}: ${result.signal}`);
    return result;
  }
  function route(argv, options = {}) {
    const plan = invoke(BINARY, ['--find2fd-route-json', ...argv], { ...options, transport: undefined });
    assert.equal(plan.status, 0, `route report failed: ${plan.stderr.toString()}`);
    assert.equal(plan.stderr.length, 0, 'planning leaves stderr empty');
    const parsed = JSON.parse(plan.stdout.toString());
    assert.ok(['native', 'gnu'].includes(parsed.route), `unknown route ${JSON.stringify(parsed)}`);
    assert.equal(typeof parsed.reason, 'string');
    return parsed;
  }
  function compare(id, argv, { native, gnu, afterOracle, verifyEffects, ...options } = {}) {
    const planned = route(argv, options);
    const expected = invoke('/usr/bin/find', argv, options);
    if (afterOracle) afterOracle(expected);
    const actual = invoke(BINARY, argv, options);
    metrics.comparisons++;
    // The special stdout descriptor can change runtime routing after a normal
    // route query. Keep these I/O comparisons out of native execution credit.
    metrics[options.transport ? 'ioComparisons' : planned.route === 'native' ? 'rustSearches' : 'gnuFallbacks']++;
    metrics.classes[id] = (metrics.classes[id] || 0) + 1;
    const witness = { id, argv, cwd, locale: options.locale || 'C', transport: options.transport || 'direct',
      inputHex: (options.input || Buffer.alloc(0)).toString('hex'), route: planned, GNU: summary(expected), Rust: summary(actual) };
    try {
      assert.equal(actual.status, expected.status, `${id}: status`);
      assert.ok(actual.stdout.equals(expected.stdout), `${id}: stdout bytes/order`);
      assert.ok(actual.stderr.equals(expected.stderr), `${id}: stderr bytes`);
      if (native) assert.equal(planned.route, 'native', `${id}: actual native route required`);
      if (gnu) assert.equal(planned.route, 'gnu', `${id}: original GNU delegation required`);
      if (verifyEffects) verifyEffects(actual, expected);
    } catch (error) {
      metrics.failures.push(witness);
      throw new Error(`${error.message}\n${JSON.stringify(witness)}`, { cause: error });
    }
    return planned;
  }
  t.after(() => {
    const evidence = join(cwd, 'oracle-results.json');
    writeFileSync(evidence, JSON.stringify({ ...metrics, binary: BINARY, artifactSHA256 }, null, 2) + '\n');
    t.diagnostic(JSON.stringify({ ...metrics, artifactSHA256, failures: metrics.failures.length,
      evidence: metrics.failures.length ? evidence : undefined }));
    assert.equal(digest(readFileSync(BINARY)), artifactSHA256, 'release binary changed during qualification');
    if (!metrics.failures.length) rmSync(cwd, { recursive: true, force: true });
  });
  for (const name of ['tree/z-dir/deep', 'tree/a-dir', 'tree/.hidden-dir', 'tree/.git', 'tree/empty', 'second/nested']) directory(name);
  for (const name of ['tree/z-last.txt', 'tree/a-first.txt', 'tree/foo.txt', 'tree/Foo.txt', 'tree/z-dir/target.txt',
    'tree/z-dir/deep/target.txt', 'tree/a-dir/target.txt', 'tree/.hidden.txt', 'tree/.hidden-dir/target.txt',
    'tree/.git/inside.txt', 'tree/ignored.txt', 'tree/fdignored.txt', 'tree/space name.txt', "tree/apostrophe's.txt",
    'tree/line\nbreak.txt', 'tree/-hyphen.txt', 'tree/literal[1].txt', 'tree/literal*.txt', 'tree/π.txt', 'tree/Ä.txt',
    'second/nested/target.txt', 'root-file', '!root-file', '(root-file']) put(name);
  put('tree/.gitignore', 'ignored.txt\n'); put('tree/.fdignore', 'fdignored.txt\n');
  put('tree/.ignore', 'also-ignored\n'); put('tree/also-ignored');
  writeFileSync(Buffer.concat([Buffer.from(cwd + '/tree/'), Buffer.from([0xff, 0xfe]), Buffer.from('.txt')]), 'raw filename\n');
  symlinkSync('z-dir', join(cwd, 'tree/linkdir'));
  symlinkSync('foo.txt', join(cwd, 'tree/linkfile'));
  symlinkSync('missing', join(cwd, 'tree/dangling'));
  symlinkSync('tree', join(cwd, 'root-link'));
  symlinkSync('absent-target', join(cwd, 'root-dangling'));
  assert.equal(spawnSync('/usr/bin/mkfifo', [join(cwd, 'tree/pipe')]).status, 0);
  assert.equal(spawnSync('/usr/bin/python3', ['-c', 'import socket,sys;s=socket.socket(socket.AF_UNIX);s.bind(sys.argv[1])', join(cwd, 'tree/socket')]).status, 0);
  return { cwd, directory, put, route, invoke, compare, metrics };
}

test('Rust release native find grammar preserves ordered complete raw paths', { timeout: 45000 }, (t) => {
  const f = fixture(t);
  const classes = [
    ['default-print', ['tree']],
    ['physical-traversal', ['-P', 'tree', '-print0']],
    ['literal-name', ['tree', '-name', 'foo.txt']],
    ['glob-name', ['tree', '-name', '*.txt', '-print0']],
    ['folded-name', ['tree', '-iname', '*.TXT', '-print0']],
    ['path-pattern', ['tree', '-path', 'tree/*/target.txt', '-print0']],
    ['folded-path', ['tree', '-ipath', 'TREE/*/TARGET.TXT', '-print0']],
    ['whole-path-alias', ['tree', '-wholename', 'tree/*txt', '-print0']],
    ['folded-whole-path-alias', ['tree', '-iwholename', 'TREE/*TXT', '-print0']],
    ['type-filter', ['tree', '-type', 'f', '-print0']],
    ['depth-bounds', ['tree', '-mindepth', '1', '-maxdepth', '2', '-print0']],
    ['and-expression', ['tree', '-type', 'f', '-and', '-name', '*.txt', '-print0']],
    ['or-expression', ['tree', '-name', 'foo.txt', '-o', '-name', 'Foo.txt']],
    ['not-expression', ['tree', '-not', '(', '-type', 'd', '-o', '-type', 'l', ')', '-print0']],
    ['comma-expression', ['tree', '-false', ',', '-type', 'd']],
    ['parenthesized-expression', ['tree', '(', '-type', 'f', '-o', '-type', 'l', ')', '-a', '-name', '*txt']],
    ['constant-predicates', ['tree', '-true', '-a', '!', '-false', '-print0']],
    ['repeated-actions', ['tree', '-print0', '-print', '-print0']],
    ['explicit-print-short-circuit', ['tree', '-name', 'foo.txt', '-o', '-print0']],
    ['duplicate-roots', ['second', 'tree', 'second', '-print0']],
    ['root-file', ['root-file', '-print0']],
    ['root-symlink', ['root-link', '-print0']],
    ['root-dangling-symlink', ['root-dangling', '-type', 'l', '-print0']],
    ['empty-directory', ['tree/empty', '-mindepth', '1', '-print0']],
  ];
  assert.deepEqual(classes.map(([id]) => id), CONTRACT.nativeRequiredClasses);
  for (const [id, argv] of classes) f.compare(id, argv, { native: true });
  for (const root of ['./tree', 'tree/', 'tree///', join(f.cwd, 'tree'), './!root-file', './(root-file']) {
    f.compare('root-spelling', [root, '-print0'], { native: true });
    f.compare('root-spelling-maxdepth-zero', [root, '-maxdepth', '0', '-print0'], { native: true });
  }
  for (const type of ['f', 'd', 'l', 'p', 's', 'b', 'c']) f.compare('type-alphabet', ['tree', '-type', type, '-print0'], { native: true });
  for (const pattern of ['[fF]oo.txt', '?oo.txt', 'literal\\*.txt', 'literal[[]1].txt', '', 'π*', '[!a-z]*']) {
    f.compare('gnu-glob-boundaries', ['tree', '-name', pattern, '-print0'], { native: true });
  }
  f.compare('pathname-name-warning-guard', ['tree', '-name', '*/*', '-print0'], { gnu: true });
  for (const pattern of ['tree/*', '*target*', 'tree/*/target.txt', '*/*/*', 'tree/.*', 'tree/π*']) {
    f.compare('gnu-path-boundaries', ['tree', '-path', pattern, '-print0'], { native: true });
  }
});

test('Rust find boolean printing and global depth semantics match GNU', { timeout: 45000 }, (t) => {
  const f = fixture(t);
  const cases = [
    ['-false'], ['-true'], ['!', '-false'], ['-false', '-print0'], ['-print0', '-a', '-false'],
    ['-print', '-print0', '-print'], ['-false', ',', '-print0'], ['-print0', ',', '-false'],
    ['-name', 'foo.txt', '-o', '-print0'], ['(', '-name', 'foo.txt', '-o', '-name', 'Foo.txt', ')', '-print0'],
    ['-name', 'foo.txt', '-print0', ',', '-name', 'Foo.txt', '-print'],
    ['!', '(', '-print0', '-a', '-false', ')'], ['-false', '-o', '-print0', '-a', '-false'],
    ['-true', '-o', '-false', '-a', '-false'], ['(', '-true', '-o', '-false', ')', '-a', '-false'],
    ['-false', ',', '-true', '-o', '-false'], ['-false', '-o', '-true', ',', '-false'],
    ['-maxdepth', '0'], ['-maxdepth', '0001', '-print0'], ['-mindepth', '2', '-maxdepth', '1', '-print0'],
    ['-maxdepth', '3', '-maxdepth', '1', '-print0'], ['-mindepth', '1', '-mindepth', '0', '-print0'],
    ['-maxdepth', '1', '-mindepth', '1', '-type', 'd', '-print0'],
  ];
  for (const expression of cases) f.compare('boolean-and-depth-boundaries', ['tree', ...expression], { native: true });
  f.compare('implicit-root', ['-maxdepth', '1', '-type', 'd', '-print0'], { native: true });
  f.compare('no-argv-default-root', [], { native: true });
});

test('Rust find root basename and terminal-slash symlink semantics match GNU', { timeout: 45000 }, (t) => {
  const f = fixture(t);
  for (const root of ['tree/', 'tree///', 'root-link/', 'root-link///', './', 'tree/.', 'tree/../tree']) {
    f.compare('root-terminal-slash-traversal', [root, '-maxdepth', '2', '-type', 'd', '-print0'], { native: true });
    for (const pattern of ['tree', 'tree/', 'root-link', 'root-link/', '.', './']) {
      f.compare('root-basename-predicate', [root, '-maxdepth', '0', '-name', pattern, '-print0'], pattern.includes('/') ? { gnu: true } : { native: true });
    }
  }
  for (const root of ['root-file/', 'root-dangling/', 'tree/linkfile/']) {
    f.compare('terminal-slash-invalid-root', [root, '-print0'], { gnu: true });
  }
});

test('Rust find seeded native interaction campaign uses the independent GNU CLI', { timeout: 120000 }, (t) => {
  const f = fixture(t);
  const roots = [['tree'], ['second'], ['tree', 'second', 'tree'], ['tree/foo.txt'], ['tree/linkdir'], ['tree/dangling'], ['./tree/'], ['tree/empty']];
  const depths = [[], ['-maxdepth', '0'], ['-maxdepth', '1'], ['-mindepth', '1'], ['-mindepth', '2', '-maxdepth', '3']];
  const atoms = [
    ['-name', '*'], ['-name', '*.txt'], ['-name', '[fF]oo.txt'], ['-name', 'nothing'], ['-iname', '*.TXT'],
    ['-type', 'd'], ['-type', 'f'], ['-type', 'l'], ['-type', 'p'], ['-type', 's'], ['-path', '*target*'], ['-true'], ['-false'],
  ];
  const tails = [[], ['-print'], ['-print0'], ['-print0', '-print'], ['-o', '-print0'], [',', '-false'], ['-o', '-type', 'd'], ['-a', '!', '-type', 'l']];
  const pool = [];
  for (const root of roots) for (const depth of depths) for (const atom of atoms) for (const tail of tails) {
    pool.push([...root, ...depth, ...atom, ...tail]);
    pool.push([...root, ...depth, '!', '(', ...atom, '-o', '-type', 'd', ')', ...tail]);
  }
  const gcd = (a, b) => b ? gcd(b, a % b) : a;
  let step = 7919; while (gcd(step, pool.length) !== 1) step++;
  const seen = new Set();
  for (let index = 0; seen.size < CAMPAIGN_CASES; index++) {
    const argv = pool[(SEED + index * step) % pool.length];
    const identity = JSON.stringify(argv); if (seen.has(identity)) continue;
    seen.add(identity); f.compare('seeded-native-expression', argv, { native: true });
  }
  assert.equal(seen.size, CONTRACT.seededNativeComparisons);
  assert.equal(f.metrics.rustSearches, CAMPAIGN_CASES);
  assert.equal(f.metrics.gnuFallbacks, 0, 'GNU fallback must not inflate native coverage');
});

test('Rust find optimized literal, prefix, suffix and contains globs preserve GNU bytes', { timeout: 45000 }, (t) => {
  const f = fixture(t);
  for (const name of ['xxx', 'x-middle-x', 'X-MIDDLE-X', 'fooXXX', 'Xfoo', 'x', 'FOO.TXT', 'end.X', 'prefix.x.tail']) f.put(`tree/${name}`);
  for (const predicate of ['-name', '-iname']) for (const pattern of [
    '', '*', '**', '***', 'foo.txt', 'f*', 'F*', 'foo**', 'x**', '**x', '*x*', '*X*',
    '*txt', '*TXT', '**txt', '*oo*', '*OO*', 'x*x', '*π*', '*\n*',
  ]) f.compare('optimized-name-glob-boundaries', ['tree', predicate, pattern, '-print0'], { native: true });
  for (const pattern of ['*', '**', '***', 'tree/*', 'tree/**', '*txt', '*target*', '**target*', '*π*', '*\n*']) {
    f.compare('optimized-path-glob-boundaries', ['tree', '-path', pattern, '-print0'], { native: true });
  }
});

test('Rust find delegates unsupported GNU semantics before observable output', { timeout: 45000 }, (t) => {
  const f = fixture(t);
  const classes = [
    ['symlink-following', ['-H', 'root-link', '-print0']],
    ['recursive-symlink-following', ['-L', 'tree', '-print0']],
    ['depth-first-traversal', ['tree', '-depth', '-print0']],
    ['prune-action', ['tree', '-name', 'z-dir', '-prune', '-o', '-print0']],
    ['quit-action', ['tree', '-print0', '-quit']],
    ['metadata-predicate', ['tree', '-size', '+0c', '-print0']],
    ['formatted-output', ['tree', '-printf', '%p:%f:%d\\0']],
    ['regex-predicate', ['tree', '-regex', '.*target.*', '-print0']],
    ['exec-action', ['tree', '-maxdepth', '1', '-exec', '/usr/bin/printf', '%s\\0', '{}', ';']],
    ['files0-input', ['-files0-from', '-', '-maxdepth', '0', '-print0'], Buffer.from('root-file\0tree\0tree\0')],
    ['missing-root', ['absent-root', 'tree', '-print0']],
    ['malformed-expression', ['tree', '-name']],
    ['position-sensitive-warning', ['tree', '-name', '*', '-maxdepth', '1', '-print0']],
    ['depth-overflow', ['tree', '-maxdepth', '18446744073709551616']],
  ];
  assert.deepEqual(classes.map(([id]) => id), CONTRACT.fallbackAllowedClasses);
  for (const [id, argv, input] of classes) f.compare(id, argv, { gnu: true, input });
  for (const argv of [
    ['tree', '-type', 'x'], ['tree', '-type', 'f,d'], ['tree', '-mindepth', '-1'], ['tree', '-maxdepth', 'bad'],
    ['tree', '-maxdepth'], ['tree', '-unknown'], ['tree', '('], ['tree', ')'], ['tree', '-o'], ['tree', '!'],
    ['tree', '-true', '-a'], ['tree', ','], ['-P', '-L', '-P', 'tree'], ['--', 'tree', '-print0'], ['-O2', 'tree'],
  ]) f.compare('invalid-or-unsupported-argv', argv, { gnu: true });
  for (const argv of [['tree', '-type', 'f', '-maxdepth', '1'], ['tree', '-false', '-mindepth', '1']]) {
    f.compare('later-global-option-warning', argv, { gnu: true });
  }
});

test('Rust find option inventory classifies every GNU spelling without running actions', { timeout: 45000 }, (t) => {
  const f = fixture(t);
  const help = f.invoke('/usr/bin/find', ['--help']).stdout.toString();
  const spellings = new Set(help.match(/(?<![A-Za-z0-9_])--?[A-Za-z][A-Za-z0-9_-]*/g)); spellings.delete('-N');
  const declared = new Map(CONTRACT.options.map((entry) => [entry.spelling, entry]));
  const existing = new Set([...INVENTORY.options, ...INVENTORY.operators].map(({ spelling }) => spelling));
  assert.equal(declared.size, CONTRACT.options.length, 'no duplicate option declarations');
  assert.deepEqual([...declared.keys()].sort(), [...existing].sort(), 'entire existing audited inventory retained');
  for (const spelling of spellings) assert.ok(declared.has(spelling), `unclassified installed GNU help spelling ${spelling}`);
  for (const option of CONTRACT.options) {
    assert.ok(option.contract.length > 10, `${option.spelling}: observable contract`);
    const plan = f.route(option.argv);
    assert.equal(plan.route, option.route, `${option.spelling}: declared route`);
  }
  t.diagnostic(JSON.stringify({ campaign: 'rust-GNU-option-inventory', GNUHelpOptionSpellings: spellings.size, classifiedOptionsAndOperators: declared.size,
    nonExecutingRouteChecks: CONTRACT.options.length, destructiveActionsExecuted: 0 }));
});

test('Rust find fallback actions preserve owned filesystem side effects', { timeout: 45000 }, (t) => {
  const f = fixture(t);
  for (const action of [
    ['-fprint', 'action-output'], ['-fprint0', 'action-output'], ['-fprintf', 'action-output', '%p:%f\\0'],
    ['-exec', '/usr/bin/printf', '%s\\0', '{}', '+'], ['-execdir', '/usr/bin/printf', '%s\\0', '{}', ';'],
  ]) {
    const argv = ['tree', '-maxdepth', '1', ...action];
    rmSync(join(f.cwd, 'action-output'), { force: true });
    let expectedFile;
    f.compare('owned-output-and-exec-actions', argv, { gnu: true,
      afterOracle: () => {
        if (existsSync(join(f.cwd, 'action-output'))) expectedFile = readFileSync(join(f.cwd, 'action-output'));
        rmSync(join(f.cwd, 'action-output'), { force: true });
      },
      verifyEffects: () => {
        if (expectedFile) assert.deepEqual(readFileSync(join(f.cwd, 'action-output')), expectedFile, `${action[0]} output side effect`);
        else assert.equal(existsSync(join(f.cwd, 'action-output')), false, `${action[0]} must not create a file`);
      },
    });
  }
  f.directory('delete-me'); f.put('delete-me/one'); f.directory('delete-me/nested'); f.put('delete-me/nested/two');
  f.compare('owned-delete-action', ['delete-me', '-depth', '-delete'], { gnu: true,
    afterOracle: () => {
      assert.equal(existsSync(join(f.cwd, 'delete-me')), false, 'GNU must delete the owned fixture');
      f.directory('delete-me'); f.put('delete-me/one'); f.directory('delete-me/nested'); f.put('delete-me/nested/two');
    },
    verifyEffects: () => {
      assert.equal(existsSync(join(f.cwd, 'delete-me')), false, 'fallback deletes the same fixture');
      assert.ok(existsSync(join(f.cwd, 'tree/foo.txt')), 'unrelated fixture remains intact');
    },
  });
});

test('Rust find native parallel traversal restores GNU preorder without losing duplicate roots', { timeout: 45000 }, (t) => {
  const f = fixture(t);
  f.directory('parallel');
  // Discovery order deliberately differs from lexicographic order. Each branch
  // has a different depth and uses raw newline names to forbid line sorting.
  for (let i = 0; i < 160; i++) {
    const name = `branch-${(i * 71) % 160}`;
    f.directory(`parallel/${name}/child`);
    f.put(`parallel/${name}/first.txt`);
    f.put(`parallel/${name}/child/target.txt`);
    f.put(`parallel/${name}/line\nbreak`);
  }
  for (const argv of [
    ['parallel', '-print0'], ['parallel', '-name', '*target*', '-print0'],
    ['parallel', '-maxdepth', '1', '-type', 'd', '-print0'],
    ['parallel', '-mindepth', '2', '-type', 'f', '-print0'],
    ['parallel', 'tree', 'parallel', '-print0'],
    ['parallel', '(', '-name', '*.txt', '-o', '-type', 'd', ')', '-print0', '-print'],
  ]) {
    const planned = f.compare('parallel-native-GNU-order', argv, { native: true });
    if (!argv.includes('-maxdepth')) {
      assert.equal(planned.strategy, 'parallel', 'actually exercise the release parallel traversal');
      assert.ok(planned.workers > 1, 'parallel search must have more than one worker');
    }
  }
  f.compare('parallel-descriptor-pressure', ['parallel', '-print0'], { transport: 'limited-descriptors' });
});

test('Rust find shallow traversal avoids workers while preserving GNU rows and limits', { timeout: 45000 }, (t) => {
  const f = fixture(t);
  f.directory('shallow');
  for (let i = 0; i < 48; i++) { f.directory(`shallow/dir-${i}/deeper`); f.put(`shallow/dir-${i}/deeper/file`); }
  for (const argv of [
    ['shallow', '-maxdepth', '0', '-print0'],
    ['shallow', '-maxdepth', '1', '-type', 'd', '-print0'],
    ['shallow', '-mindepth', '1', '-maxdepth', '1', '-print0'],
  ]) {
    const plan = f.compare('shallow-no-pool-GNU-order', argv, { native: true });
    assert.equal(plan.strategy, 'sequential', 'no work remains below these rows to justify a thread pool');
    assert.equal(plan.workers, 1);
  }
});

test('Rust find errors, locales, physical cycles and stdout failures preserve GNU behavior', { timeout: 60000 }, (t) => {
  const f = fixture(t);
  assert.notEqual(process.getuid(), 0, 'permission qualification must run as a genuinely unprivileged user');
  f.directory('tree/unreadable'); f.put('tree/unreadable/secret');
  chmodSync(join(f.cwd, 'tree/unreadable'), 0);
  try { f.compare('unreadable-traversal', ['tree', '-print0'], { gnu: true }); }
  finally { chmodSync(join(f.cwd, 'tree/unreadable'), 0o700); }
  symlinkSync('..', join(f.cwd, 'tree/z-dir/cycle'));
  f.compare('physical-cycle-no-follow', ['tree', '-print0'], { native: true });
  f.compare('following-cycle-GNU-diagnostic', ['-L', 'tree', '-print0'], { gnu: true });
  for (const argv of [['tree', '-iname', 'Ä*'], ['tree', '-ipath', '*Ä*'], ['tree', '-name', '[[:alpha:]]*'], ['tree', '-name', 'π*']]) {
    f.compare('non-C-complex-pattern', argv, { locale: 'C.UTF-8', gnu: true });
  }
  f.compare('non-C-literal-ASCII', ['tree', '-name', 'foo.txt', '-print0'], { locale: 'C.UTF-8', native: true });
  f.compare('POSIX-complex-pattern', ['tree', '-name', '[a-z]*', '-print0'], { locale: 'POSIX', native: true });
  f.compare('closed-output', ['tree', '-print0'], { transport: 'closed-output' });
  f.compare('full-output', ['tree', '-print0'], { transport: 'full-output' });
  f.compare('descriptor-pressure', ['tree', '-print0'], { transport: 'limited-descriptors' });
});

test('Rust find preparation limits abandon native work before any partial output', { timeout: 45000 }, (t) => {
  const f = fixture(t);
  f.compare('POSIXLY_CORRECT-delegation', ['tree', '-print0'], { gnu: true, env: { POSIXLY_CORRECT: '1' } });
  f.compare('POSIXLY_CORRECT-empty-delegation', ['tree', '-print0'], { gnu: true, env: { POSIXLY_CORRECT: '' } });
  f.compare('pattern-preparation-bound', ['tree', '-name', '*'.repeat(8193), '-print0'], { gnu: true });
  f.compare('expression-preparation-bound', ['tree', ...Array(600).fill('-true'), '-print0'], { gnu: true });
  // The ordinary command must reproduce every GNU path once even when native
  // preparation discovers an unqualified depth after visiting many earlier rows.
  f.directory('deep');
  let root = 'deep';
  for (let i = 0; i < 258; i++) { root += '/d'; f.directory(root); }
  f.put(`${root}/tail`);
  f.compare('late-depth-preparation-bound', ['tree', 'deep', '-print0'], { gnu: true });
});

for (const transport of ['ignored-SIGPIPE', 'nonblocking-full-pipe']) test(`Rust find stdout regression: ${transport}`, { timeout: 45000 }, (t) => {
  const f = fixture(t);
  // The stdout transport is the only changed condition. A tiny result exposes
  // failures hidden in the standard-output buffer finalizer, not just a large
  // write that fills an ordinary blocking pipe.
  const argv = ['tree/foo.txt', '-print0'];
  const expected = f.invoke('/usr/bin/find', argv, { transport });
  assert.equal(expected.status, 1, `${transport}: GNU must observe the write failure`);
  assert.ok(expected.stderr.length > 0, `${transport}: GNU error diagnostics must exist`);
  f.compare(`regression-${transport}`, argv, { transport });
});

test('Rust find ordinary execution uses the claimed engine and preserves direct GNU exec', { timeout: 45000 }, (t) => {
  const f = fixture(t);
  assert.ok(existsSync('/usr/bin/strace'), 'release qualification needs strace for owned-child exec proof');
  const nativeTrace = join(f.cwd, 'native-exec.trace');
  f.compare('external-native-execution-proof', ['tree', '-name', '*.txt', '-print0'], { native: true, execTrace: nativeTrace });
  const nativeExecutions = readFileSync(nativeTrace, 'utf8').split('\n').filter((line) => line.includes('execve('));
  assert.equal(nativeExecutions.length, 1, 'native traversal must not delegate to GNU, fd, Node or another executable');
  assert.ok(nativeExecutions[0].includes(JSON.stringify(BINARY)), 'the actual release binary executed');
  const delegatedTrace = join(f.cwd, 'gnu-exec.trace');
  f.compare('external-GNU-execution-proof', ['tree', '-maxdepth', '1', '-size', '+0c', '-print0'], { gnu: true, execTrace: delegatedTrace });
  const delegatedExecutions = readFileSync(delegatedTrace, 'utf8').split('\n').filter((line) => line.includes('execve('));
  assert.equal(delegatedExecutions.length, 2, 'unsupported predicates must exec exactly GNU after the release binary');
  assert.ok(delegatedExecutions[1].includes('execve("/usr/bin/find", ["find", "tree", "-maxdepth", "1", "-size", "+0c", "-print0"]'),
    'GNU receives the complete untouched argv and its normal diagnostic argv0');
});

test('Rust find physical traversal rejects a child swapped to an outside symlink before open', { timeout: 45000 }, (t) => {
  const f = fixture(t);
  assert.ok(existsSync('/usr/bin/cc'), 'owned-child race qualification needs a test-only C compiler');
  const hookSource = join(f.cwd, 'race-hook.c'), hookBinary = join(f.cwd, 'race-hook.so');
  writeFileSync(hookSource, `#define _GNU_SOURCE
#include <dirent.h>
#include <dlfcn.h>
#include <fcntl.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/syscall.h>
#include <unistd.h>
static int matches(const char *path) {
  if (!path || getenv("FIND2FD_RACE_DISABLE")) return 0;
  const char *last = strrchr(path, '/');
  return strcmp(last ? last + 1 : path, "victim") == 0;
}
static void swap_before_open(const char *path) {
  if (!matches(path)) return;
  const char *marker = getenv("FIND2FD_RACE_MARKER");
  const char *victim = getenv("FIND2FD_RACE_VICTIM");
  const char *stash = getenv("FIND2FD_RACE_STASH");
  const char *outside = getenv("FIND2FD_RACE_OUTSIDE");
  if (!marker || !victim || !stash || !outside) _exit(121);
  int fd = syscall(SYS_openat, AT_FDCWD, marker, O_WRONLY|O_CREAT|O_EXCL|O_CLOEXEC, 0600);
  if (fd < 0) return;
  if (rename(victim, stash) || symlink(outside, victim)) _exit(122);
  const char done[] = "victim replaced immediately before directory open\\n";
  if (write(fd, done, sizeof(done)-1) != sizeof(done)-1) _exit(123);
  close(fd);
}
static int mutant_flags(const char *path, int flags) {
  return matches(path) && getenv("FIND2FD_RACE_STRIP_NOFOLLOW") ? flags & ~O_NOFOLLOW : flags;
}
DIR *opendir(const char *path) {
  DIR *(*real)(const char *) = dlsym(RTLD_NEXT, "opendir");
  swap_before_open(path);
  return real(path);
}
int openat(int directory, const char *path, int flags, ...) {
  mode_t mode = 0;
  if ((flags & O_CREAT) || (flags & O_TMPFILE) == O_TMPFILE) { va_list args; va_start(args, flags); mode = va_arg(args, mode_t); va_end(args); }
  int (*real)(int,const char *,int,...) = dlsym(RTLD_NEXT, "openat");
  swap_before_open(path);
  return real(directory, path, mutant_flags(path, flags), mode);
}
int openat64(int directory, const char *path, int flags, ...) {
  mode_t mode = 0;
  if ((flags & O_CREAT) || (flags & O_TMPFILE) == O_TMPFILE) { va_list args; va_start(args, flags); mode = va_arg(args, mode_t); va_end(args); }
  int (*real)(int,const char *,int,...) = dlsym(RTLD_NEXT, "openat64");
  swap_before_open(path);
  return real(directory, path, mutant_flags(path, flags), mode);
}
`);
  const compile = spawnSync('/usr/bin/cc', ['-shared', '-fPIC', '-Wall', '-Wextra', '-Werror', '-o', hookBinary, hookSource, '-ldl'],
    { cwd: f.cwd, env: BASE_ENV, timeout: 15000, maxBuffer: 1024 * 1024 });
  assert.equal(compile.error, undefined, compile.error?.message);
  assert.equal(compile.status, 0, compile.stderr.toString());
  f.directory('outside'); f.put('outside/OUTSIDE_SENTINEL');
  const marker = join(f.cwd, 'race-trigger'), victim = join(f.cwd, 'race/victim'), stash = join(f.cwd, 'race-stashed');
  const env = { LD_PRELOAD: hookBinary, FIND2FD_RACE_MARKER: marker, FIND2FD_RACE_VICTIM: victim,
    FIND2FD_RACE_STASH: stash, FIND2FD_RACE_OUTSIDE: join(f.cwd, 'outside') };
  function reset() {
    rmSync(join(f.cwd, 'race'), { recursive: true, force: true });
    rmSync(stash, { recursive: true, force: true }); rmSync(marker, { force: true });
    f.directory('race'); f.put('race/head'); f.directory('race/victim'); f.put('race/victim/inside');
  }
  const argv = ['-P', 'race', '-print0'];
  reset();
  f.compare('race-hook-negative-control', argv, { native: true, env: { ...env, FIND2FD_RACE_DISABLE: '1' } });
  assert.equal(existsSync(marker), false, 'negative control never mutates the fixture');
  const actual = f.invoke(BINARY, argv, { env });
  assert.ok(existsSync(marker), 'the deterministic swap must occur, not silently skip');
  assert.ok(readFileSync(marker, 'utf8').includes('immediately before directory open'));
  const expected = f.invoke('/usr/bin/find', argv);
  const id = 'physical-child-symlink-swap';
  f.metrics.comparisons++; f.metrics.ioComparisons++; f.metrics.classes[id] = 1;
  try {
    assert.equal(actual.status, expected.status, 'settled post-swap GNU status');
    assert.deepEqual(actual.stderr, expected.stderr, 'settled post-swap GNU diagnostics');
    assert.deepEqual(actual.stdout, expected.stdout, 'complete settled post-swap GNU output without partial replay');
    assert.equal(actual.stdout.includes(Buffer.from('OUTSIDE_SENTINEL')), false, '-P must never descend into the swapped outside symlink');
  } catch (error) {
    f.metrics.failures.push({ id, argv, cwd: f.cwd, mutation: 'directory replaced with outside symlink before opening the child',
      GNU: summary(expected), Rust: summary(actual) });
    throw error;
  }
  reset();
  // A narrow external mutant removes only the O_NOFOLLOW open flag at the
  // controlled child. This reproduces the forbidden following mechanism and
  // proves the outside-sentinel assertion detects it without rebuilding source.
  const mutant = f.invoke(BINARY, argv, { env: { ...env, FIND2FD_RACE_STRIP_NOFOLLOW: '1' } });
  assert.ok(existsSync(marker), 'mutation control must execute the same swap');
  assert.equal(mutant.status, 0, mutant.stderr.toString());
  assert.ok(mutant.stdout.includes(Buffer.from('OUTSIDE_SENTINEL')), 'narrow O_NOFOLLOW mutant must violate the physical-walk invariant');
  t.diagnostic(JSON.stringify({ campaign: 'physical-child-symlink-swap', ownedPreloadSHA256: digest(readFileSync(hookBinary)),
    deterministicSwapChecks: 1, mutationControlsDetected: 1, productionDataRead: false }));
});

test('Rust find raw directory batches resolve unknown types and reject malformed kernel records', { timeout: 45000 }, (t) => {
  const f = fixture(t);
  assert.ok(existsSync('/usr/bin/gcc'), 'owned syscall qualification needs a test-only GNU C compiler');
  const source = join(f.cwd, 'dirent-hook.c'), binary = join(f.cwd, 'dirent-hook.so'), marker = join(f.cwd, 'dirent-hook-events');
  writeFileSync(source, `#define _GNU_SOURCE
#include <dlfcn.h>
#include <fcntl.h>
#include <stdarg.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <sys/syscall.h>
#include <unistd.h>
long syscall(long number, ...) {
  void *saved = __builtin_apply_args();
  long (*real)(long,...) = dlsym(RTLD_NEXT,"syscall");
  if (number != SYS_getdents64 || getenv("FIND2FD_DIRENT_DISABLE")) {
    void *result = __builtin_apply((void (*)())real,saved,16);
    __builtin_return(result);
  }
  va_list args; va_start(args,number);
  int fd = va_arg(args,int); void *buffer = va_arg(args,void *); size_t capacity = va_arg(args,size_t);
  va_end(args);
  long length = real(number,fd,buffer,capacity);
  if (length <= 0) return length;
  unsigned char *bytes = buffer;
  const char *fault = getenv("FIND2FD_DIRENT_FAULT");
  size_t cursor = 0, records = 0;
  while (cursor + 19 < (size_t)length) {
    uint16_t width; memcpy(&width,bytes+cursor+16,sizeof(width));
    if (width < 20 || width > (size_t)length-cursor) _exit(131);
    const char *name = (const char *)(bytes+cursor+19);
    if (strcmp(name,".") && strcmp(name,"..")) {
      records++;
      bytes[cursor+18] = 0; /* DT_UNKNOWN forces the actual anchored fstatat path. */
      if (fault && !strcmp(fault,"zero-inode") && !strcmp(name,"ZERO_INODE_TEST")) {
        memset(bytes+cursor,0,8);
        if (unlinkat(fd,name,0)) _exit(135);
      }
      if (fault && !strcmp(fault,"zero-length")) { memset(bytes+cursor+16,0,2); break; }
      if (fault && !strcmp(fault,"missing-NUL")) { memset(bytes+cursor+19,'x',width-19); break; }
    }
    cursor += width;
  }
  const char *events = getenv("FIND2FD_DIRENT_MARKER");
  if (!events) _exit(132);
  int output = open(events,O_WRONLY|O_CREAT|O_APPEND|O_CLOEXEC,0600);
  if (output < 0) _exit(133);
  const char *event = records ? "changed non-dot records\\n" : "empty batch\\n";
  if (write(output,event,strlen(event)) != (ssize_t)strlen(event)) _exit(134);
  close(output);
  return fault && !strcmp(fault,"short-header") ? 1 : length;
}
`);
  const compile = spawnSync('/usr/bin/gcc', ['-shared', '-fPIC', '-Wall', '-Wextra', '-Werror', '-Wno-cast-function-type', '-o', binary, source, '-ldl'],
    { cwd: f.cwd, env: BASE_ENV, timeout: 15000, maxBuffer: 1024 * 1024 });
  assert.equal(compile.error, undefined, compile.error?.message);
  assert.equal(compile.status, 0, compile.stderr.toString());
  const env = { LD_PRELOAD: binary, FIND2FD_DIRENT_MARKER: marker };
  f.compare('raw-directory-negative-control', ['tree', '-print0'], { native: true, env: { ...env, FIND2FD_DIRENT_DISABLE: '1' } });
  assert.equal(existsSync(marker), false, 'disabled injection leaves all directory records untouched');
  for (const argv of [
    ['tree', '-print0'], ['tree', '-type', 'f', '-print0'], ['tree', '-type', 'd', '-print0'],
    ['tree', '-type', 'l', '-print0'], ['tree', '-type', 'p', '-print0'], ['tree', '-type', 's', '-print0'],
    ['tree', '-name', '*txt', '-print0'], ['tree', '-path', '*target*', '-print0'],
  ]) f.compare('raw-directory-DT-UNKNOWN', argv, { native: true, env });
  assert.ok(readFileSync(marker, 'utf8').includes('changed non-dot records'), 'the actual release getdents64 buffers must be changed');
  f.directory('batches');
  for (let i = 0; i < 720; i++) f.put(`batches/file-${(i * 197) % 720}-${'x'.repeat(32)}.txt`);
  rmSync(marker, { force: true });
  f.compare('raw-directory-multiple-batches', ['batches', '-print0'], { native: true, env });
  assert.ok(readFileSync(marker, 'utf8').trim().split('\n').length >= 4,
    'route query and ordinary execution must each consume more than one real 32KiB directory batch');
  for (const fault of ['zero-length', 'missing-NUL', 'short-header']) {
    f.compare(`raw-directory-invalid-${fault}`, ['tree', '-print0'], { gnu: true, env: { ...env, FIND2FD_DIRENT_FAULT: fault } });
  }
  f.put('tree/ZERO_INODE_TEST');
  const inodeTrace = join(f.cwd, 'zero-inode-exec.trace');
  const argv = ['tree', '-print0'];
  const actual = f.invoke(BINARY, argv, { env: { ...env, FIND2FD_DIRENT_FAULT: 'zero-inode' }, execTrace: inodeTrace });
  assert.equal(existsSync(join(f.cwd, 'tree/ZERO_INODE_TEST')), false, 'the injected deleted record must actually exist in the raw batch');
  const expected = f.invoke('/usr/bin/find', argv);
  const id = 'raw-directory-zero-inode';
  f.metrics.comparisons++; f.metrics.ioComparisons++; f.metrics.classes[id] = 1;
  try {
    assert.equal(actual.status, expected.status);
    assert.deepEqual(actual.stdout, expected.stdout, 'zero-inode deleted rows are excluded without losing other GNU rows');
    assert.deepEqual(actual.stderr, expected.stderr);
    const executions = readFileSync(inodeTrace, 'utf8').split('\n').filter((line) => line.includes('execve('));
    assert.equal(executions.length, 1, 'legitimate zero-inode records must be skipped natively instead of forcing GNU fallback');
  } catch (error) {
    f.metrics.failures.push({ id, argv, cwd: f.cwd, mutation: 'getdents64 record inode zeroed and matching owned file deleted before parsing',
      GNU: summary(expected), Rust: summary(actual) });
    throw error;
  }
  t.diagnostic(JSON.stringify({ campaign: 'raw-directory-batches', ownedPreloadSHA256: digest(readFileSync(binary)),
    unknownTypeComparisons: 9, malformedRecordComparisons: 3, zeroInodeComparisons: 1, productionDataRead: false }));
});
