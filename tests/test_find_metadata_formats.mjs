import test from 'node:test';
import { metadataFixture } from './find_metadata_helpers.mjs';

test('fd traversal preserves GNU context independent printf directives and byte formatting', (t) => {
  const current = metadataFixture(t);
  const formats = [
    '%p\\0', '%f|%h|%s|%b|%k|%S\\n', '%m|%M|%i|%n|%u|%U|%g|%G\\n',
    '%y|%Y|%l|%F\\0', '%a|%A@|%c|%C@|%t|%T@\\n', '%AY-%Am-%Ad %AH:%AM:%AS\\n',
    '[%20p][%-20f][%.2p][%04m][%#m][%8s]\\n',
    '\\a\\b\\f\\n\\r\\t\\v\\\\\\000%p\\0', 'literal%%/%p\\cignored-%p',
  ];
  for (const format of formats) current.compareMetadata(['tree', ...(/%A|%a/.test(format) ? ['-type', 'f'] : []), '-printf', format]);
  for (const expression of [
    ['-type', 'l', '-printf', '%p:%y:%Y:%l\\0'],
    ['-printf', '%p\\0', '-a', '-false', '-o', '-printf', '%m\\n'],
    ['-false', '-a', '-printf', 'UNREACHABLE', '-o', '-printf', '%f\\n'],
    ['-printf', '%s:', ',', '-print0', ',', '-printf', '%M\\n'],
    ['(', '-size', '+0c', '-a', '-printf', '%n/%s/%p\\0', ')', '-o', '-printf', 'EMPTY:%p\\n'],
    ['-ls'], ['-name', '*.txt', '-ls'],
  ]) current.compareMetadata(['tree', ...expression]);
  t.diagnostic(JSON.stringify(current.diagnostics('metadata-format-independent-context')));
});

test('fd traversal preserves original GNU printf root, relative path and depth context', (t) => {
  const current = metadataFixture(t);
  const roots = [['tree'], ['tree/'], ['./tree'], ['.'], ['tree', 'tree/z-dir'], ['tree', 'tree']];
  const formats = ['[%H][%P][%d][%p]\\0', '[%12H][%-12P][%+04d][%.2H][%.3P][%.d][%.H][%.P]\\n', '\\045H|\\045P|\\045d|%%H|%%P|%%d|%H|%P|%d\\n'];
  for (const paths of roots) for (const format of formats) current.compareMetadata([...paths, '-printf', format]);
  for (const expression of [
    ['-printf', '%H/%P/%d\\0', ',', '-printf', '%d:%p\\n'],
    ['-false', '-a', '-printf', '%H/%P/%d', '-o', '-printf', '%d:%P\\0'],
    ['-printf', 'START\\c%H/%P/%d'],
  ]) current.compareMetadata(['tree', ...expression]);
  t.diagnostic(JSON.stringify(current.diagnostics('metadata-format-starting-context')));
});
