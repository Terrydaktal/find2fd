# Verification

Tests use GNU find as the independent oracle. They execute public entry points
against disposable synthetic trees and compare stdout bytes, stderr bytes and
exit status. No private filesystem corpus or model request is needed.

## Run order

1. Install Linux, Node 24+, GNU find, fd 9+ (`fd` or `fdfind`), Bash, GNU
   coreutils `readlink`/`mkfifo`, Python 3, npm and tar.
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

The fd candidate path needs direct tests for default print and print0, starting
directories, file types, supported name patterns, depth limits, repeated roots,
GNU path spelling, hidden/ignored entries and ordering. Verify actual fd
execution with an owned executable recorder, separately from parser routing.

The native path needs tests for unsupported expressions, invalid arguments,
non-ASCII argument bytes, absent or faulty fd, actions and malformed output.
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

## Standalone qualification

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
