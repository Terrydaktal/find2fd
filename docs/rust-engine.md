# Native Rust find engine

`rust/target/release/find2fd-rust` accepts GNU find arguments and performs
qualified physical directory searches inside one native process. The public CLI
and private Pi Bash hook select this release by default once it is built. Its fd-style
parallel discovery uses anchored Linux directory reads and Rayon; it launches neither fd
nor Node. Unsupported expressions execute `/usr/bin/find` directly with the
original argument bytes and `find` as argv[0].

## Measurements

Captured 2026-10-12T22:38:02.784013+00:00, with 3
warmups and 31 rotated timed trials per engine
and class. These are warm-cache owned synthetic trees in the C locale.
The large fixture contains 30,000 second-level directories and approximately
150,000 entries; the medium fixture contains 5,120 second-level directories.
The baselines are find (GNU findutils) 4.11.0-modified and
fd 9.0.0.

| Workload | Direct GNU find ms | Direct fd ms | Rust executable ms | Execution |
| --- | ---: | ---: | ---: | --- |
| 128-file sparse name | 0.470 | 8.951 | 0.476 | Rust, sequential |
| 8K-file flat sparse name | 2.216 | 9.379 | 1.783 | Rust, sequential |
| 180-level chain sparse name | 0.880 | 8.954 | 0.799 | Rust, sequential |
| 5K-directory layered sparse name | 16.353 | 10.400 | 3.222 | Rust, parallel |
| 30K-directory sparse exact name | 103.707 | 21.439 | 14.081 | Rust, parallel |
| 30K-directory sparse star glob | 103.584 | 21.666 | 14.194 | Rust, parallel |
| 30K-directory sparse name/type | 102.603 | 20.932 | 13.990 | Rust, parallel |
| 30K-directory absent name | 101.493 | 20.738 | 13.942 | Rust, parallel |
| 30K-directory repeated filename | 104.813 | 21.680 | 14.842 | Rust, parallel |
| 30K-directory broad name output | 109.008 | 23.201 | 17.108 | Rust, parallel |
| 30K-directory all regular files | 101.405 | 23.475 | 17.161 | Rust, parallel |
| 30K-directory depth-one sparse name | 0.543 | 9.155 | 0.495 | Rust, sequential |
| Metadata size predicate | 165.461 | — | 164.668 | GNU fallback |
| GNU printf format | 102.964 | — | 102.993 | GNU fallback |
| Boolean with short-circuit output | 110.732 | — | 14.694 | Rust, parallel |
| Case-insensitive sparse name | 102.394 | 21.098 | 14.068 | Rust, parallel |
| Full-path sparse glob | 103.095 | 22.672 | 14.387 | Rust, parallel |
| Compound name/type negation | 17.813 | 10.798 | 3.482 | Rust, parallel |
| Repeated print actions | 14.953 | — | 3.181 | Rust, parallel |
| Prune control | 0.359 | — | 0.574 | GNU fallback |
| GNU exec action | 0.548 | — | 0.774 | GNU fallback |
| Missing-root diagnostics | 0.266 | — | 0.462 | GNU fallback |

17 classes execute native Rust searches. Their medians are lower
than direct GNU in 16/17 cases and lower than direct fd
in 15/15 comparable cases. GNU fallback is recorded
separately and receives no native acceleration credit. Sub-millisecond margins
and finite warm-cache fixtures do not establish universal wins.

Every Rust timing sample matches GNU stdout, stderr, status and ordering
exactly. Direct fd is invoked with equivalent hidden/ignore, case, depth and
type settings where a direct equivalent exists. Its complete NUL-delimited
record multiset is checked, including duplicates; fd can emit those same
records in a different order. A dash means no direct fd equivalent was tested.
The table includes complete process startup, traversal, output capture and
exit notification. Python startup, fixture construction, route diagnostics,
hashing, comparison and report serialization are outside the timing boundary.
No Node or shell translation is included in either direct baseline. The current
CLI and Pi hook use this measured engine, but the table excludes their Bash
launcher/prefix setup; it is not a measured end-to-end Pi tool latency.

The [raw measurement](rust-engine-performance.json) retains all timed samples,
commands, output identities and native/fallback decisions. Release SHA-256:
`f5b95362c769bf69eb3caa92f6fc6111eac301f30d4d00a62739fd6a09ebbff8`.

## GNU correctness and packaging

The independently rebuilt npm source artifact passed
**706 exact GNU comparisons**, including
**567 native engine searches** and
**42 Node CLI/Pi comparisons**. Native, fallback and
transport comparisons are counted separately. The suite exercises expression
precedence, short-circuit/repeated output, root inclusion and spelling, hidden
and ignored files, byte filenames, globs, depth, ordered parallel traversal,
unsupported options, safe action delegation, permissions and output failures.
GNU fallback is compatibility coverage, rather than proof that those features
have been reimplemented in Rust.

Verification packs the actual npm distribution, checks source identities and
build-output exclusion, extracts it outside the checkout, rebuilds locked
dependencies offline into an independent release target, and runs the packaged
Rust oracle and separate Node integration/process-timer tests there. Rust units
passed 11 debug and 11 release checks. The rebuilt executable has the same
SHA-256 as the release measured above. The
[qualification report](rust-engine-qualification.json) records the source
hashes, archive identity, build and actual test counts. CI runs this packaged
qualification in its separate Rust job.

## Supported native searches

Physical preorder traversal includes starting paths and all hidden/ignored
entries. Roots, duplicate roots and result records preserve original byte
spelling and GNU traversal order. Small trees run sequentially; sufficiently
wide directory roots distribute their subtrees across a worker pool and emit
the collected results in original order. Descent uses pinned directory
descriptors and openat with O_NOFOLLOW for child directories, preventing a
replaced child or ancestor from redirecting physical traversal through a
symlink. Display paths remain separate from descriptor-based access paths.

The optimized traversal reads `getdents64` batches through those same pinned
descriptors, preserving their record order. Unknown entry types use anchored
`fstatat` without following symlinks. Filename ranges share one path allocation;
only descending directories retain a parent anchor. Entry/discovery checks run
per batch, output reservations are batched, and a depth-one walk does not start
workers. Literal, prefix, suffix and substring patterns avoid the general glob
loop where their byte semantics are equivalent. Bounds remain conservative,
and preparation failures still delegate before emitting output.

Supported expressions include `-name`, `-iname`, `-path`, `-ipath` and path
aliases; regular, directory, symlink, FIFO, socket and device `-type` tests;
`-true`, `-false`, AND, OR, NOT, parentheses and comma; leading `-mindepth` and
`-maxdepth`; implicit output and explicit repeated `-print`/`-print0` actions.
Byte-safe simple globs use the internal matcher. Qualified complex C-locale
globs use libc fnmatch with GNU-compatible flags.

## Fallback boundaries

GNU retains metadata predicates, regular expressions, symlink following,
prune/quit, depth-first traversal, filesystem boundaries, command/deletion/file
output actions, unsupported syntax and options, and locale-sensitive cases
outside the native qualification. Newline terminal output retains GNU pathname
quoting. Permission, enumeration, resource and preparation failures discard all
buffered results and execute the original GNU invocation before visible output.
The engine applies conservative entry, directory, depth, path, preparation-time
and memory budgets; oversized searches can therefore use GNU despite otherwise
supported syntax. An ordinary mutable filesystem walk is not an atomic snapshot.

`FIND2FD_ACCELERATION=off` or `0` forces GNU execution. The diagnostic invocation
`find2fd-rust --find2fd-route-json ...` performs bounded read-only preparation
and reports native/fallback strategy without emitting search results or
executing an unsupported user action. It is outside the benchmark timer.

## Build and use

Linux, Rust 1.90 or newer, and GNU find are required. fd is required for the
comparative benchmark, rather than native execution. Qualification additionally
needs Node.js, Python, strace and a C compiler for owned process-launch and
namespace-replacement tests; none is used by an ordinary native search.

```bash
cargo build --release --locked --manifest-path rust/Cargo.toml
rust/target/release/find2fd-rust . -type f -name '*.rs' -print0
npm run test:rust
npm run test:integration
node tools/verify-rust-artifact.mjs --output docs/rust-engine-qualification.json
python3 tools/benchmark-rust-engine.py --output docs/rust-engine-performance.json
python3 tools/render-rust-results.py
```

The public CLI and provider-scoped Pi hook select the compiled Rust release
without a Node/fd helper. Source-only installs and explicit optouts use GNU;
FIND2FD_EXPERIMENTAL_FD=1 retains the older JS/fd experiment. The private Bash
function is not exported: user shells, explicit native bypasses and child
scripts retain system find.
