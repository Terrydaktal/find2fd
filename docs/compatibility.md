# Compatibility and scope

## Two execution paths

find2fd accepts the original GNU find interface. The parser qualifies a small
read-only expression subset for fd. Other expressions run through GNU find
with their original arguments, output and status. Native fallback requires no
model retry, guidance message or changed command syntax.

The initial fd subset uses at most 256 existing directory operands, physical
traversal (`-P`), supported conjunctions, nonempty ASCII name patterns,
one file type or repeated identical type tests, leading minimum/maximum depth
settings, and default print or a single final `-print`/`-print0`. Supported
types are regular files, directories, symbolic links, named pipes, sockets,
block devices and character devices.

Names allow literal ASCII characters and `*`, but exclude `?`, brackets,
braces, backslashes and `/`. Multiple name tests are conjunctive. Depth values
use at most ten decimal digits and are at most 1,000,000; repeated leading
depth options use the last value. Explicit `-a`/`-and` is allowed between predicates or before the final
print action. A conjunction immediately after the leading depth globals is
handled by GNU, as are depth settings after predicates and their GNU warnings.

Starting paths must be ASCII and normalized. `.`/`./`/`/`, a leading `./` and
one trailing slash are accepted; repeated separators and internal `.`/`..`
components remain native. Newline printing to terminal stdout also remains
native so GNU performs its pathname quoting. `-print0` can qualify on a terminal.

Following links, file starting operands, alternation, negation, grouping,
metadata tests, more complex glob syntax, custom formatting, pruning,
termination and actions remain native. GNU find itself interprets and rejects
invalid expressions. A command using `-exec`, `-delete` or another action is
never partly performed by fd and then retried through GNU find.

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
| Starting directories | 256 |
| Each fd invocation | 10 seconds |
| Captured fd candidate bytes across starting paths | 32 MiB |
| Rendered output across starting paths | 32 MiB |
| Candidates across starting paths | 100,000 |
| Ordering directories across starting paths | 10,000 |
| Entries read for ordering across starting paths | 200,000 |
| Entries in one ordering directory | 10,000 |
| Native cancellation descendant snapshot | 4,096 processes |

Exceeding a search or ordering bound uses GNU find before stdout is emitted.
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
passing non-ASCII arguments directly to GNU before Node decodes them. The fd
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
tests. These broader expressions remain available through native execution.

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
