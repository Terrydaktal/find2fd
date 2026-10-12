The native Rust implementation is tested in Rust: `rust/src/tests.rs` contains
unit/property checks, and `rust/tests/gnu_oracle.rs` owns optimized-release
GNU comparisons, seeded cases and fault injection. Run `npm run test:rust` for
both native layers and `npm run test:integration` for Node CLI/Pi scope checks.
Node also retains the experimental JavaScript adapter suites because those tests
target JavaScript implementations, rather than the native Rust engine.

The current [native package qualification](rust-engine-qualification.json)
rebuilds the actual npm source archive offline outside the checkout. It runs Rust
units in debug and release, then the Rust GNU campaign once against a separate
uninstrumented production binary, followed by Node integration, process-timer
and evidence-validation checks. Counts, native/delegated routes and artifact
hashes are recorded separately. Run `npm run verify:rust` for this release gate.

The following records describe the retained historical JavaScript/fd adapter.

# Verification

The new automatic-routing regressions execute the real CLI and private Bash entry points against a synthetic 25,600-directory tree. They require actual fd contribution for sparse matches and exact complete GNU byte ordering/status/diagnostics, and require native routing for dense, repeated, broad, shallow, rich, followed and compound cases. Action and shell-option checks ensure sampling never duplicates a user action or alters the calling shell's options.

The [routing audit](automatic-routing-audit.json) covers every inventoried option spelling and structural family. The [speed capture](automatic-routing-performance.json) records seven randomized paired measurements after one warmup per engine in 18 representative classes, with GNU/automatic/experimental engines all checked against GNU. CPU and package verification results are retained by the commands below; previous qualification JSON files describe historical source states and are not current-source release certification.

[Historical adapter qualification](automatic-qualification.json) records **102 passing Node groups**: 93 core, two deep campaign groups and seven installed-Pi SDK groups. Its 3,072-case seeded campaign and 1,536-case expression campaign have zero mismatches and qualified runtime fallbacks. The automatic routing group makes 20 additional GNU comparisons, with eight actual automatic fd calls. The product hashes match the actual CLI performance capture and extracted artifact; its archive identity describes the exact package tested, including the documentation present when packed. The earlier missing-shell-resource mutant-fixture failure was corrected by copying the shipped policy into that disposable test fixture; runtime source did not change.

Tests use GNU find as the independent oracle. They execute public entry points
against disposable synthetic trees and compare stdout bytes, stderr bytes and
exit status. No private filesystem corpus or model request is needed.

## Run order

1. Install Linux, Node 24+, GNU find, fd 9+ (`fd` or `fdfind`), Bash, GNU
   coreutils `readlink`/`mkfifo`, util-linux `script`, Python 3, npm and tar.
2. Run `node tools/verify.mjs --core` for focused runtime, shell and package
   checks.
3. Run `node tools/verify.mjs` for the bounded default campaign.
4. Run `node tools/verify.mjs --deep` for the larger synthetic campaign.
5. Run `node tools/verify-artifact.mjs --deep` before release. This packs the
   actual npm artifact, extracts it and executes the packaged verifier.
6. Add `--sdk` and set `FIND2FD_TEST_PI_ROOT` to an installed
   `node_modules/@earendil-works` directory to qualify the optional Pi tool.

Use `--output artifacts/report.json` to retain structured evidence. Each
runner's `--help` describes its command contract. The standard tier does not
require an installed Pi SDK; acceleration checks do require a real fd engine.

## What to verify

The fd candidate path needs direct tests for expression precedence, negation,
comma sequencing, arbitrary print placement, name/path matching, C-only byte
folding and question wildcards, as well as default print and print0, starting
directories, file types, supported name patterns, depth limits, repeated roots,
GNU path spelling, hidden/ignored entries and ordering. Verify actual fd
execution with an owned executable recorder, separately from parser routing.

The native path needs tests for unsupported expressions, invalid arguments,
invalid UTF-8 argument bytes, absent or faulty fd, actions and malformed output.
Failure tests must establish that buffered fd output never leaks before GNU
fallback and that cancellation or a closed output pipe does not leave a child
search helper running. Detached processes launched by native actions are a
separate boundary from those owned helper checks.

Ordering checks need trees whose directory order differs from lexical order,
raw filename bytes and a directory crossing the 10,000-entry FTS boundary.
Resource checks must establish bounded candidate storage. These are separate
requirements from checking a typical `-name '*.ts'` command.

The shell and optional SDK tiers verify provider selection, user `!` behavior,
native bypasses and child-script scope. Package checks use the real executable
from an extracted npm package rather than crediting only a source checkout.

## Read the evidence

Reports distinguish Node test groups, actual GNU CLI comparisons, routing
decisions and verified fd invocations. A routing plan does not establish that
fd ran, and a native fallback comparison does not establish acceleration.
Generated fixtures and counts should be recorded with their seeds and scope.

A qualification report must identify the package artifact, engine versions,
source hashes, completed stages, comparison counts, skips and failures. Failed
cases need reproducible witnesses. Source changes, timeouts or truncated logs
prevent a run from serving as a clean immutable qualification.

## Automatic routing and broader semantic qualification

Unset experiment flags apply the measured automatic family; explicit native controls bypass it. The small-tree/default-policy tests check unchanged native argv and behavior with no Node or fd invocation, including raw argv, high/closed descriptors, stdin and owned actions. The optional SDK checks verify automatic private routing for Qwen model tools while preserving user `!`, other providers, child scripts and explicit native bypasses. Automatic fd tests require real engine calls rather than inferring acceleration from a parser plan.

The retained historical broader-semantic qualification exercised the following larger campaigns under explicit `FIND2FD_EXPERIMENTAL_FD=1`. Their immutable artifact hashes identify those earlier tested states; rerun the packaged verifier to qualify current code.

Each environment replays 3,072 distinct seeded CLI cases: 2,366 batched
fd-search plans, 340 scan-free plans, 16 incremental plans and 350 original-native
plans. These make 3,743 real fd calls, with zero mismatches or qualified runtime
fallbacks. The separate expression corpus has 1,536 locale/argv cases and 960
distinct argv vectors; it requires 2,152 real fd searches and no original-native
fallback. These counts are finite coverage, and are not doubled by desktop/VM
repetition or nested package checks.

Incremental tests evaluate prune/quit truth, default print, short-circuiting,
raw paths, root operands and references before immediate-child fd listing.
Root-only prune/quit makes no fd call. Eligibility requires a leading finite
`-maxdepth`, a worst-case path budget of 4,095 bytes and a 255-byte component
limit on ext2/3/4, btrfs, xfs, tmpfs, ramfs or f2fs. A 1 MiB mountinfo bound rejects
unknown nested filesystem types before output. Retained child records are
bounded at 100,000 and retained names at 32 MiB. A synthetic 20-level tree with
4,440-byte GNU output records verifies original-native execution beyond this
path budget. Unbounded controls, unsupported combinations and user actions
remain original-native.

Two injected fd failures compare complete GNU output while recording 14 local
GNU depth-one discoveries, zero real fd invocations and no original-command
replay. Preparation failures use original GNU before output. A paused consumer
still receives all 288,036 expected bytes. Six dispatcher cancellation checks
return 130/143/129 and remove owned private directories. Separate private Bash
process-group checks compare shell-visible status, output prefixes and cleanup;
handled SIGINT can exit normally with 130 while native GNU terminates by
SIGINT. PID-only interruption of a waiting outer Bash is compared separately.
These assertions do not claim identical raw process termination in every route.

The immutable archive SHA256 is
`62f43c0f548c35eee8b67f94cfa21aa11db4db02e726a9c966f2bfb371045bee`.
Its implementation and test hashes agree between both captures and current
files. Historical qualification records are retained separately. A subsequent
documentation-only pack has its own archive hash; it does not replace this
qualification identity.

## Earlier pure-expression acceleration qualification

The earlier pure-expression parser was qualified through the actual extracted npm archive,
including its public launcher, offline installed executable and Pi SDK scope.
The new generated pure-expression campaign judges results with GNU directly;
its generator imports no production parser or predicate evaluator. It requires
one real fd search for every starting root and zero native fallbacks.

The focused regressions cover regex candidate filters dropping invalid UTF-8
filenames, Unicode folding outside the qualified byte locales and omitted GNU
trailing-slash path warnings.
Malformed, warning-producing and unsupported expressions must retain native
diagnostics before any candidate output is published.

The [expanded qualification record](expanded-qualification.json) identifies
the tested archive and unchanged implementation/test hashes. Counts from the
two campaigns are reported separately: the seeded CLI corpus includes native
routes, whereas the new expression corpus requires actual fd execution.
Locale/argv cases and distinct argv spellings are also separate counts.
Repeated environment replays do not create new unique-case coverage.

| Environment | Node | GNU find | fd engine | Core / campaign / SDK tests | Result |
| --- | --- | --- | --- | ---: | --- |
| Local Linux | 26.4.0 | 4.11.0-modified | fd 9.0.0 | 56 / 2 / 6 | 64 passed |
| Linux VM | 24.21.0 | 4.10.0 | fdfind 10.2.0 | 56 / 2 / 6 | 64 passed |

Each environment recorded 3,607 fd searches and 778 native invocations in the
3,072-case seeded campaign. The new 1,536-case expression campaign recorded
2,152 fd searches and no native invocations. Neither campaign had a mismatch
or unexpected runtime fallback. These counts include multiple-root searches;
they are not all counts of separate commands. Core regressions and package
child checks add separate comparisons, and no assertion total is claimed.

## Original standalone qualification (historical)

The same packed archive passed deep verification and the optional Pi SDK tier
in both environments on **11 October 2026**. The [qualification record](qualification.json)
retains artifact identities, source hashes and bounded comparison evidence.

| Environment | Node | GNU find | fd engine | Node tests | Distinct full CLI comparisons | Mismatches |
| --- | --- | --- | --- | ---: | ---: | ---: |
| Local Linux | 26.4.0 | 4.11.0-modified | fd 9.0.0 | 55 | 3,072 | 0 |
| Linux VM | 24.21.0 | 4.10.0 | fdfind 10.2.0 | 55 | 3,072 | 0 |

These are **3,072 distinct cases replayed twice**, not 6,144 unique cases.
Each environment recorded 2,140 fd-qualified plans and 932 native plans,
with 3,364 actual fd searches, 932 actual native invocations and zero
unexpected runtime fallbacks from qualified plans. A command can have
multiple starting paths, so actual fd searches exceed fd-qualified plans.

Each run passed **48 core, 1 campaign and 6 SDK Node tests**, with no failures,
skips, cancellations or TODOs. The campaign's one Node group contains the
3,072 CLI comparisons. The installed **Pi SDK 0.84.2** scope checks recorded
seven additional fd calls with zero network or inference requests.

The package gate also passed ten child checks, five against the extracted
package and five against its offline npm installation; those child checks are
reported separately from the 55 Node tests. Four targeted faulty variants were
rejected, and their four clean controls passed, covering root handling, order,
argument preservation and owned-process cleanup.

Code and test hashes match the deep qualification, and both captures used the
same archive. Documentation-only additions change the archive hash; the
qualification record distinguishes that tested archive from subsequent package
checks rather than presenting an old tarball identity as the new one.

Requalify after changing code or engine versions. Finite tests cannot prove
every expression, locale, filesystem or concurrent mutation schedule, and
correctness qualification is not a speed benchmark.

## GNU predicate broker verification

The metadata tests compare full original GNU commands with fd discovery plus nonrecursive GNU evaluation. Reports separately count real fd searches, compile-only GNU validation, candidate-only GNU evaluation, scan-free starting files and original-command fallbacks. A compile check or a GNU fallback receives no fd acceleration credit.

Owned fixtures exercise permissions, sizes, owners, timestamps, reference files, link targets, arbitrary globs/regexes, locale changes, raw filenames, depth, H/L traversal, filesystem boundaries and GNU formats. Contextual `%P` formatting deliberately exposes its potentially large helper-process count. Directory access-time and logical cross-filesystem controls preserve the observed native behavior. These boundaries and counts must be retained when interpreting speed or compatibility.
