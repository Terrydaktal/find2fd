import assert from 'node:assert/strict';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { compare, exact, fixture, INTERNAL, run } from './helpers.mjs';

const expressions = [
  ['-prune'], ['-quit'],
  ['-path', 'tree/z-dir', '-prune', '-o', '-name', 'target.txt', '-print0'],
  ['-path', 'tree/'], ['-name', '*', '-maxdepth', '1'], ['-unknown'],
];
test('unbounded traversal controls and diagnostic-sensitive expressions retain original GNU execution without fd', (t) => {
  const current = fixture(t);
  for (const expression of expressions) {
    const before = current.calls().length;
    compare(['tree', ...expression], current, { env: current.env });
    assert.equal(current.calls().length, before, `native expression must not execute fd: ${JSON.stringify(expression)}`);
  }
  t.diagnostic(JSON.stringify({ campaign: 'expression-fallback', actualGNUComparisons: expressions.length, actualFdInvocations: 0 }));
});
test('native stdin file lists preserve raw NUL roots without preflight consumption', (t) => {
  const current = fixture(t);
  const args = ['-files0-from', '-', '-print0'];
  const input = Buffer.from('tree/foo.txt\0tree/Foo.txt\0tree/foo.txt\0');
  compare(args, current, { env: current.env, input });
  assert.equal(current.calls().length, 0);
});
test('native exec, execdir and output-file actions run exactly once and keep their side effects', (t) => {
  const current = fixture(t), log = join(current.cwd, 'actions.log');
  for (const action of [
    ['-exec', '/usr/bin/bash', '-c', 'printf "%s\\0" "$1" >> "$FIND2FD_ACTION_LOG"', 'fixture', '{}', ';'],
    ['-exec', '/usr/bin/bash', '-c', 'printf "%s\\0" "$@" >> "$FIND2FD_ACTION_LOG"', 'fixture', '{}', '+'],
    ['-execdir', '/usr/bin/bash', '-c', 'printf "%s:%s\\0" "$PWD" "$1" >> "$FIND2FD_ACTION_LOG"', 'fixture', '{}', ';'],
    ['-fprint0', log], ['-fprint', log], ['-fprintf', log, '%p:%f\n'],
  ]) {
    const argv = ['tree', '-type', 'f', ...action], env = { ...current.env, FIND2FD_ACTION_LOG: log };
    writeFileSync(log, '');
    const expected = run('/usr/bin/find', argv, current.cwd, { env }); const expectedSideEffect = readFileSync(log);
    writeFileSync(log, '');
    const before = current.calls().length;
    const actual = run(process.execPath, [INTERNAL, ...argv], current.cwd, { env });
    exact(actual, expected, JSON.stringify(action)); assert.deepEqual(readFileSync(log), expectedSideEffect, 'action byte output and multiplicity');
    assert.equal(current.calls().length, before, 'actions never reach fd qualification');
  }
  t.diagnostic(JSON.stringify({ campaign: 'action-fallback', actualGNUComparisons: 6, ownedSideEffectComparisons: 6, actualFdInvocations: 0 }));
});
test('native delete and failed exec truth values retain GNU side effects and return status', (t) => {
  const current = fixture(t), target = join(current.cwd, 'delete-target');
  writeFileSync(target, 'only owned data\n');
  const expected = run('/usr/bin/find', ['delete-target', '-delete'], current.cwd, { env: current.env });
  assert.equal(existsSync(target), false);
  writeFileSync(target, 'only owned data\n');
  const actual = run(process.execPath, [INTERNAL, 'delete-target', '-delete'], current.cwd, { env: current.env });
  exact(actual, expected, 'owned deletion'); assert.equal(existsSync(target), false);
  for (const argv of [['tree', '-maxdepth', '0', '-exec', '/usr/bin/false', ';', '-o', '-print0'], ['tree', '-maxdepth', '0', '-exec', '/usr/bin/false', '{}', '+']]) compare(argv, current, { env: current.env });
  assert.equal(current.calls().length, 0);
});
