// Generated argv is judged only by real GNU find and the public CLI. The
// generator has no predicate evaluator and imports no production parser.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { digest, fixture, PUBLIC } from './helpers.mjs';

const deep = process.env.FIND2FD_DEEP === '1';
const target = deep ? 1536 : 512, seed = 0x6a29fd37, concurrency = 8;
const names = ['*', '*.txt', '*txt', 'foo.txt', 'Foo.txt', 'target*', '.hidden*', '.git*', '*dir', 'tree', '.', 'nothing', 'space*', 'literal*', '-hyphen*', 'line\n*', 'link*', 'pipe', 'socket', 'dangling', '*.none', '*a*'];
const types = ['f', 'd', 'l', 'p', 's', 'b', 'c'];
const depths = [[], ['-maxdepth', '0'], ['-maxdepth', '1'], ['-maxdepth', '3'], ['-mindepth', '1'], ['-mindepth', '1', '-maxdepth', '2'], ['-mindepth', '2', '-maxdepth', '3']];
const operators = { and: [null, '-a', '-and'], or: ['-o', '-or'], comma: [','] };

function randomSource() {
  let state = seed;
  return (limit) => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return (state >>> 0) % limit;
  };
}

function cases(cwd) {
  const random = randomSource(), pick = (values) => values[random(values.length)];
  const roots = [['tree'], ['./tree'], ['tree/'], ['.'], ['./'], ['tree/z-dir'], ['tree', 'tree'], ['tree/z-dir', 'tree', 'tree/z-dir'], [join(cwd, 'tree')], ['tree', 'tree/a-dir']];
  const paths = ['*', 'tree', 'tree/*', 'tree/*/target.txt', '*z-dir*', '*/.git/*', './tree/*', '*/foo.txt', '*/line\n*', '*/*dir/*', 'nothing', join(cwd, 'tree') + '/*'];
  const special = () => pick([
    ['-iname', pick(['*.TXT', 'FOO.TXT', '*TARGET*', 'K.TXT', 'I.TXT', 'TREE', '.*'])],
    [pick(['-ipath', '-iwholename']), pick(paths).toUpperCase()],
    ['-name', pick(['?oo.txt', '??.txt', '*.t?t', 'literal?1?.txt', '*?*', '?', '*.???'])],
    ['-path', pick(['tree/?-dir/*', '*/??.txt', 'tree/?.txt', '*?*'])],
  ]);
  const leaf = (byteMatching) => {
    const kind = random(byteMatching ? 7 : 6);
    if (kind === 0) return { kind: 'leaf', argv: ['-name', pick(names)] };
    if (kind === 1) return { kind: 'leaf', argv: [pick(['-path', '-wholename']), pick(paths)] };
    if (kind === 2) return { kind: 'leaf', argv: ['-type', pick(types)] };
    if (kind === 3) return { kind: 'leaf', argv: [pick(['-true', '-false'])] };
    if (kind === 4) return { kind: 'leaf', argv: ['-print'] };
    if (kind === 5) return { kind: 'leaf', argv: ['-print0'] };
    return { kind: 'leaf', argv: special() };
  };
  const expression = (depth, byteMatching) => {
    if (!depth || random(100) < 28) return leaf(byteMatching);
    if (random(100) < 24) return { kind: 'not', operator: pick(['!', '-not']), child: expression(depth - 1, byteMatching) };
    return { kind: pick(['and', 'or', 'comma']), left: expression(depth - 1, byteMatching), right: expression(depth - 1, byteMatching), grouped: random(2) === 0 };
  };
  const serialize = (node) => {
    if (node.kind === 'leaf') return node.argv;
    if (node.kind === 'not') return [node.operator, '(', ...serialize(node.child), ')'];
    const operator = pick(operators[node.kind]);
    const argv = [...serialize(node.left), ...(operator ? [operator] : []), ...serialize(node.right)];
    return node.grouped ? ['(', ...argv, ')'] : argv;
  };
  const result = [], seen = new Set();
  const add = (argv, locale, family) => {
    const identity = JSON.stringify([locale, argv]);
    if (seen.has(identity)) return false;
    seen.add(identity); result.push({ index: result.length, argv, locale, family }); return true;
  };
  // The same insensitive-free expression runs in both locales. The separate
  // C-only corpus always includes an insensitive or question-byte predicate.
  const pairedTarget = target * 3 / 4;
  for (let attempts = 0; result.length < pairedTarget && attempts < target * 20; attempts++) {
    const argv = [...pick(roots), ...pick(depths), ...serialize(expression(2 + random(deep ? 4 : 3), false))];
    if (!seen.has(JSON.stringify(['C', argv])) && !seen.has(JSON.stringify(['C.UTF-8', argv]))) {
      add(argv, 'C', 'paired'); add(argv, 'C.UTF-8', 'paired');
    }
  }
  assert.equal(result.length, pairedTarget, 'bounded generator must fill the paired corpus');
  for (let attempts = 0; result.length < target && attempts < target * 20; attempts++) {
    const required = { kind: 'leaf', argv: special() };
    const ast = { kind: pick(['and', 'or', 'comma']), left: random(2) ? { kind: 'not', operator: '!', child: required } : required, right: expression(2 + random(deep ? 4 : 3), true), grouped: random(2) === 0 };
    add([...pick(roots), ...pick(depths), ...serialize(ast)], 'C', 'byte-matching');
  }
  assert.equal(result.length, target, 'bounded generator must fill the C-only corpus');
  return result;
}

function command(program, argv, cwd, env, argv0) {
  return new Promise((done) => {
    const child = spawn(program, argv, { cwd, env, argv0, stdio: ['ignore', 'pipe', 'pipe'] });
    const output = [], errors = []; let failure, bytes = 0, escalation;
    const abort = (reason) => {
      if (failure) return;
      failure = reason; child.kill('SIGTERM');
      escalation = setTimeout(() => child.kill('SIGKILL'), 500);
    };
    const timeout = setTimeout(() => abort('deadline'), 15000);
    const collect = (buffers) => (data) => {
      bytes += data.length;
      if (bytes > 4 * 1024 * 1024) abort('output cap'); else buffers.push(data);
    };
    child.stdout.on('data', collect(output)); child.stderr.on('data', collect(errors));
    child.once('error', (error) => { failure = error.code ?? error.message; });
    child.once('close', (status, signal) => {
      clearTimeout(timeout); clearTimeout(escalation);
      done({ status, signal, failure, stdout: Buffer.concat(output), stderr: Buffer.concat(errors) });
    });
  });
}

test(`generated pure-expression public CLI campaign (${target} distinct locale/argv cases)`, { timeout: deep ? 360000 : 120000 }, async (t) => {
  const current = fixture(t, { rawNames: true });
  for (const name of ['tree/a', 'tree/ab', 'tree/.dot', 'tree/i.txt', 'tree/I.txt', 'tree/K.txt', 'tree/K.txt', 'tree/İ.txt', 'tree/ſ.txt']) current.put(name);
  const items = cases(current.cwd), failures = [], locales = {};
  let next = 0, completed = 0, mismatches = 0, expectedFdInvocations = 0, nonemptyGNUResults = 0;
  const distinctArgv = new Set(), spellings = new Set();
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < items.length) {
      const item = items[next++], env = { ...current.env, LC_ALL: item.locale, LANG: item.locale };
      const firstExpression = item.argv.findIndex((arg) => arg.startsWith('-') || ['!', '(', ')', ','].includes(arg));
      expectedFdInvocations += firstExpression < 0 ? item.argv.length : firstExpression;
      locales[item.locale] = (locales[item.locale] ?? 0) + 1;
      distinctArgv.add(JSON.stringify(item.argv));
      for (const arg of item.argv) if (arg.startsWith('-') || ['!', '(', ')', ','].includes(arg)) spellings.add(arg);
      const [expected, actual] = await Promise.all([
        command('/usr/bin/find', item.argv, current.cwd, env, 'find'),
        command(PUBLIC, item.argv, current.cwd, env),
      ]);
      if (expected.stdout.length) nonemptyGNUResults++;
      if (actual.failure || expected.failure || actual.signal || expected.signal || actual.status !== expected.status || !actual.stdout.equals(expected.stdout) || !actual.stderr.equals(expected.stderr)) {
        mismatches++;
        if (failures.length < 10) failures.push({ seed: `0x${seed.toString(16)}`, ...item, expected: { ...expected, stdout: digest(expected.stdout), stderr: digest(expected.stderr) }, actual: { ...actual, stdout: digest(actual.stdout), stderr: digest(actual.stderr) } });
      }
      completed++;
    }
  }));
  const calls = current.calls(), actualFdInvocations = current.actualSearchCalls(), actualNativeInvocations = current.nativeCalls().length;
  const sourceHash = (name) => createHash('sha256').update(readFileSync(new URL(name, import.meta.url))).digest('hex');
  t.diagnostic(JSON.stringify({ campaign: 'generated-expression-cli', seed: `0x${seed.toString(16)}`, deep, concurrency, fixtureSourceSHA256: sourceHash('./helpers.mjs'), campaignSourceSHA256: sourceHash('./test_find_expression_campaign.mjs'), actualGNUComparisons: completed, distinctLocaleArgvCases: items.length, distinctArgvCases: distinctArgv.size, casesPerLocale: locales, pairedComparisons: target * 3 / 4, COnlyByteMatchingComparisons: target / 4, rawFilenameBytes: true, publicCLI: true, actualFdInvocations, expectedFdInvocations, actualNativeInvocations, qualifiedRuntimeFallbacks: actualNativeInvocations, globPushdownInvocations: calls.filter((argv) => argv.includes('--glob')).length, typePushdownInvocations: calls.filter((argv) => argv.includes('--type')).length, nonemptyGNUResults, expressionSpellings: [...spellings].sort(), mismatches }));
  assert.equal(completed, target);
  assert.equal(actualNativeInvocations, 0, 'every generated pure expression must actually finish through fd');
  assert.equal(actualFdInvocations, expectedFdInvocations, 'every original directory root must execute one real fd search');
  assert.equal(mismatches, 0, JSON.stringify(failures, null, 2));
  assert.ok(nonemptyGNUResults > target / 4, 'the corpus must exercise successful output as well as false branches');
  assert.ok(calls.some((argv) => argv.includes('--glob')) && calls.some((argv) => argv.includes('--type')), 'generated expressions must exercise both positive pushdown forms');
});
