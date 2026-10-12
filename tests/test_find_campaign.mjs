// Finite deterministic full-CLI comparisons; never a claim about all GNU argv.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { planFind } from '../src/find-wrapper.mjs';
import { digest, fixture, INTERNAL } from './helpers.mjs';
import { classifyGNU } from './find_incremental_helpers.mjs';
const deep = process.env.FIND2FD_DEEP === '1', target = deep ? 3072 : 512, seed = 0x8f2da643, concurrency = 8;
const roots = [['tree'], ['tree/z-dir'], ['tree/empty'], ['tree', 'tree'], ['tree/z-dir', 'tree', 'tree/z-dir'], ['./tree'], ['tree', 'tree/a-dir'], ['tree/foo.txt'], ['missing', 'tree/foo.txt']];
const names = ['*', '*.txt', 'foo.txt', 'Foo.txt', 'target*', '.hidden*', 'nothing', '*txt', 'f*', '*dir', '-hyphen*', 'space*', 'literal*'];
const types = [null, 'f', 'd', 'l', 'p', 's', 'b', 'c'];
const depths = [[], ['-maxdepth', '0'], ['-maxdepth', '1'], ['-maxdepth', '2'], ['-mindepth', '1'], ['-mindepth', '1', '-maxdepth', '1'], ['-mindepth', '2', '-maxdepth', '3']];
const actions = [[], ['-print'], ['-print0']];
const otherExpressions = [
  ['-iname', '*.TXT'], ['!', '-type', 'd'], ['-type', 'f', '-o', '-type', 'd'], ['(', '-name', 'foo.txt', '-o', '-name', 'Foo.txt', ')'], ['-path', 'tree/*/target.txt'], ['-regex', '.*target.*'], ['-name', '[fF]oo.txt'], ['-prune'], ['-depth', '-type', 'd'], ['-printf', '%p:%f\n'], ['-true'], ['-false'],
  ['-name', '?oo.txt'], ['-ipath', 'TREE/*/TARGET.TXT'], ['-wholename', 'tree/*/target.txt'],
  ['-true', '-o', '-false', '-a', '-false'], ['(', '-true', '-o', '-false', ')', '-a', '-false'],
  ['!', '(', '-name', 'foo.txt', '-o', '-type', 'd', ')'], ['-false', ',', '-true'],
  ['-print0', '-print'], ['-name', 'foo.txt', '-o', '-print0'], ['-print0', '-a', '-false'],
  ['-name', 'foo.txt', '-print0', ',', '-name', 'Foo.txt', '-print'],
  ['-type', 'l', '-o', '-type', 'p', '-o', '-type', 's'], ['!', '-path', 'tree/z-dir*'],
];
function cases() {
  const pool = [];
  for (const root of roots) for (const name of names) for (const type of types) for (const depth of depths) for (const action of actions) {
    const tests = ['-name', name]; if (type) tests.push('-a', '-type', type);
    pool.push([...root, ...depth, ...tests, ...action]);
  }
  for (const root of roots) for (const expression of otherExpressions) for (const depth of depths) for (const action of actions) pool.push([...root, ...depth, ...expression, ...action]);
  // A coprime step gives a deterministic sampling without replacement.
  const gcd = (a, b) => b ? gcd(b, a % b) : a; let step = 7919; while (gcd(step, pool.length) !== 1) step++;
  const result = [], seen = new Set();
  for (let index = 0; result.length < target && index < pool.length; index++) {
    const argv = pool[(seed + index * step) % pool.length], identity = JSON.stringify(argv);
    if (!seen.has(identity)) { seen.add(identity); result.push({ index: result.length, argv }); }
  }
  assert.equal(result.length, target); return result;
}
function child(program, argv, cwd, env, argv0) {
  return new Promise((done) => {
    const child = spawn(program, argv, { cwd, env, argv0, stdio: ['ignore', 'pipe', 'pipe'] });
    const output = [], errors = []; let failure, bytes = 0;
    const timer = setTimeout(() => { failure = 'deadline'; child.kill('SIGKILL'); }, 10000);
    const collect = (target) => (value) => { bytes += value.length; if (bytes > 4 * 1024 * 1024) { failure = 'output cap'; child.kill('SIGKILL'); } else target.push(value); };
    child.stdout.on('data', collect(output)); child.stderr.on('data', collect(errors));
    child.once('error', (error) => { failure = error.code ?? error.message; });
    child.once('close', (status, signal) => { clearTimeout(timer); done({ status, signal, failure, stdout: Buffer.concat(output), stderr: Buffer.concat(errors) }); });
  });
}
test(`seeded full-CLI GNU campaign (${target} distinct actual comparisons)`, { timeout: deep ? 360000 : 120000 }, async (t) => {
  const previousLocale = process.env.LC_ALL; process.env.LC_ALL = 'C';
  const previousExperiment = process.env.FIND2FD_EXPERIMENTAL_FD; process.env.FIND2FD_EXPERIMENTAL_FD = '1';
  t.after(() => { if (previousLocale === undefined) delete process.env.LC_ALL; else process.env.LC_ALL = previousLocale; });
  t.after(() => { if (previousExperiment === undefined) delete process.env.FIND2FD_EXPERIMENTAL_FD; else process.env.FIND2FD_EXPERIMENTAL_FD = previousExperiment; });
  const current = fixture(t), items = cases(), failures = [];
  let next = 0, completed = 0, mismatchCount = 0, fdQualifiedPlans = 0, fdSearchPlans = 0, scanFreePlans = 0, incrementalPlans = 0, nativePlans = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < items.length) {
      const item = items[next++], planned = planFind(item.argv, { cwd: current.cwd });
      if (planned.backend === 'fd') {
        fdQualifiedPlans++;
        if (planned.mode === 'incremental') incrementalPlans++;
        else if (planned.searches.some((search) => search.directory)) fdSearchPlans++;
        else scanFreePlans++;
      } else nativePlans++;
      const [expected, actual] = await Promise.all([child('/usr/bin/find', item.argv, current.cwd, current.env, 'find'), child(process.execPath, [INTERNAL, ...item.argv], current.cwd, current.env)]);
      if (actual.failure || expected.failure || actual.signal || expected.signal || actual.status !== expected.status || !actual.stdout.equals(expected.stdout) || !actual.stderr.equals(expected.stderr)) {
        mismatchCount++; if (failures.length < 12) failures.push({ seed: `0x${seed.toString(16)}`, ...item, plannedBackend: planned.backend, actual: { ...actual, stdout: digest(actual.stdout), stderr: digest(actual.stderr) }, expected: { ...expected, stdout: digest(expected.stdout), stderr: digest(expected.stderr) } });
      }
      completed++;
    }
  }));
  const actualFdInvocations = current.actualSearchCalls(), nativeCalls = current.nativeCalls();
  const actualGNUValidationInvocations = nativeCalls.filter((args) => classifyGNU(args) === 'validation').length;
  const actualNonrecursiveGNUInvocations = nativeCalls.filter((args) => classifyGNU(args) === 'evaluator').length;
  const actualGNUDiscoveryInvocations = nativeCalls.filter((args) => classifyGNU(args) === 'discovery').length;
  const actualNativeInvocations = nativeCalls.filter((args) => classifyGNU(args) === 'original').length;
  t.diagnostic(JSON.stringify({ campaign: 'seeded-cli', seed: `0x${seed.toString(16)}`, deep, fixtureSourceSHA256: createHash('sha256').update(readFileSync(new URL('./helpers.mjs', import.meta.url))).digest('hex'), actualGNUComparisons: completed, distinctArgvCases: items.length, fdQualifiedPlans, fdSearchPlans, scanFreePlans, incrementalPlans, nativePlans, actualFdInvocations, actualGNUValidationInvocations, actualNonrecursiveGNUInvocations, actualGNUDiscoveryInvocations, actualNativeInvocations, qualifiedRuntimeFallbacks: actualNativeInvocations - nativePlans, mismatches: mismatchCount, concurrency }));
  assert.equal(completed, target); assert.ok(fdQualifiedPlans > target / 2); assert.ok(nativePlans > 0); assert.ok(actualFdInvocations >= fdSearchPlans);
  assert.equal(actualNativeInvocations, nativePlans, 'qualified cases must not run an original recursive GNU fallback; broker evaluations are counted separately');
  assert.equal(mismatchCount, 0, JSON.stringify(failures, null, 2));
});
