import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { planFind, withFindWrapper } from '../src/find-wrapper.mjs';
import { PUBLIC, exact, fixture, run } from './helpers.mjs';

const qualified = [[], ['tree'], ['-P', 'tree'], ['tree', '-name', 'foo.txt'], ['tree', '-name', '*'], ['tree', '-name', '*.txt', '-type', 'f'], ['tree', '-type', 'f', '-a', '-name', '*.txt', '-print0'], ['tree', '-mindepth', '1', '-maxdepth', '2', '-type', 'd', '-and', '-print'], ['tree', '-type', 'l'], ['tree', '-type', 'p'], ['tree', '-type', 's'], ['tree', '-type', 'b'], ['tree', '-type', 'c'], ['tree', '-type', 'f', '-type', 'f'], ['tree', '-name', '*txt', '-name', 'f*'], ['tree', 'tree/z-dir', 'tree', '-print0'], ['tree', '-type', 'f', '-type', 'd'], ['tree', '-type', 'f', '-o', '-type', 'd'], ['tree', '!', '-type', 'd'], ['tree', '(', '-type', 'f', ')'], ['tree', '-true'], ['tree', '-false'], ['tree', '-print', '-print0'], ['tree', '-print0', '-name', '*'], ['tree', '-iname', '*.txt'], ['tree', '-path', '*txt'], ['tree', '-name', 'f?.txt']];
const native = [
  ['missing'], ['tree', '-type', 'x'],
  ['tree', '-prune'], ['tree', '-quit'], ['tree', '-delete'],
  ['tree', '-name', '*', '-maxdepth', '1'], ['tree', '-mindepth', '-1'], ['tree', '-maxdepth', 'bad'], ['tree', '-maxdepth'], ['tree', '-name'], ['tree', '-unknown'], ['--help'], ['--version'], ['-D', 'tree', 'tree'], ['-files0-from', '-'],
];
const brokerQualified = [
  ['tree/linkdir'], ['tree/foo.txt'],
  ['-H', 'tree'], ['-L', 'tree'], ['-O2', 'tree'], ['tree', '-depth'],
  ['tree', '-name', ''], ['tree', '-name', '[a-z]*'], ['tree', '-name', '{foo,bar}'],
  ['tree', '-name', 'foo\\*'], ['tree', '-name', 'dir/*'], ['tree', '-name', 'π*'],
  ['tree', '-regex', '.*txt'], ['tree', '-type', 'f,d'], ['tree', '-printf', '%p\n'],
  ['tree', '-size', '+0c'], ['tree', '-perm', '-0400'], ['tree', '-xdev', '-uid', String(process.getuid())],
  ['tree', '-maxdepth', '8', '-prune'], ['tree', '-maxdepth', '8', '-quit'],
];
function helpOptions(help) {
  const spellings = new Set(help.match(/(?<![A-Za-z0-9_])--?[A-Za-z][A-Za-z0-9_-]*/g));
  spellings.delete('-N'); return spellings;
}
function cLocale(t) {
  const previous = process.env.LC_ALL; process.env.LC_ALL = 'C';
  const previousExperiment = process.env.FIND2FD_EXPERIMENTAL_FD; process.env.FIND2FD_EXPERIMENTAL_FD = '1';
  t.after(() => { if (previous === undefined) delete process.env.LC_ALL; else process.env.LC_ALL = previous; });
  t.after(() => { if (previousExperiment === undefined) delete process.env.FIND2FD_EXPERIMENTAL_FD; else process.env.FIND2FD_EXPERIMENTAL_FD = previousExperiment; });
}
test('the fd qualification boundary accepts its declared pure expression subset and retains unsupported GNU argv', (t) => {
  cLocale(t);
  const current = fixture(t);
  for (const argv of [...qualified, ...brokerQualified]) assert.equal(planFind(argv, { cwd: current.cwd }).backend, 'fd', JSON.stringify(argv));
  for (const argv of native) {
    const planned = planFind(argv, { cwd: current.cwd });
    assert.equal(planned.backend, 'find', JSON.stringify(argv));
    assert.deepEqual(planned.args, argv, 'native fallback keeps exact original argv');
  }
  t.diagnostic(JSON.stringify({ campaign: 'qualification', fdPlans: qualified.length + brokerQualified.length, nativePlans: native.length }));
});
test('the independent inventory classifies every installed GNU help option without executing actions', (t) => {
  cLocale(t);
  const current = fixture(t);
  const inventory = JSON.parse(readFileSync(new URL('./find_option_inventory.json', import.meta.url)));
  const help = run('/usr/bin/find', ['--help'], current.cwd).stdout.toString();
  const declared = new Set([...inventory.options, ...inventory.operators].map(({ spelling }) => spelling));
  const spellings = helpOptions(help);
  for (const spelling of spellings) assert.ok(declared.has(spelling), `GNU help option lacks classification: ${spelling}`);
  for (const entry of [...inventory.options, ...inventory.operators]) {
    assert.ok(entry.contract.length > 10, `behavior contract: ${entry.spelling}`);
    const plan = planFind(entry.argv, { cwd: current.cwd });
    assert.equal(plan.backend, entry.classification === 'qualified' ? 'fd' : 'find', entry.spelling);
    if (plan.backend === 'find') assert.deepEqual(plan.args, entry.argv, entry.spelling);
  }
  t.diagnostic(JSON.stringify({ campaign: 'option-inventory', GNUHelpOptionSpellings: spellings.size, classifiedOptionsAndOperators: declared.size }));
});
test('GNU help prose with bug-reporting and an email address cannot invent option spellings', () => {
  const prose = "Use '-D help' for a description of the options. GNU findutils bug-reporting page; send email to <bug-findutils@gnu.org>. --help displays usage.";
  assert.deepEqual([...helpOptions(prose)].sort(), ['--help', '-D']);
});

test('documented depth, help and version aliases preserve actual GNU execution in public and private routes', (t) => {
  cLocale(t);
  const current = fixture(t);
  const inventory = JSON.parse(readFileSync(new URL('./find_option_inventory.json', import.meta.url)));
  const aliases = ['-d', '-help', '-version'].map((spelling) => {
    const entry = inventory.options.find((option) => option.spelling === spelling);
    assert.ok(entry, `documented alias inventory: ${spelling}`);
    assert.equal(entry.classification, 'native');
    return entry;
  });
  const depth = run('/usr/bin/find', ['tree', '-depth', '-print0'], current.cwd, { env: current.env });
  assert.equal(depth.status, 0);
  let comparisons = 0;
  for (const entry of aliases) for (const route of ['public', 'private']) {
    const before = current.nativeCalls().length;
    const expected = run('/usr/bin/find', entry.argv, current.cwd, { env: current.env });
    const actual = route === 'public' ? run(PUBLIC, entry.argv, current.cwd, { env: current.env })
      : run('/usr/bin/bash', ['--noprofile', '--norc', '-c',
        withFindWrapper({ command: 'find "$@"' }, '/usr/bin/bash').command,
        'owned-find-alias-test', ...entry.argv], current.cwd, { env: current.env });
    exact(actual, expected, `${entry.spelling} ${route}`);
    assert.equal(expected.status, 0);
    assert.ok(expected.stdout.length > 0, 'the alias oracle must actually produce its documented output');
    if (entry.spelling === '-d') assert.deepEqual(expected.stdout, depth.stdout, 'GNU alias preserves depth traversal order');
    assert.deepEqual(current.nativeCalls().slice(before), [entry.argv], 'native GNU receives exact alias argv');
    comparisons++;
  }
  assert.equal(current.actualSearchCalls(), 0, 'native aliases must not receive fd acceleration credit');
  t.diagnostic(JSON.stringify({ campaign: 'documented-GNU-aliases', actualGNUComparisons: comparisons,
    actualOriginalGNUInvocations: current.nativeCalls().length, actualFdInvocations: 0,
    separateDepthAliasOracle: 1, documentedAliases: aliases.map(({ spelling }) => spelling), CLIEntryRoutes: 2 }));
});
