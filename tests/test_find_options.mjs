import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { planFind } from '../src/find-wrapper.mjs';
import { fixture, run } from './helpers.mjs';

const qualified = [[], ['tree'], ['-P', 'tree'], ['tree', '-name', 'foo.txt'], ['tree', '-name', '*'], ['tree', '-name', '*.txt', '-type', 'f'], ['tree', '-type', 'f', '-a', '-name', '*.txt', '-print0'], ['tree', '-mindepth', '1', '-maxdepth', '2', '-type', 'd', '-and', '-print'], ['tree', '-type', 'l'], ['tree', '-type', 'p'], ['tree', '-type', 's'], ['tree', '-type', 'b'], ['tree', '-type', 'c'], ['tree', '-type', 'f', '-type', 'f'], ['tree', '-name', '*txt', '-name', 'f*'], ['tree', 'tree/z-dir', 'tree', '-print0']];
const native = [
  ['-H', 'tree'], ['-L', 'tree'], ['tree/linkdir'], ['tree/foo.txt'], ['missing'],
  ['tree', '-name', ''], ['tree', '-name', 'f?.txt'], ['tree', '-name', '[a-z]*'], ['tree', '-name', '{foo,bar}'], ['tree', '-name', 'foo\\*'], ['tree', '-name', 'dir/*'], ['tree', '-name', 'π*'], ['tree', '-iname', '*.txt'], ['tree', '-path', '*txt'], ['tree', '-regex', '.*txt'],
  ['tree', '-type', 'f', '-type', 'd'], ['tree', '-type', 'x'], ['tree', '-type', 'f,d'],
  ['tree', '-type', 'f', '-o', '-type', 'd'], ['tree', '!', '-type', 'd'], ['tree', '(', '-type', 'f', ')'], ['tree', '-true'], ['tree', '-false'], ['tree', '-depth'], ['tree', '-prune'], ['tree', '-quit'], ['tree', '-delete'], ['tree', '-printf', '%p\n'], ['tree', '-print', '-print0'], ['tree', '-print0', '-name', '*'],
  ['tree', '-name', '*', '-maxdepth', '1'], ['tree', '-mindepth', '-1'], ['tree', '-maxdepth', 'bad'], ['tree', '-maxdepth'], ['tree', '-name'], ['tree', '-unknown'], ['--help'], ['--version'], ['-O2', 'tree'], ['-D', 'tree', 'tree'], ['-files0-from', '-'],
];
function helpOptions(help) {
  const spellings = new Set(help.match(/(?<![A-Za-z0-9_])--?[A-Za-z][A-Za-z0-9_-]*/g));
  spellings.delete('-N'); return spellings;
}
test('the fd qualification boundary accepts only its declared pure conjunction subset', (t) => {
  const current = fixture(t);
  for (const argv of qualified) assert.equal(planFind(argv, { cwd: current.cwd }).backend, 'fd', JSON.stringify(argv));
  for (const argv of native) {
    const planned = planFind(argv, { cwd: current.cwd });
    assert.equal(planned.backend, 'find', JSON.stringify(argv));
    assert.deepEqual(planned.args, argv, 'native fallback keeps exact original argv');
  }
  t.diagnostic(JSON.stringify({ campaign: 'qualification', fdPlans: qualified.length, nativePlans: native.length }));
});
test('the independent inventory classifies every installed GNU help option without executing actions', (t) => {
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
