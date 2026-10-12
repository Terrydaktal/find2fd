import assert from 'node:assert/strict';
import { chmodSync, closeSync, ftruncateSync, linkSync, lstatSync, openSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ENV, PUBLIC, exact, fixture, run } from './helpers.mjs';

// Every oracle runs the complete GNU expression independently. The adapter's
// GNU predicate broker may evaluate entries, but must not walk the tree again.
export function metadataFixture(t) {
  const current = fixture(t, { rawNames: true });
  // The recording subprocess must preserve every caller/broker descriptor.
  const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
  const recorder = `#!/usr/bin/bash\n${quote(process.execPath)} -e 'require("node:fs").appendFileSync(process.env.FIND2FD_NATIVE_TRACE,JSON.stringify(process.argv.slice(1))+"\\n")' -- "$@"\nexec /usr/bin/find "$@"\n`;
  writeFileSync(join(current.bin, 'find'), recorder, { mode: 0o700 });
  for (const size of [0, 1, 511, 512, 513, 1024, 1048575, 1048576, 1048577]) {
    const descriptor = openSync(join(current.cwd, `tree/size-${size}`), 'w');
    ftruncateSync(descriptor, size); closeSync(descriptor);
  }
  for (const mode of [0o000, 0o400, 0o600, 0o640, 0o755, 0o4755, 0o2640, 0o1700]) {
    const name = `tree/mode-${mode.toString(8)}`;
    current.put(name, 'permissions\n'); chmodSync(join(current.cwd, name), mode);
  }
  current.put('tree/hardlink-a', 'hardlinks\n');
  linkSync(join(current.cwd, 'tree/hardlink-a'), join(current.cwd, 'tree/hardlink-b'));
  symlinkSync('mode-755', join(current.cwd, 'tree/link-mode'));
  symlinkSync('literal*.txt', join(current.cwd, 'tree/link-star'));
  current.put('tree/dated-old', 'old\n'); current.put('tree/dated-future', 'future\n');
  const now = Date.now() / 1000;
  utimesSync(join(current.cwd, 'tree/dated-old'), now - 30 * 86400 - 120, now - 30 * 86400 - 120);
  utimesSync(join(current.cwd, 'tree/dated-future'), now + 300, now + 300);
  current.put('reference', 'reference\n'); utimesSync(join(current.cwd, 'reference'), 1577836800, 1577836800);
  // Settle directory access times before the two independent traversals;
  // fixture creation itself otherwise makes relatime update the first walk.
  run('/usr/bin/find', ['tree', '-print0'], current.cwd, { env: ENV });
  const directoryAtimes = run('/usr/bin/find', ['tree', '-type', 'd', '-print0'], current.cwd, { env: ENV }).stdout
    .subarray(0, -1).toString('binary').split('\0').map((name) => {
      const path = Buffer.concat([Buffer.from(`${current.cwd}/`), Buffer.from(name, 'binary')]);
      return { path, mtime: lstatSync(path).mtimeMs / 1000 };
    });
  const stableDirectoryAtime = Math.ceil(now) + 3600;
  const restoreDirectoryAtimes = () => {
    for (const { path, mtime } of directoryAtimes) utimesSync(path, stableDirectoryAtime, mtime);
  };
  const metrics = { actualGNUComparisons: 0, actualFdInvocations: 0, actualNonrecursiveGNUInvocations: 0, actualGNUValidationInvocations: 0, actualOriginalGNUInvocations: 0 };
  function compareMetadata(argv, { locale = 'C', accelerated = true, fallbackAfterFd = false, resetDirectoryAtimes = false } = {}) {
    const environment = { ...current.env, LC_ALL: locale, LANG: locale };
    const fdBefore = current.actualSearchCalls(), nativeBefore = current.nativeCalls().length;
    if (resetDirectoryAtimes) restoreDirectoryAtimes();
    const expected = run('/usr/bin/find', argv, current.cwd, { env: environment });
    if (resetDirectoryAtimes) restoreDirectoryAtimes();
    const actual = run(PUBLIC, argv, current.cwd, { env: environment });
    exact(actual, expected, JSON.stringify({ argv, locale }));
    const fdCalls = current.actualSearchCalls() - fdBefore;
    const nativeCalls = current.nativeCalls().slice(nativeBefore);
    const brokers = nativeCalls.filter((args) => {
      const input = args.indexOf('-files0-from'), depth = args.indexOf('-maxdepth');
      const nonrecursive = args.every((arg, index) => arg !== '-maxdepth' || args[index + 1] === '0');
      return input >= 0 && /^\/proc\/self\/fd\/\d+$/.test(args[input + 1]) && depth >= 0 && nonrecursive;
    });
    const validations = nativeCalls.filter((args) => {
      const input = args.indexOf('-files0-from'), depth = args.indexOf('-maxdepth');
      return input >= 0 && args[input + 1] === '/dev/null' && depth >= 0 && args[depth + 1] === '0';
    });
    metrics.actualGNUComparisons++;
    metrics.actualFdInvocations += fdCalls;
    metrics.actualNonrecursiveGNUInvocations += brokers.length;
    metrics.actualGNUValidationInvocations += validations.length;
    metrics.actualOriginalGNUInvocations += nativeCalls.length - brokers.length - validations.length;
    if (accelerated) {
      assert.ok(fdCalls > 0, `${JSON.stringify(argv)}: no actual fd search`);
      assert.equal(nativeCalls.length, brokers.length + validations.length, `${JSON.stringify(argv)}: original recursive GNU fallback`);
    } else {
      if (fallbackAfterFd) assert.ok(fdCalls > 0, `${JSON.stringify(argv)}: boundary must be observed in fd preparation`);
      else assert.equal(fdCalls, 0, `${JSON.stringify(argv)}: native boundary must precede fd traversal`);
      assert.equal(brokers.length, 0);
      assert.deepEqual(nativeCalls.filter((args) => !validations.includes(args)), [argv]);
    }
    return actual;
  }
  return { ...current, compareMetadata, metrics, fileStat: (name) => statSync(join(current.cwd, name), { bigint: true }),
    diagnostics: (campaign) => ({ campaign, ...metrics, fixtureSource: 'owned synthetic metadata tree', rawFilenameBytes: true }) };
}

export function filesystemType(current) {
  const result = run('/usr/bin/find', ['tree', '-maxdepth', '0', '-printf', '%F'], current.cwd, { env: ENV });
  assert.equal(result.status, 0);
  return result.stdout.toString();
}
