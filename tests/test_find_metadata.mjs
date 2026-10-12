import test from 'node:test';
import { userInfo } from 'node:os';
import { filesystemType, metadataFixture } from './find_metadata_helpers.mjs';

test('fd traversal accelerates GNU size, permission, ownership and inode predicates', (t) => {
  const current = metadataFixture(t);
  const inode = String(current.fileStat('tree/hardlink-a').ino);
  const uid = String(process.getuid()), gid = String(process.getgid());
  const cases = [
    ...['0', '1', '+1', '-1', '0c', '1c', '+512c', '-513c', '1b', '1w', '1k', '1M', '-1M', '+1M', '1G'].map((size) => ['-type', 'f', '-size', size]),
    ...['000', '640', '-400', '/111', '-000', '4755', '-4000', '/2000', 'u=rw,g=r,o=', '-u=r', '/a=x'].map((mode) => ['-perm', mode]),
    ['-uid', uid], ['-uid', `+${uid}`], ['-uid', `-${uid}`], ['-gid', gid], ['-gid', `+${gid}`],
    ['-user', userInfo().username], ['-user', uid], ['-group', gid], ['-nouser'], ['-nogroup'],
    ['-links', '1'], ['-links', '+1'], ['-links', '-2'], ['-inum', inode], ['-inum', `+${inode}`], ['-samefile', 'tree/hardlink-a'],
    ['-empty'], ['-readable'], ['-writable'], ['-executable'],
    ['-fstype', filesystemType(current)], ['-fstype', 'find2fd-no-such-filesystem'],
    ['(', '-size', '+0c', '-a', '-perm', '-0400', ')', '-o', '-empty'],
    ['-print', '-a', '-size', '0c'],
    ['-false', '-o', '(', '-uid', uid, ',', '-links', '+1', ')', '-print0'],
  ];
  for (const expression of cases) current.compareMetadata(['tree', ...expression]);
  t.diagnostic(JSON.stringify(current.diagnostics('metadata-numeric-permission-owner')));
});

test('fd traversal retains GNU timestamp snapshots, reference comparisons and daystart', (t) => {
  const current = metadataFixture(t);
  const cases = [
    ...['0', '30', '+29', '-31', '-0'].map((n) => ['-type', 'f', '-mtime', n]),
    ...['0', '+0', '-2', '43200'].map((n) => ['-type', 'f', '-mmin', n]),
    ...['0', '30', '+29', '-31'].map((n) => ['-type', 'f', '-atime', n]),
    ['-type', 'f', '-amin', '+1'], ['-type', 'f', '-ctime', '0'], ['-type', 'f', '-cmin', '0'],
    ['-type', 'f', '-used', '0'], ['-type', 'f', '-used', '+1'], ['-type', 'f', '-used', '-1'],
    ['-newer', 'reference'], ['-type', 'f', '-anewer', 'reference'], ['-cnewer', 'reference'],
    ...['aa', 'ac', 'am', 'ca', 'cc', 'cm', 'ma', 'mc', 'mm'].map((xy) => ['-type', 'f', `-newer${xy}`, 'reference']),
    ['-newermt', '2020-01-01 00:00:00 UTC'], ['-type', 'f', '-newerat', '2020-01-01 00:00:00 UTC'],
    ['-daystart', '-mtime', '30'], ['-type', 'f', '-mtime', '30', '-daystart', '-atime', '30'],
    ['-type', 'f', '-not', '(', '-mtime', '+29', '-o', '-atime', '-1', ')', '-print0'],
  ];
  for (const expression of cases) current.compareMetadata(['tree', ...expression]);
  t.diagnostic(JSON.stringify(current.diagnostics('metadata-time-reference')));
});

test('directory access-time semantics retain GNU before fd can change observed metadata', (t) => {
  const current = metadataFixture(t);
  const cases = [
    ['-atime', '0'], ['-amin', '0'], ['-anewer', 'reference'], ['-used', '0'],
    ['-type', 'd', '-atime', '0'], ['-type', 'f', '-newerma', 'tree/z-dir'],
    ['-printf', '%a|%A@|%p\\0'],
  ];
  for (const expression of cases) current.compareMetadata(['tree', ...expression], { accelerated: false, resetDirectoryAtimes: true });
  t.diagnostic(JSON.stringify(current.diagnostics('metadata-access-time-native-boundary')));
});

test('fd enumeration retains GNU arbitrary globs, regex dialects and symlink predicates', (t) => {
  const current = metadataFixture(t);
  const cases = [
    ['-name', '[a-z]*.txt'], ['-name', 'f??.txt'], ['-name', 'literal\\*.txt'],
    ['-path', 'tree/[az]-dir/*'], ['-iname', '*.TXT'], ['-ipath', 'TREE/*TXT'],
    ['-lname', '*.txt'], ['-lname', 'mode-???'], ['-lname', 'literal\\*.txt'], ['-ilname', '*TXT'],
    ['-xtype', 'f'], ['-xtype', 'd'], ['-xtype', 'l'],
    ['-regex', 'tree/.*\\.txt'], ['-iregex', 'TREE/.*\\.TXT'],
    ['-regextype', 'posix-extended', '-regex', 'tree/(foo|Foo)\\.txt'],
    ['-regextype', 'posix-basic', '-regex', 'tree/.*\\.txt'],
    ['(', '-lname', '*.txt', '-o', '-empty', ')', '-a', '!', '-xtype', 'd', '-print0'],
  ];
  for (const expression of cases) current.compareMetadata(['tree', ...expression]);
  for (const expression of [['-iname', '*.TXT'], ['-ipath', 'TREE/*TXT'], ['-iregex', 'TREE/.*\\.TXT'], ['-name', '[[:alpha:]]*.txt']])
    current.compareMetadata(['tree', ...expression], { locale: 'C.UTF-8' });
  t.diagnostic(JSON.stringify(current.diagnostics('metadata-glob-regex-link')));
});
