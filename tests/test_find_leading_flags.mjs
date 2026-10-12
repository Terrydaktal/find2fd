import test from 'node:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { metadataFixture } from './find_metadata_helpers.mjs';
import { run } from './helpers.mjs';

function leadingFixture(t) {
  const current = metadataFixture(t);
  const recorder = join(current.bin, 'find');
  // Early -O diagnostics retain argv[0], so the disposable Bash recorder must
  // preserve the native launch name as well as every inherited descriptor.
  writeFileSync(recorder, readFileSync(recorder, 'utf8').replace('exec /usr/bin/find', 'exec -a find /usr/bin/find'));
  return current;
}

test('GNU leading delimiter, numeric optimization spellings and explicit default race mode use fd', (t) => {
  const current = leadingFixture(t);
  const cases = [
    ['--', 'tree', '-print0'],
    ['-P', '--', 'tree', '-name', '*.txt', '-print0'],
    ['-O03', 'tree', '-type', 'f', '-print0'],
    ['-O000', 'tree', '-size', '+0c', '-print0'],
    ['-O4', 'tree', '-print0'],
    ['-O0004', '--', 'tree', '-print0'],
    ['-O003', '-P', '--', 'tree', '-printf', '%p:%s\\0'],
    ['tree', '-noignore_readdir_race', '-type', 'f', '-print0'],
    ['tree', '-maxdepth', '1', '-noignore_readdir_race', '-mindepth', '1', '-print0'],
    ['tree', '-noignore_readdir_race', '-noignore_readdir_race', '-size', '+0c', '-print0'],
    ['--', 'tree', '-noignore_readdir_race', '-empty'],
    ['-O03', '--', 'tree', '-noignore_readdir_race', '-depth', '-print0'],
    ['--', 'tree/', '-print0'],
    ['--', './tree', '-print0'],
  ];
  for (const argv of cases) {
    const accepted = !['-O4', '-O0004'].includes(argv[0]) ||
      run('/usr/bin/find', [argv[0], '-files0-from', '/dev/null', '-maxdepth', '0', '-print0'], current.cwd).status === 0;
    current.compareMetadata(argv, { accelerated: accepted });
  }
  t.diagnostic(JSON.stringify(current.diagnostics('leading-flags-fd-required')));
});

test('invalid optimization, switches after delimiter and late race mode retain original GNU diagnostics', (t) => {
  const current = leadingFixture(t);
  const cases = [
    ['-Oxyz', 'tree', '-print0'],
    ['-O999999999999999999999999999999', '--', 'tree', '-print0'],
    ['--', '-H', 'tree'],
    ['tree', '-name', '*', '-noignore_readdir_race'],
    ['-O03', 'tree', '-exec', '/usr/bin/true', '{}', ';'],
  ];
  for (const argv of cases) current.compareMetadata(argv, { accelerated: false });
  t.diagnostic(JSON.stringify(current.diagnostics('leading-flags-native-diagnostics')));
});
