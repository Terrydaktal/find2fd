import assert from 'node:assert/strict';
import { withFindWrapper } from '../src/find-wrapper.mjs';
import { PUBLIC, exact, fixture, run } from './helpers.mjs';

export function classifyGNU(args) {
  const input = args.indexOf('-files0-from');
  const max = args.indexOf('-maxdepth');
  if (input >= 0 && args[input + 1] === '/dev/null') return 'validation';
  if (input >= 0 && max >= 0 && args[max + 1] === '0') return 'evaluator';
  if (input >= 0 && max >= 0 && args[max + 1] === '1' && args.includes('-mindepth')) return 'discovery';
  return 'original';
}

// These fixtures have short physical roots and at most three descendant levels.
// Explicit bounds are part of the tested argv, including the independent GNU call.
export function finiteDepth(argv, maximum = '8') {
  if (argv.includes('-maxdepth')) return argv;
  const index = argv.findIndex((value) => /^[-!(,]/.test(value));
  assert.ok(index > 0, 'finite oracle argv begins with explicit fixture roots');
  return [...argv.slice(0, index), '-maxdepth', maximum, ...argv.slice(index)];
}

export function incrementalFixture(t) {
  const current = fixture(t, { rawNames: true });
  const metrics = { actualGNUComparisons: 0, actualImmediateFdInvocations: 0, actualGNUEvaluatorInvocations: 0,
    actualGNUValidationInvocations: 0, actualGNUDiscoveryInvocations: 0, actualOriginalGNUInvocations: 0,
    brokerOnlyComparisons: 0 };
  const compare = (argv, { fd = 'positive', route = 'public', beforeEach, afterEach } = {}) => {
    const fdBefore = current.calls().length, nativeBefore = current.nativeCalls().length;
    beforeEach?.();
    const expected = run('/usr/bin/find', argv, current.cwd, { env: current.env });
    const expectedState = afterEach?.();
    beforeEach?.();
    const actual = route === 'public' ? run(PUBLIC, argv, current.cwd, { env: current.env })
      : run('/usr/bin/bash', ['--noprofile', '--norc', '-c', withFindWrapper({ command: 'find "$@"' }, '/usr/bin/bash').command,
        'owned-find-incremental', ...argv], current.cwd, { env: current.env });
    const actualState = afterEach?.();
    exact(actual, expected, JSON.stringify({ argv, route }));
    if (afterEach) assert.deepEqual(actualState, expectedState, 'owned traversal effects match independent GNU');
    const fdCalls = current.calls().slice(fdBefore).filter((args) => args.includes('--max-depth') && args[args.indexOf('--max-depth') + 1] === '1');
    const native = current.nativeCalls().slice(nativeBefore), kinds = native.map(classifyGNU);
    metrics.actualGNUComparisons++; metrics.actualImmediateFdInvocations += fdCalls.length;
    for (const [kind, key] of [['evaluator', 'actualGNUEvaluatorInvocations'], ['validation', 'actualGNUValidationInvocations'],
      ['discovery', 'actualGNUDiscoveryInvocations'], ['original', 'actualOriginalGNUInvocations']]) metrics[key] += kinds.filter((value) => value === kind).length;
    if (fd === 'native') {
      assert.equal(fdCalls.length, 0); assert.deepEqual(native.filter((_, index) => kinds[index] === 'original'), [argv]);
    } else {
      assert.equal(kinds.filter((value) => value === 'original').length, 0, 'original recursive GNU receives no acceleration credit');
      assert.ok(kinds.includes('evaluator'), 'GNU incremental candidate evaluator must actually execute');
      if (fd === 'positive') assert.ok(fdCalls.length > 0, 'actual immediate fd listing required');
      else { assert.equal(fdCalls.length, 0, 'root control must prevent all directory listing'); metrics.brokerOnlyComparisons++; }
      for (const args of fdCalls) assert.equal(args[args.indexOf('--max-depth') + 1], '1', 'incremental fd must not prewalk descendants');
    }
    return { actual, expected, fdCalls, nativeCalls: native };
  };
  return { ...current, compare, metrics, diagnostic: (campaign) => ({ campaign, ...metrics, rawFixtureBytes: true }) };
}
