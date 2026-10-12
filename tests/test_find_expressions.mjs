// GNU find itself is the independent oracle. Every declared fast case must
// execute a real fd search and finish without a native fallback.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { planFind } from '../src/find-wrapper.mjs';
import { compare, fixture } from './helpers.mjs';

const expressions = [
  ['-true'], ['-false'], ['!', '-true'], ['-not', '-false'], ['!', '!', '-type', 'f'],
  ['-true', '-a', '-false', '-o', '-true'], ['-false', '-or', '-true', '-and', '-false'],
  ['(', '-false', '-o', '-true', ')', '-a', '-false'], ['-false', ',', '-true'],
  ['-name', 'foo.txt', '-o', '-name', 'Foo.txt'],
  ['-name', 'foo.txt', '-o', '-type', 'd', '-name', 'a-dir'],
  ['(', '-name', 'foo.txt', '-o', '-name', 'Foo.txt', ')', '-type', 'f'],
  ['-not', '(', '-type', 'd', '-o', '-name', 'foo.txt', ')'],
  ['-type', 'f', '-type', 'd'], ['-type', 'f', '-o', '-type', 'd'],
  ['-type', 'l', '-or', '-type', 'p', '-or', '-type', 's'],
  ['!', '-type', 'f', '-a', '!', '-type', 'd'],
  ['-print0', '-print'], ['-print', '-print0', '-print'],
  ['-false', '-a', '-print0'], ['-true', '-o', '-print0'],
  ['-false', '-o', '-print0'], ['-print0', '-a', '-false'], ['-print0', '-o', '-print'],
  ['-name', 'foo.txt', '-o', '-print0'], ['-name', 'foo.txt', '-print0', '-o', '-name', 'Foo.txt', '-print'],
  ['(', '-name', 'foo.txt', '-o', '-name', 'Foo.txt', ')', '-a', '-print0'],
  ['-name', 'foo.txt', '-print0', ',', '-name', 'Foo.txt', '-print'],
  ['-print0', ',', '-false'], ['!', '-print0'], ['-print0', '-name', 'foo.txt'],
  ['-path', 'tree'], ['-path', 'tree/*'], ['-path', 'tree/*/target.txt'],
  ['-path', 'tree/z-dir/*'], ['-wholename', 'tree/*/target.txt'],
  ['-name', 'target.txt', '-o', '-path', 'tree/a-dir'],
  ['!', '-path', 'tree/z-dir*'], ['(', '-path', 'tree/*/target.txt', '-o', '-name', 'foo.txt', ')', '-print0'],
];
function accelerated(argv, current, env = current.env) {
  const keys = ['LC_ALL', 'LC_CTYPE', 'LANG', 'FIND2FD_EXPERIMENTAL_FD'], previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) { if (env[key] === undefined) delete process.env[key]; else process.env[key] = env[key]; }
  try { assert.equal(planFind(argv, { cwd: current.cwd }).backend, 'fd', `declared expression qualification: ${JSON.stringify(argv)}`); }
  finally { for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; } }
  const beforeFd = current.actualSearchCalls(), beforeNative = current.nativeCalls().length;
  compare(argv, current, { env });
  assert.ok(current.actualSearchCalls() > beforeFd, `actual fd execution: ${JSON.stringify(argv)}`);
  assert.equal(current.nativeCalls().length, beforeNative, `ordinary qualified expression completed through fd: ${JSON.stringify(argv)}`);
}

test('boolean operators, arbitrary print actions and pathname tests retain exact GNU expression semantics through fd', (t) => {
  const current = fixture(t, { rawNames: true }); let comparisons = 0;
  for (const expression of expressions) { accelerated(['tree', ...expression], current); comparisons++; }
  const roots = [
    ['tree', 'tree', '-name', 'foo.txt', '-print0', '-print'],
    ['tree/z-dir', 'tree', 'tree/z-dir', '!', '-type', 'd', '-print0'],
    ['./tree', '-path', './tree/*/target.txt', '-print0'],
    [join(current.cwd, 'tree'), '-path', join(current.cwd, 'tree') + '/*/target.txt', '-print0'],
    ['tree', '-maxdepth', '0', '-true', '-print0', '-print'],
    ['tree', '-mindepth', '1', '-maxdepth', '2', '(', '-type', 'd', '-o', '-name', 'target.txt', ')', '-print0'],
  ];
  for (const argv of roots) { accelerated(argv, current); comparisons++; }
  t.diagnostic(JSON.stringify({ campaign: 'expanded-expressions', actualGNUComparisons: comparisons, actualFdInvocations: current.actualSearchCalls(), actualNativeInvocations: current.nativeCalls().length, rawFilenameBytes: true }));
});

test('bounded expression complexity falls back intact instead of weakening GNU semantics', (t) => {
  const current = fixture(t);
  const cases = [Array.from({ length: 300 }, () => '-true'), [...Array(70).fill('('), '-name', 'foo.txt', ...Array(70).fill(')'), '-print0'], ['-name', 'x'.repeat(8193), '-print0']];
  for (const expression of cases) compare(['tree', ...expression], current, { env: current.env });
  assert.equal(current.actualSearchCalls(), 0);
  assert.equal(current.nativeCalls().length, cases.length);
});

test('name/type candidate pushdown never drops invalid UTF-8 filenames matched by GNU stars', (t) => {
  const current = fixture(t); mkdirSync(join(current.cwd, 'raw'));
  writeFileSync(Buffer.concat([Buffer.from(current.cwd + '/raw/'), Buffer.from([255, 254]), Buffer.from('.txt')]), 'synthetic\n');
  current.put('raw/ascii.txt'); current.put('raw/π.txt'); let comparisons = 0;
  for (const locale of ['C', 'C.UTF-8']) for (const expression of [
    ['-name', '*.txt', '-type', 'f'],
    ['(', '-name', '*txt', '-o', '-name', '*.other', ')', '-type', 'f'],
    ['-name', '*', '-type', 'f'],
  ]) { accelerated(['raw', ...expression, '-print0'], current, { ...current.env, LC_ALL: locale }); comparisons++; }
  accelerated(['raw', '-iname', '*.TXT', '-type', 'f', '-print0'], current); comparisons++;
  t.diagnostic(JSON.stringify({ campaign: 'candidate-raw-byte-regression', actualGNUComparisons: comparisons, actualFdInvocations: current.actualSearchCalls(), actualNativeInvocations: current.nativeCalls().length }));
});

test('formatted output record limits fall back before publishing repeated print effects', (t) => {
  const current = fixture(t); mkdirSync(join(current.cwd, 'many'));
  for (let index = 0; index < 1200; index++) current.put('many/' + index, '');
  const argv = ['many', ...Array(100).fill('-print0')];
  compare(argv, current, { env: current.env, timeout: 15000 });
  assert.ok(current.actualSearchCalls() > 0, 'the fd formatter boundary was exercised');
  assert.equal(current.nativeCalls().length, 1, 'one intact GNU call owns all output after the bound');
});

test('C locale question wildcards and insensitive name/path aliases preserve GNU byte matching through fd', (t) => {
  const current = fixture(t, { rawNames: true });
  const cases = [
    ['-name', '?oo.txt'], ['-name', 'literal?1?.txt'], ['-name', '??.txt'],
    ['-path', 'tree/?-dir/target.txt'], ['-iname', 'FOO.TXT'], ['-iname', '*TARGET*'],
    ['-ipath', 'TREE/*/TARGET.TXT'], ['-iwholename', 'TREE/*/TARGET.TXT'],
    ['!', '-iname', 'FOO.TXT'], ['(', '-iname', 'foo.txt', '-o', '-ipath', 'TREE/*/TARGET.TXT', ')', '-print0'],
  ];
  for (const expression of cases) accelerated(['tree', ...expression], current);
  const locales = [{ LC_ALL: 'POSIX' }, { LC_ALL: '', LC_CTYPE: 'C', LANG: 'C.UTF-8' }, { LC_ALL: 'C', LC_CTYPE: 'C.UTF-8' }];
  for (const locale of locales) for (const expression of [['-iname', 'FOO.TXT'], ['-name', '?oo.txt']]) accelerated(['tree', ...expression], current, { ...current.env, ...locale });
  t.diagnostic(JSON.stringify({ campaign: 'expanded-C-matching', actualGNUComparisons: cases.length + locales.length * 2, actualFdInvocations: current.actualSearchCalls(), actualNativeInvocations: current.nativeCalls().length, locale: 'C/POSIX including LC_ALL/LC_CTYPE/LANG precedence' }));
});

test('locale-sensitive expressions and arbitrary glob syntax use GNU predicates after real fd discovery', (t) => {
  const current = fixture(t, { rawNames: true });
  for (const name of ['K.txt', 'İ.txt', 'ı.txt', 'K.txt', '{foo,bar}.txt']) current.put('tree/' + name);
  let comparisons = 0;
  for (const locale of ['C', 'C.UTF-8']) for (const expression of [
    ['-name', '[fF]oo.txt'], ['-name', '{foo,bar}.txt'], ['-name', 'literal\\*.txt'],
  ]) { compare(['tree', ...expression, '-print0'], current, { env: { ...current.env, LC_ALL: locale } }); comparisons++; }
  const nativeBefore = current.nativeCalls().length, fdBefore = current.actualSearchCalls();
  for (const expression of [['-iname', 'k.txt'], ['-iname', 'i.txt'], ['-ipath', 'TREE/*.TXT'], ['-iwholename', 'TREE/*.TXT'], ['-name', '?.txt'], ['-path', 'tree/?.txt']]) {
    compare(['tree', ...expression, '-print0'], current, { env: { ...current.env, LC_ALL: 'C.UTF-8' } }); comparisons++;
  }
  for (const locale of [{ LC_ALL: 'C.UTF-8', LC_CTYPE: 'C' }, { LC_ALL: '', LC_CTYPE: 'C.UTF-8', LANG: 'C' }, { LC_ALL: '', LC_CTYPE: '', LANG: 'C.UTF-8' }]) {
    compare(['tree', '-iname', 'k.txt', '-print0'], current, { env: { ...current.env, ...locale } }); comparisons++;
  }
  assert.equal(current.actualSearchCalls() - fdBefore, 9, 'locale-sensitive UTF-8 calls perform actual fd discovery');
  const calls = current.nativeCalls().slice(nativeBefore);
  assert.equal(calls.filter((args) => args.includes('/proc/self/fd/3')).length, 9, 'GNU evaluates only nonrecursive fd candidates');
  assert.equal(calls.filter((args) => !args.includes('/proc/self/fd/3') && !args.includes('/dev/null')).length, 0, 'no original recursive GNU fallback');
  t.diagnostic(JSON.stringify({ campaign: 'expression-native-boundaries', actualGNUComparisons: comparisons, actualFdInvocations: current.actualSearchCalls(), actualNativeInvocations: current.nativeCalls().length }));
});

test('malformed grouping, operators and action operands preserve original GNU diagnostics before fd', (t) => {
  const current = fixture(t);
  const cases = [['('], [')'], ['(', ')'], ['(', '-true'], ['-true', ')'], ['!'], ['-not'], ['-a', '-true'], ['-true', '-a'], ['-true', '-o'], [',', '-true'], ['-true', ','], ['-true', '-or', '-and', '-false'], ['-print0', '-name'], ['-name', 'foo.txt', '-maxdepth', '1'], ['-true', '-printf'], ['-print0', '-unknown']];
  for (const expression of cases) compare(['tree', ...expression], current, { env: current.env });
  assert.equal(current.actualSearchCalls(), 0, 'invalid syntax and global-option warnings must remain native');
  t.diagnostic(JSON.stringify({ campaign: 'expression-errors', actualGNUComparisons: cases.length, actualNativeInvocations: current.nativeCalls().length, actualFdInvocations: 0 }));
});

test('trailing-slash path aliases preserve GNU root-dependent warnings before fd', (t) => {
  const current = fixture(t), cases = [];
  for (const flag of ['-path', '-wholename', '-ipath', '-iwholename']) {
    const pattern = ['-ipath', '-iwholename'].includes(flag) ? 'TREE/' : 'tree/';
    for (const root of ['tree', 'tree/']) cases.push([root, flag, pattern, '-print0']);
  }
  cases.push(['tree', '-path', '/', '-print0']);
  cases.push(['tree', '-true', '-o', '-path', 'tree/', '-print0']);
  cases.push(['tree/', '-path', '*/', '-print0']);
  let comparisons = 0, warnings = 0, withoutWarnings = 0;
  for (const locale of ['C', 'C.UTF-8']) for (const argv of cases) {
    const beforeNative = current.nativeCalls().length;
    const actual = compare(argv, current, { env: { ...current.env, LC_ALL: locale } });
    assert.equal(current.nativeCalls().length, beforeNative + 1, 'GNU must own the original argv and parse-time diagnostic');
    if (actual.stderr.length) warnings++; else withoutWarnings++;
    comparisons++;
  }
  assert.equal(current.actualSearchCalls(), 0, 'trailing-slash diagnostics remain native before candidate enumeration');
  assert.ok(warnings > 0 && withoutWarnings > 0, 'both warning and matching-root exceptions must be exercised');
  t.diagnostic(JSON.stringify({ campaign: 'trailing-slash-path-diagnostics', actualGNUComparisons: comparisons, actualNativeInvocations: current.nativeCalls().length, actualFdInvocations: 0, warningCases: warnings, matchingRootCasesWithoutWarnings: withoutWarnings }));
});
