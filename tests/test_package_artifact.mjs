// A tarball listing alone is insufficient: extract and run the shipped launchers.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const hash = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
function command(program, args, cwd, env = process.env) {
  const result = spawnSync(program, args, { cwd, env, encoding: 'utf8', timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
  assert.equal(result.error, undefined, `${program}: ${result.error?.message}`);
  assert.equal(result.signal, null, `${program}: ${result.signal}`);
  assert.equal(result.status, 0, `${program} ${args.join(' ')}:\n${result.stdout}\n${result.stderr}`);
  return result;
}
function entryChecks(packageRoot, cwd, bin, prefixBin) {
  const environment = { ...process.env, FIND2FD_TEST_PACKAGE_ROOT: packageRoot, FIND2FD_TEST_ENTRY_BIN: bin, FIND2FD_TEST_PREFIX_BIN: prefixBin };
  // A nested `node --test` owns its TAP stream, rather than the parent's IPC mode.
  delete environment.NODE_TEST_CONTEXT;
  const result = command(process.execPath, ['--test', '--test-reporter=tap', join(packageRoot, 'tests/test_package_entry.mjs'), join(packageRoot, 'tests/test_find_default_policy.mjs')], cwd,
    environment);
  assert.match(result.stdout, /^# tests 10$/m);
  for (const kind of ['fail', 'cancelled', 'skipped', 'todo']) assert.match(result.stdout, new RegExp(`^# ${kind} 0$`, 'm'));
  return [...result.stdout.matchAll(/^# (\{.*\})$/gm)].map((match) => JSON.parse(match[1]));
}

test('actual npm tar extraction and offline local installation execute shipped GNU-compatible entry points', { timeout: 120000 }, (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'find2fd-artifact-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const npmEnv = { ...process.env, npm_config_cache: join(cwd, 'npm-cache') };
  const manifest = JSON.parse(command('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', cwd], root, npmEnv).stdout);
  const packed = Array.isArray(manifest) ? manifest : Object.values(manifest);
  assert.equal(packed.length, 1);
  const record = packed[0], archive = join(cwd, record.filename), extraction = join(cwd, 'extracted'); mkdirSync(extraction);
  command('tar', ['-xzf', archive, '-C', extraction], cwd);
  const packageRoot = join(extraction, 'package');
  const expected = ['package.json', 'README.md', 'LICENSE', 'NOTICE', 'pi/find2fd.ts', 'bin/find2fd', 'bin/find2fd.mjs', 'bin/find2fd-shell-prefix.mjs',
    'src/find-auto.sh', 'tools/benchmark-routing.py', 'docs/automatic-routing-audit.json', 'docs/automatic-routing-performance.json',
    'rust/Cargo.toml', 'rust/Cargo.lock', 'rust/src/main.rs', 'rust/src/tests.rs', 'rust/tests/gnu_oracle.rs',
    'tools/rust-verification.mjs', 'tools/verify-rust-artifact.mjs', 'tests/test_verification_evidence.mjs',
    'tools/verify.mjs', 'tools/verify-artifact.mjs', 'tests/helpers.mjs', 'tests/test_package_entry.mjs', 'tests/test_package_artifact.mjs', 'tests/find_option_inventory.json', 'tests/find_wrapper_requirements.json',
    ...['options', 'order', 'runtime', 'wrapper', 'evaluate', 'incremental', 'descriptors'].map((name) => `src/find-${name}.mjs`),
    'tests/find_metadata_helpers.mjs', 'tests/find_incremental_helpers.mjs',
    ...['automatic_routing', 'default_policy', 'options', 'cli', 'expressions', 'fallback', 'runtime', 'scope', 'campaign', 'expression_campaign', 'metadata', 'metadata_formats', 'metadata_traversal', 'incremental', 'incremental_runtime', 'leading_flags', 'descriptors'].map((name) => `tests/test_find_${name}.mjs`)];
  for (const file of expected) {
    assert.ok(existsSync(join(packageRoot, file)), `missing extracted verification or product file ${file}`);
    assert.equal(hash(join(packageRoot, file)), hash(join(root, file)), `packed file identity: ${file}`);
  }
  assert.ok(record.files.every(({ path }) => {
    // Public native fault drivers are versioned test source, not private captures.
    const publicRustFixture = /^rust\/tests\/fixtures\/[^/]+\.(?:c|py|json)$/.test(path);
    return !/(^|\/)(node_modules|artifacts|\.git|captures|private|target)(\/|$)/.test(path) &&
      (publicRustFixture || !/(^|\/)fixtures(\/|$)/.test(path));
  }), 'the package contains only public source/tests, without builds or private lab data');
  const extractedEvidence = entryChecks(packageRoot, cwd, join(packageRoot, 'bin/find2fd'), join(packageRoot, 'bin/find2fd-shell-prefix.mjs'));
  const installation = join(cwd, 'installed'); mkdirSync(installation);
  command('npm', ['install', '--prefix', installation, '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--legacy-peer-deps', archive], cwd, npmEnv);
  const installedPackage = join(installation, 'node_modules/find2fd');
  const installedEvidence = entryChecks(installedPackage, cwd, join(installation, 'node_modules/.bin/find2fd'), join(installation, 'node_modules/.bin/find2fd-shell-prefix'));
  t.diagnostic(JSON.stringify({ campaign: 'packed-artifact', tarballSHA256: hash(archive), npmIntegrity: record.integrity, extractedFilesVerified: expected.length, extractedEntryNodeTests: 10, installedEntryNodeTests: 10, extractedEvidence, installedEvidence }));
});
