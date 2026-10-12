# Routing policy

Automatic calls select fd only for a measured sparse-name/type family on large layered physical trees. The shared Bash gate runs before Node: one ASCII normalized root, optional `-P`, leading numeric depth controls, one case-sensitive literal/star-only `-name`, optional `-type f/d/l`, simple AND, and implicit/final `-print` or `-print0`. Newline output on a terminal stays GNU.

The root's directory link count must be 34–514. At most eight child link counts must project at least 24,000 second-level directories. Up to eight read-only GNU depth-two samples, each capped at 32,768 marker bytes, reject dense matches, repeated names and incomplete samples. The estimated candidate count must be at most 32. Sampling never executes a user action or emits user-visible output. Dispatch and sampling costs are included in the actual CLI performance capture. Metadata, formats, Boolean alternatives, following, controls/actions, broad output, small/medium/flat trees and deep chains remain native before Node.

Directory link counts and samples predict workload cost; they are not a recursive census or an atomic filesystem snapshot. Irregular distributions, concurrent changes, cold/network storage and different CPUs can change the speed ordering. Existing compatibility validation still determines whether candidate bytes/order can be published safely. [Every inventoried spelling and interaction family](automatic-routing-audit.json) has an explicit route and reason. [Eighteen paired workload classes](automatic-routing-performance.json) compare GNU, automatic CLI and the broader experimental CLI, including startup and output costs.

`FIND2FD_ACCELERATION=off` or `0` forces native execution. Unset `FIND2FD_EXPERIMENTAL_FD` selects automatic policy; exactly `1` retains the broader semantic routes below. Every other explicitly set experiment value stays native. The explicit experiment is compatible finite engine coverage, not an automatic speed qualification. GNU user actions are never run twice to time them.

# Compatibility and scope

## Execution paths

Common bounded byte-safe listings use fd discovery and an in-process Boolean evaluator. Richer read-only expressions use fd discovery followed by GNU `find -files0-from /proc/self/fd/N -maxdepth 0`: GNU evaluates the ordered entries without another recursive walk. N is a free descriptor slot. The private, unlinked input file preserves the caller's stdin and raw pathname bytes. Native fallback runs the original GNU command unchanged.

The richer route covers GNU metadata predicates, arbitrary glob and regex matching, locales, reference comparisons, `-ls` and `-printf`. Root-sensitive `%H`, `%P` and `%d` fields are rewritten from each original starting root, relative byte path and depth. Compatible records are batched; `%P` usually requires a separate evaluation per path, which can be considerably slower than GNU alone. Terminal quoting of these rewritten fields remains native.

Leading `-mindepth`, `-maxdepth`, `-depth`, `-xdev`, `-mount`, `-noleaf` and `-noignore_readdir_race` control fd discovery and ordering. `-L`, `-H` and positional `-follow` retain their respective traversal and reference policies; `-H` evaluations split original roots from descendants. A symlink reference under `-H`, split-request parse warnings, and an observed logical cross-filesystem directory boundary stay native. Traversal globals after predicates retain GNU's warnings and execution. GNU's `-d` depth alias currently remains native; `-help`/`--help` and `-version`/`--version` retain GNU informational output without a search.

Directory traversal changes access times. For buffered discovery, access-time/used predicates and access-time output can qualify only where the conservative expression analysis proves every output to be a regular file; directory or symlink access-time references stay native. This is an explicit semantic boundary, not a claim that the earlier walk leaves all filesystem metadata unchanged.

The fast route still uses byte-safe name/type candidate filters and a full Boolean evaluator. Rich GNU evaluation deliberately uses unrestricted fd candidates rather than approximating permissions, time rounding, NSS/ACL checks, glob/regex dialects or locale behavior with fd flags.

Mutations, output-file and command actions, `-ignore_readdir_race` and user `-files0-from` lists, whether files or stdin, retain native execution. Leading `-noignore_readdir_race` can qualify through the broker; its late placement remains native. Performing a complete fd walk before a mutating action would change the traversal that GNU observes. The wrapper never partly performs an action and then retries it. Debug output (`-D`), unavailable SELinux context checks and references to closed caller descriptors also retain GNU behavior.

Starting paths are normalized valid UTF-8 paths; `.`/`./`/`/`, a leading `./` and one trailing slash are accepted. Internal `.`/`..` and repeated separators remain native. Non-directory starting points need no fd discovery. Invalid UTF-8 arguments remain untouched in Bash and go directly to GNU; valid Unicode arguments can proceed through the broker after raw-argv validation.

## Incremental prune and quit

Pure predicates and output with `-prune`/`-quit` can use physical preorder
execution when a leading finite `-maxdepth` proves the worst-case displayed
and absolute path bytes stay below Linux `PATH_MAX`. Unbounded controls retain
original GNU before output. Native GNU FTS can descend beyond this limit using
directory anchors; treating each descendant as a fresh broker root cannot.
The proof uses a 255-byte component limit only on ext2/3/4, btrfs, xfs, tmpfs,
ramfs and f2fs. `statfs` and a bounded mountinfo check reject unknown root or
nested filesystem types before output; CIFS/FUSE/overlay are not qualified.
These checks do not prove equivalence through concurrent mount changes. One persistent GNU evaluator receives each path through a private
FIFO and reports reached control operations through a private PTY. fd lists
only the immediate children after GNU permits descent. A pruned directory is
not queried; a quit stops subsequent queries. GNU retains expression truth,
short-circuiting, parse-time references, default print and output. A root-only
prune or quit performs no fd traversal and receives no acceleration credit.

This route requires util-linux `script` and `mkfifo`. Its private directory
must be outside every traversed root, checked before creation; a symlinked
`TMPDIR` cannot introduce helper files into the result. Failed preparation
uses original GNU before output. If fd fails during a directory query, a
local GNU depth-one listing supplies only that directory's children; previously
evaluated expressions are never replayed.

Depth-first traversal, following, cross-filesystem controls, contextual
formats and user actions remain native for these combinations. Directory
replacement and command batching need stronger traversal-state preservation.
Starting one fd process per directory also has a cost: this route expands
genuine fd contribution, without promising every command runs faster.

Direct-dispatch cancellation and terminal process-group cancellation are checked
separately. Bash does not forward a PID-only SIGINT sent to its waiting outer
process, for either the native or wrapped command. Shell-visible status, output
prefix and owned-child cleanup are checked for group cancellation; raw wait
status can differ when Node handles SIGINT and exits normally with 130.

## Why ordering requires work

fd's normal result order differs from GNU find's traversal order. One fd thread
does not fix that difference. The wrapper collects NUL-separated candidates,
handles starting directories separately and builds ordering ranks by reading
candidate parents and ancestors with `opendir`. It preserves starting-operand
order and restores preorder traversal rather than sorting filenames.

This is a second enumeration of the relevant directories. Sparse results may
require only a small ancestor set; broad searches can require nearly the whole
tree again. No GNU find ordering walk is run alongside fd. There is no promise
that this extra work is cheaper than a native GNU search.

Directory-read failures, missing candidates, inconsistent types or ancestors,
other detected ordering problems and fd failures trigger native fallback before
candidate output is printed. These consistency checks are not an atomic
snapshot of the tree.

Ordering qualification targets stable synthetic trees. Concurrent
filesystem changes can affect both search engines; neither provides an atomic
filesystem snapshot. Tests and detected-change handling cannot establish exact
equivalence for every possible mutation schedule or filesystem implementation.

## Resource bounds

| Resource | Limit |
| --- | ---: |
| Starting paths | 256 |
| Expression nodes | 256 |
| Expression nesting | 64 |
| Bytes per predicate or format argument | 8,192 |
| In-process listing output records | 100,000 |
| Each fd invocation | 10 seconds |
| Captured fd candidate bytes across starting paths | 32 MiB |
| In-process listing output across starting paths | 32 MiB |
| Candidates across starting paths | 100,000 |
| Ordering directories across starting paths | 10,000 |
| Entries read for ordering across starting paths | 200,000 |
| Entries in one ordering directory | 10,000 |
| GNU evaluator input list, including starting paths | 32 MiB / 100,256 records |
| Split evaluator input and arguments combined | 32 MiB |
| Contextual rewritten format bytes, width or precision | 32 MiB |
| GNU expression validation | 2 seconds / 1 MiB captured output |
| Native cancellation descendant snapshot | 4,096 processes |

Exceeding a search or ordering bound uses GNU find before stdout is emitted.
GNU evaluator stdout is inherited and has no listing-output byte or record cap.
The cancellation snapshot limit separately bounds owned-process cleanup;
cancellation does not start a fallback search. The per-directory limit avoids
GNU FTS's inode-order optimization for large directories. The byte caps are
not a claim that total process memory is 32 MiB: candidate, directory and
ordering structures have their own count bounds.

The runtime resolves `fd` on `PATH`, trying Debian's `fdfind` name only when
`fd` is absent. If an existing fd fails, it uses GNU directly rather than
trying another engine. There is no version preflight: rejected engine options,
nonzero exit, diagnostic output, timeout or malformed pathname records cause
native fallback. fd 9+ is the intended acceleration dependency.

Interrupts cancel the current invocation rather than starting a fallback
search. fd cleanup targets its private process group; native cancellation
captures up to 4,096 owned descendant processes and checks PID start times
before signalling them. Cleanup waits for the 250 ms escalation even if the
leader has already exited. This does not guarantee containment of arbitrarily
escaped, reparented or detached daemons launched by native actions.

## Paths and expression semantics

The public Bash CLI and private Bash function preserve raw argument bytes by
validating non-ASCII arguments through their raw process command line before Node routing. Invalid UTF-8 goes directly to GNU without decoding. The fd
path treats filenames as bytes, uses NUL-separated records and preserves GNU's
starting-path spelling. fd's trailing directory separator is not copied into
GNU output.

The runtime checks the working-directory bytes through `/proc/self/cwd`.
Unrepresentable working-directory bytes or an unavailable check use GNU. The
CLI's native process inherits the original operating-system working directory.

An already-deleted working directory uses the native path. Starting the public
Bash launcher there can still emit Bash's own shell-initialization diagnostic
before dispatch; the internal Node entry and an already-loaded private Bash
function avoid that additional launcher envelope.

Glob names are qualified explicitly. fd's brace expansion, byte-level `?` and
full-path globs are not substitutes for GNU's name/path predicates. Likewise,
fd size/time filters are not direct substitutes for GNU's rounded metadata
tests. GNU evaluates these broader read-only expressions on fd-discovered entries rather than substituting fd filter arithmetic.

## Shell and harness boundary

The Bash prefix defines only a private `find` function and does not export it
to child shells. `command find` and an absolute find executable bypass it.
Standalone integration is possible in any harness that can prepend this
definition to a model-issued Bash command.

The optional Pi extension keeps the native `bash` tool. Its default provider
allowlist contains `qwen-r9700`; `FIND2FD_PI_PROVIDERS` replaces that list with
exact comma-separated names. An explicitly empty value disables the hook.
User `!` commands and child scripts retain native shell behavior.

The private find and grep2rg Bash functions can coexist because they define
different command names. Their standalone Pi extensions both register a native
`bash` override, so do not load them independently together. Compose
`withFindWrapper` and `withGrepWrapper` in one harness `spawnHook` to use both.
Other existing native-tool overrides likewise need one integrated hook.

## Assurance limits

Compatibility evidence applies to the captured engines, fixtures, expression
classes and output boundaries. This release does not claim every GNU find
command is accelerated or that fd is universally faster. Native GNU execution
is part of the design rather than an unimplemented-command error.
