import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { metadataFixture } from './find_metadata_helpers.mjs';

test('fd traversal preserves GNU depth ordering, bounds and overlapping root multiplicity', (t) => {
  const current = metadataFixture(t);
  const cases = [
    ['tree', '-depth', '-print0'], ['tree', '-depth', '-type', 'd', '-print0'],
    ['tree', '-depth', '-mindepth', '1', '-maxdepth', '2', '-printf', '%p\\0'],
    ['tree', '-mindepth', '1', '-maxdepth', '2', '-depth', '-size', '+0c', '-print0'],
    ['tree', '-xdev', '-print0'], ['tree', '-mount', '-type', 'f', '-printf', '%p\\0'],
    ['tree', '-noleaf', '-empty', '-print0'],
    ['tree', 'tree/z-dir', 'tree', '-depth', '-printf', '%p\\0'],
  ];
  for (const argv of cases) current.compareMetadata(argv);
  t.diagnostic(JSON.stringify(current.diagnostics('metadata-traversal-depth')));
});

test('fd follow and command-line-follow modes preserve GNU symlink evaluation policy', (t) => {
  const current = metadataFixture(t);
  const cases = [
    ['-H', 'tree', '-type', 'l', '-print0'], ['-H', 'tree', '-xtype', 'f', '-printf', '%p\\0'],
    ['-H', 'tree/linkdir', '-type', 'd', '-print0'], ['-H', 'tree/linkdir', '-type', 'f', '-print0'],
    ['-L', 'tree', '-type', 'f', '-print0'], ['-L', 'tree', '-xtype', 'l', '-print0'],
    ['-L', 'tree', '-printf', '%p:%y:%Y:%l\\0'],
    ['tree', '-follow', '-type', 'f', '-print0'],
    ['-L', 'tree/linkdir', 'tree', '-depth', '-type', 'f', '-print0'],
  ];
  for (const argv of cases) current.compareMetadata(argv);
  t.diagnostic(JSON.stringify(current.diagnostics('metadata-traversal-follow')));
});

test('observed logical cross-filesystem boundary retains GNU expression-dependent behavior', (t) => {
  const current = metadataFixture(t);
  const other = mkdtempSync('/dev/shm/find2fd-xdev-');
  t.after(() => rmSync(other, { recursive: true, force: true }));
  writeFileSync(join(other, 'owned-other-filesystem'), 'synthetic\n');
  assert.notEqual(statSync(other).dev, statSync(join(current.cwd, 'tree')).dev, 'Linux test requires distinct /dev/shm filesystem');
  symlinkSync(other, join(current.cwd, 'tree/cross-filesystem'));
  current.compareMetadata(['-L', 'tree', '-xdev', '-print0'], { accelerated: false, fallbackAfterFd: true });
  current.compareMetadata(['-L', 'tree', '-mount', '-type', 'd', '-printf', '%p\\0'], { accelerated: false, fallbackAfterFd: true });
  t.diagnostic(JSON.stringify(current.diagnostics('metadata-traversal-filesystem-boundary')));
});
