import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { PUBLIC, exact, fixture, quote, run } from './helpers.mjs';
import { withFindWrapper } from '../src/find-wrapper.mjs';

// Default dispatch uses the native release, or direct GNU when a source archive
// has not been built. The explicit JS/fd experiment is checked separately.
test('default release routing preserves GNU order without fd sampling or a Node helper', (t) => {
  const f = fixture(t), root = join(f.cwd, 'layered'); mkdirSync(root);
  for (let top = 0; top < 12; top++) {
    const parent = join(root, `top-${top}`); mkdirSync(parent);
    for (let child = 0; child < 8; child++) {
      const directory = join(parent, `child-${child}`); mkdirSync(directory);
      writeFileSync(join(directory, 'common.txt'), 'owned\n');
      if (top % 17 === 0 && child === 0) writeFileSync(join(directory, 'rare-result.dat'), 'owned\n');
    }
  }
  const env = { ...f.env }; delete env.FIND2FD_EXPERIMENTAL_FD;
  const invoke = (argv, privateShell = false) => privateShell
    ? run('/usr/bin/bash', ['--noprofile', '--norc', '-c', withFindWrapper({ command: 'find "$@"' }, '/usr/bin/bash').command, 'owned-auto', ...argv], f.cwd, { env })
    : run(PUBLIC, argv, f.cwd, { env });
  let comparisons = 0;
  for (const argv of [['layered', '-name', 'rare-result.dat', '-print0'], ['layered', '-name', 'rare*.dat', '-print'],
    ['-P', 'layered', '-type', 'f', '-name', 'rare-result.dat', '-print0'], ['layered', '-mindepth', '1', '-maxdepth', '3', '-name', 'never-a-match', '-print0']]) {
    for (const privateShell of [false, true]) {
      const before = f.actualSearchCalls();
      const expected = run('/usr/bin/find', argv, f.cwd, { env });
      exact(invoke(argv, privateShell), expected, JSON.stringify({ argv, privateShell }));
      assert.equal(f.actualSearchCalls(), before, 'default release path never executes fd or its old sampling policy');
      comparisons++;
    }
  }
  for (const argv of [['layered', '-name', 'common.txt', '-print0'], ['layered', '-name', '*', '-print0'], ['layered', '-type', 'd', '-name', 'child-399', '-print0'],
    ['layered', '-type', 'f', '-print0'], ['layered', '-maxdepth', '1', '-name', 'rare-result.dat', '-print0'],
    ['layered', '-size', '+0c', '-print0'], ['layered', '-name', 'rare-result.dat', '-printf', '%p\n'],
    ['-L', 'layered', '-name', 'rare-result.dat', '-print0'], ['layered', '-name', 'rare-result.dat', '-o', '-name', 'common.txt', '-print0'],
    ['layered', '-name', 'rare?.dat', '-print0']]) {
    const before = f.actualSearchCalls();
    exact(invoke(argv), run('/usr/bin/find', argv, f.cwd, { env }), JSON.stringify(argv));
    assert.equal(f.actualSearchCalls(), before, 'native and GNU fallback default paths never start fd');
    comparisons++;
  }
  const argv = ['layered', '-name', 'rare-result.dat', '-print0'];
  const before = f.actualSearchCalls();
  for (const value of ['off', '0']) {
    exact(run(PUBLIC, argv, f.cwd, { env: { ...env, FIND2FD_ACCELERATION: value } }), run('/usr/bin/find', argv, f.cwd, { env }));
    comparisons++;
  }
  assert.equal(f.actualSearchCalls(), before, 'explicit native overrides automatic eligibility');
  t.diagnostic(JSON.stringify({ campaign: 'default-native-release-routing', actualGNUComparisons: comparisons,
    actualAutomaticFdInvocations: 0, GNUComparisons: comparisons, syntheticSecondLevelDirectories: 96,
    buildPresent: existsSync(env.FIND2FD_RUST_BINARY || fileURLToPath(new URL('../rust/target/release/find2fd-rust', import.meta.url))),
    nativeCredit: 'separate strace-backed Rust integration qualification',
    fullByteOrderChecked: true, extraUserActions: 0 }));
});

test('automatic native rejection never duplicates a user action and restores shell options', (t) => {
  const f = fixture(t), env = { ...f.env }; delete env.FIND2FD_EXPERIMENTAL_FD;
  const marker = join(f.cwd, 'action-once');
  const argv = ['tree', '-maxdepth', '0', '-exec', '/usr/bin/bash', '-c', `printf x >> ${quote(marker)}`, ';'];
  exact(run(PUBLIC, argv, f.cwd, { env }), { ...run('/usr/bin/true', [], f.cwd, { env }) });
  assert.equal(readFileSync(marker, 'utf8'), 'x', 'the native action executes once');
  const helper = withFindWrapper({ command: 'shopt -s failglob nocaseglob; find tree -name foo.txt -print0; shopt -p failglob nocaseglob' }, '/usr/bin/bash').command;
  const actual = run('/usr/bin/bash', ['--noprofile', '--norc', '-c', helper], f.cwd, { env });
  const expected = run('/usr/bin/bash', ['--noprofile', '--norc', '-c', 'shopt -s failglob nocaseglob; /usr/bin/find tree -name foo.txt -print0; shopt -p failglob nocaseglob'], f.cwd, { env });
  exact(actual, expected);
  assert.equal(f.actualSearchCalls(), 0);
});
