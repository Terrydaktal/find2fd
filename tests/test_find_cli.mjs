import assert from 'node:assert/strict';
import { chmodSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fixture, compare, ENV } from './helpers.mjs';

const baseCases = [[], ['tree'], ['-P', 'tree'], ['tree', '-print'], ['tree', '-print0'], ['tree', '-name', '*'], ['tree', '-name', '*.txt'], ['tree', '-name', 'foo.txt'], ['tree', '-name', 'missing'], ['tree', '-name', '.hidden*'], ['tree', '-type', 'f'], ['tree', '-type', 'd'], ['tree', '-type', 'l'], ['tree', '-type', 'p'], ['tree', '-type', 's'], ['tree', '-type', 'b'], ['tree', '-type', 'c'], ['tree', '-mindepth', '1', '-maxdepth', '1', '-print0'], ['tree', '-maxdepth', '0'], ['tree/empty'], ['tree', '-maxdepth', '2', '-name', 'target*', '-a', '-type', 'f', '-print0'], ['tree', 'tree', '-name', 'target.txt'], ['tree/z-dir', 'tree', 'tree/z-dir', '-print0'], ['./tree', '-name', '*txt'], ['tree', '-name', '*.txt', '-and', '-name', 'f*', '-type', 'f']];
test('qualified listings preserve GNU exact root, traversal order, spelling, hidden and ignored coverage', (t) => {
  const current = fixture(t);
  for (const argv of baseCases) {
    const before = current.actualSearchCalls(); compare(argv, current, { env: current.env });
    assert.ok(current.actualSearchCalls() > before, `qualified call must execute fd: ${JSON.stringify(argv)}`);
  }
  t.diagnostic(JSON.stringify({ campaign: 'qualified-cli', actualGNUComparisons: baseCases.length, actualFdInvocations: current.actualSearchCalls() }));
});
test('raw filename bytes, newline names and Unicode remain exact in both C and UTF-8 locales', (t) => {
  const current = fixture(t, { rawNames: true }); let comparisons = 0;
  for (const locale of ['C', 'C.UTF-8']) for (const argv of [['tree', '-print0'], ['tree', '-type', 'f', '-name', '*.txt', '-print0'], ['tree', '-name', 'π.txt'], ['tree', '-name', 'line*', '-print0']]) {
    compare(argv, current, { env: { ...ENV, LC_ALL: locale } }); comparisons++;
  }
  t.diagnostic(JSON.stringify({ campaign: 'filename-bytes', actualGNUComparisons: comparisons }));
});
test('native root and traversal failures preserve GNU partial output, diagnostics and status', (t) => {
  const current = fixture(t, { cycle: true });
  const locked = join(current.cwd, 'tree/unreadable'); mkdirSync(locked); chmodSync(locked, 0);
  try {
    for (const argv of [['missing'], ['missing', 'tree/foo.txt', '-print0'], ['tree/foo.txt'], ['-P', 'tree/linkdir', '-print0'], ['-H', 'tree/linkdir', '-maxdepth', '1', '-print0'], ['-L', 'tree', '-name', 'target.txt'], ['tree/unreadable', '-print0'], ['tree', '-name', '*', '-maxdepth', '1']]) compare(argv, current, { env: current.env });
  } finally { chmodSync(locked, 0o700); }
});
test('globals, lexical failures and GNU help/version retain their original diagnostics', (t) => {
  const current = fixture(t);
  for (const argv of [['tree///', '-name', '*txt'], ['tree/.', '-type', 'd'], ['--help'], ['--version'], ['tree', '-name'], ['tree', '-type'], ['tree', '-maxdepth', '-1'], ['tree', '-unknown'], ['tree', '(', '-name', 'foo.txt'], ['tree', '-name', '*', '-o'], ['tree', '-name', '*', '-maxdepth', '1']]) compare(argv, current);
});
