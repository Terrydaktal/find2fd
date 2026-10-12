# find2fd

find2fd accepts GNU `find` commands and runs qualified searches in a native Rust engine. It uses fd-style parallel directory traversal while preserving GNU output order, path bytes, diagnostics, exit status and action boundaries. Unsupported expressions run original GNU find before any result is emitted.

The package provides a direct CLI, a private Bash function and an optional Pi extension. Once the release is built, the CLI and allowed-provider Pi model shell calls such as `qwen-r9700` use Rust by default, with no Node or fd process for ordinary searches. User `!` commands, ordinary interactive shells, explicit native bypasses and child scripts keep system GNU find. It needs no model or inference backend.

Set `FIND2FD_ACCELERATION=off` to force GNU. An installation without a compiled release also uses GNU. `FIND2FD_RUST_BINARY=/absolute/path/to/find2fd-rust` selects a separately built release. Setting `FIND2FD_EXPERIMENTAL_FD=1` explicitly selects the retained JS/fd compatibility experiment, including routes slower than GNU; other explicitly set values use GNU.

## Native Rust engine

The compiled `find2fd-rust` executable performs qualified GNU find
searches inside one Rust process. It uses sequential or ordered parallel
directory discovery, with no Bash, Node or fd startup in the native search
path. Unsupported expressions execute GNU find with the original arguments.
The CLI and private Pi Bash hook now select this release by default. The table
below measures the native executable directly: Bash launcher/prefix setup is
not included and has not been assigned these direct-executable timings.

The independently rebuilt package passed **706 exact GNU comparisons**,
including **567 native engine searches** and **42 Node CLI/Pi comparisons**. Rust units passed **11 checks in each of debug and release**. Thirty-one rotated
warm-cache trials per class measured the current Rust release alongside direct
GNU find and fd on the same trees. The 22 workloads include case-insensitive,
path, compound and repeated-output searches.

| Workload | Direct GNU find ms | Direct fd ms | Optimized Rust ms | Execution |
| --- | ---: | ---: | ---: | --- |
| 128-file sparse name | 0.470 | 8.951 | 0.476 | Native Rust |
| 8K-file flat sparse name | 2.216 | 9.379 | 1.783 | Native Rust |
| 180-level chain sparse name | 0.880 | 8.954 | 0.799 | Native Rust |
| 5K-directory layered sparse name | 16.353 | 10.400 | 3.222 | Native Rust |
| 30K-directory sparse exact name | 103.707 | 21.439 | 14.081 | Native Rust |
| 30K-directory sparse star glob | 103.584 | 21.666 | 14.194 | Native Rust |
| 30K-directory sparse name/type | 102.603 | 20.932 | 13.990 | Native Rust |
| 30K-directory absent name | 101.493 | 20.738 | 13.942 | Native Rust |
| 30K-directory repeated filename | 104.813 | 21.680 | 14.842 | Native Rust |
| 30K-directory broad name output | 109.008 | 23.201 | 17.108 | Native Rust |
| 30K-directory all regular files | 101.405 | 23.475 | 17.161 | Native Rust |
| 30K-directory depth-one sparse name | 0.543 | 9.155 | 0.495 | Native Rust |
| Metadata size predicate | 165.461 | — | 164.668 | GNU fallback |
| GNU printf format | 102.964 | — | 102.993 | GNU fallback |
| Boolean with short-circuit output | 110.732 | — | 14.694 | Native Rust |
| Case-insensitive sparse name | 102.394 | 21.098 | 14.068 | Native Rust |
| Full-path sparse glob | 103.095 | 22.672 | 14.387 | Native Rust |
| Compound name/type negation | 17.813 | 10.798 | 3.482 | Native Rust |
| Repeated print actions | 14.953 | — | 3.181 | Native Rust |
| Prune control | 0.359 | — | 0.574 | GNU fallback |
| GNU exec action | 0.548 | — | 0.774 | GNU fallback |
| Missing-root diagnostics | 0.266 | — | 0.462 | GNU fallback |

Rust was faster than fd in **15/15 comparable classes** and GNU find in
**16/17 native classes** in this capture. Large-tree native searches took roughly
14–17 ms. GNU fallback rows do not receive native acceleration credit. These
finite warm-cache results do not establish universal performance across
filesystems, cold caches or expression classes.

Rust preserves exact GNU ordering. Direct fd can return the same records in a
different order. Measurements include process startup and complete output
capture. The optimization removes redundant directory opens, duplicate filename
allocations and per-file shared-counter traffic, specializes common globs, and
avoids workers on depth-one searches. Anchored no-follow traversal, raw path
bytes, conservative bounds and fallback before output remain checked.

```bash
cargo build --release --locked --manifest-path rust/Cargo.toml
rust/target/release/find2fd-rust . -type f -name '*.ts' -print0
npm run test:rust
npm run test:integration
node tools/verify-rust-artifact.mjs --output artifacts/rust-package.json
python3 tools/benchmark-rust-engine.py --output artifacts/rust-performance.json
```

See [the Rust engine](docs/rust-engine.md) for measured timings, independently
rebuilt package verification, supported expressions and GNU fallback boundaries.
This native executable needs Linux, Rust 1.90 or newer to build, and GNU find
at runtime for compatibility fallback. An installed fd is needed for the
comparative benchmark, rather than native execution.

## Historical JS/fd routing

This retained capture describes the former automatic JS/fd policy, before Rust became the default. It does not describe current CLI or Pi timings.

Warm-cache seven-run medians on owned synthetic trees, with randomized engine order after one warmup. These are actual CLI completion times, including Bash/Node startup, policy sampling, ordering and output. The larger tree has 30,000 second-level directories and about 150,000 entries. Original GNU remains fastest for many classes; automatic routing includes a small dispatch cost and does not claim zero overhead.

| Workload | GNU find ms | Automatic wrapper ms | Broader fd experiment ms | Automatic engine |
| --- | ---: | ---: | ---: | --- |
| 128-file sparse search | 1.45 | 4.12 | 36.60 | GNU |
| 8K-file flat search | 3.45 | 5.96 | 47.38 | GNU |
| 180-level chain | 2.03 | 4.89 | 41.94 | GNU |
| 5K-directory layered sparse search | 19.99 | 23.79 | 42.41 | GNU |
| 30K-directory layered sparse exact name | 112.76 | 84.38 | 62.12 | fd |
| 30K-directory layered sparse star glob | 116.06 | 86.52 | 66.25 | fd |
| 30K-directory layered absent name | 120.28 | 83.81 | 65.69 | fd |
| 30K-directory repeated filename | 120.79 | 129.42 | 272.77 | GNU |
| 30K-directory broad type output | 101.16 | 103.55 | 324.40 | GNU |
| 30K-directory metadata | 169.08 | 173.66 | 394.54 | GNU |
| 30K-directory GNU output format | 104.28 | 108.23 | 319.80 | GNU |
| 128-file prune expression | 1.46 | 3.48 | 298.87 | GNU |

The four admitted sparse large-tree cases saved **28–36 ms (25–30%)** versus direct GNU in this capture. Broad, metadata, format and control cases stay GNU because the full fd compatibility route was slower. The audit records all remaining option and interaction decisions. The retained capture from the earlier `tools/benchmark-routing.py` policy records complete numeric samples and GNU output/status checks. Its source hashes identify the historical implementation; current default routing no longer follows that policy.

These local timings are a class qualification rather than an oracle for every call. The topology and bounded density sample can mispredict an irregular or changing tree; cache state, filesystem and CPU also affect performance. `FIND2FD_ACCELERATION=off` provides a direct GNU override.

## Requirements

- Public execution needs Linux, **GNU find**, **Bash** and GNU coreutils `readlink`. Build the native release with **Rust/Cargo 1.90 or newer**; without it the launcher uses GNU.
- Experiments and JS helpers additionally need **Node.js 24 or newer** and **GNU coreutils `readlink`**.
- **fd 9 or newer**, named `fd` or Debian's `fdfind`, plus GNU coreutils `stat` and `head`, for retained JS experiments and comparative benchmarks. Native Rust execution does not require fd.
- util-linux `script` and GNU coreutils `mkfifo` for the incremental prune/quit route; failed preparation uses GNU unchanged.
- Python 3, npm and tar for verification and package checks.
- An installed Pi SDK only for the optional Pi extension or `--sdk` verification.

GNU find remains a runtime dependency. In the explicit experiment, common listings use fd and the in-process evaluator; richer read-only expressions use fd discovery followed by nonrecursive GNU predicate evaluation. Eligible physical preorder prune/quit uses incremental fd listing after each GNU decision; user actions and unsupported control combinations retain native execution.

## Install

Install the checkout with a user prefix:

```bash
git clone https://github.com/Terrydaktal/find2fd.git
cd find2fd
cargo build --release --locked --manifest-path rust/Cargo.toml
npm install --global --prefix "$HOME/.local" .
export PATH="$HOME/.local/bin:$PATH"
```

The npm postinstall hook also builds the release when Cargo is available. Missing Cargo leaves a working GNU fallback; a Cargo compilation failure is reported as an installation error. To build it later, run `npm run build:rust` in the installed package. Published source packages exclude machine-specific build output.

Alternatively, build the checkout and create links:

```bash
cargo build --release --locked --manifest-path rust/Cargo.toml
mkdir -p "$HOME/.local/bin"
ln -s "$(pwd)/bin/find2fd" "$HOME/.local/bin/find2fd"
ln -s "$(pwd)/bin/find2fd-shell-prefix.mjs" "$HOME/.local/bin/find2fd-shell-prefix"
```

Keep that checkout in place, or recreate the links after moving it. Do not replace or symlink the system `find` executable.

## Direct CLI

Ordinary calls use native Rust for qualified physical searches and GNU for unsupported cases. These commands preserve GNU semantics:

```bash
find2fd -P . -type f -name '*.ts' | head -50
find2fd src -mindepth 1 -maxdepth 3 -type f -name '*test*' -print0
find2fd . -type d -name 'build' -print | cat
find2fd src \( -name '*.ts' -o -name '*.js' \) -type f -print0
LC_ALL=C find2fd src -iname '*.md' -print0
```

Native Rust uses GNU for newline output on a terminal so GNU pathname quoting is preserved. Piped or redirected newline output, and `-print0`, can qualify for Rust. Preparation, path, locale, resource and descriptor checks can still require GNU.

Metadata searches, pruning and command actions retain GNU execution:

```bash
find2fd . -type f -mtime -1 -print
find2fd . -type f -name '*.log' -exec wc -l '{}' +
find2fd . -maxdepth 8 -name node_modules -prune -o -name '*.ts' -print
```

`find2fd --help` and `find2fd --version` return GNU find's help and version. Ordinary wrapper calls do not add flags to the GNU expression. The directly invoked Rust release also exposes `--find2fd-route-json` for bounded, read-only route diagnostics. Exit status follows find: a successful search returns `0`, including a search with no matches; errors return a nonzero status.

## What qualifies for fd

The explicitly enabled experiment has three fd routes. Common byte-safe listings run in-process. Richer read-only expressions use a GNU predicate broker. Pure physical prune/quit expressions evaluate each entry before fd lists its children:

| Part | Supported fd route |
| --- | --- |
| Starting paths | Existing normalized paths, including valid Unicode; files are evaluated without an unnecessary walk, and mixed file/directory roots retain their order |
| Expressions | GNU AND, OR, NOT, parentheses, comma, default printing and explicit repeated output actions |
| Matching | GNU name/path/link-target globs, regex dialects, case folding and locales through the predicate broker |
| Metadata | Size, permissions, ownership, IDs, links, inode, filesystem, access checks, modification/change times and reference tests |
| Traversal | Leading depth/minimum/maximum depth, physical traversal, `-L`, `-H`, `-follow`, `-xdev` and `-mount`, within the qualification boundaries |
| Output | `-print`, `-print0`, `-ls`, GNU `-printf`, including original root, relative path and depth fields |
| Descent controls | Pure physical preorder `-prune`/`-quit` with a leading finite `-maxdepth`, proved path-byte budget, Boolean expressions and noncontextual output; GNU decides before each immediate fd child listing |

The GNU broker receives fd-discovered descendants and separately included starting paths on a private descriptor and runs with `-maxdepth 0`; it does not walk the tree again. File-only starting paths need no fd query and receive no traversal acceleration credit. Caller descriptors remain available to GNU, including process substitutions and `-exec` output descriptors, and private input uses a free descriptor slot. Compile-only GNU checks and candidate evaluation are counted separately from an original-command fallback. Context-dependent `%P` formatting can require one GNU evaluation process per path and can be substantially slower than native find; fd routing is not a universal speed guarantee.

`-exec`, `-execdir`, `-ok`, `-okdir`, `-delete`, output-file actions, unqualified pruning/termination combinations, `-files0-from` lists and `-ignore_readdir_race` retain GNU's complete execution. Leading `-noignore_readdir_race` can qualify through the broker; its late placement remains native. Buffered directory/symlink access-time tests also stay native because an earlier fd walk can change the value being tested. The incremental control route preserves the evaluate-before-descent boundary and parse-time references in one GNU process. Contextual formatting on a terminal, split-request warnings, logical cross-filesystem boundaries and other detected compatibility problems use native execution. [Compatibility](docs/compatibility.md) records the exact bounds. These native cases are compatible, but they are **not** counted as acceleration.

Incremental pruning requires a leading finite `-maxdepth` and a conservative path-byte proof. Unbounded controls stay native because GNU can traverse beyond Linux `PATH_MAX` using directory anchors that the broker cannot preserve. Eligible pruning does not prewalk excluded trees. A root-only prune or quit needs no fd query. Once output starts, a failed fd directory query can continue through a local GNU depth-one listing without replaying earlier predicates or output. Starting fd per directory has a cost, so this is compatible engine contribution rather than a universal speed guarantee.

## Use inside one Bash shell

Load the private Rust-dispatching function into one shell:

```bash
eval "$(find2fd-shell-prefix)"
find -P . -type f -name '*.ts' | head -50
```

`find2fd-shell-prefix` takes no arguments. Its Node process prints the function definition once, pinning the package-relative Rust path and the Node path used only by the explicit experiment. Subsequent ordinary searches invoke Rust directly, without another Node process. The function is not exported to child shells. User scripts and subprocesses continue using the system executable.

These calls explicitly bypass the function:

```bash
command find . -type f -name '*.ts'
/usr/bin/find . -type f -name '*.ts'
```

Remove it with `unset -f find`, or close the shell. For another harness, prepend the prefix to the model's Bash command rather than changing the user's global shell environment.

The Bash functions can be loaded alongside grep2rg's function:

```bash
eval "$(grep2rg-shell-prefix)"
eval "$(find2fd-shell-prefix)"
```

They define different commands. The separate Pi extensions both replace the native `bash` tool, so **do not load both extensions independently**. To use both in Pi, integrate `withGrepWrapper` and `withFindWrapper` in one composed `spawnHook` in your harness.

## Pi integration

Load the optional extension from the checkout:

```bash
pi -e /path/to/find2fd/pi/find2fd.ts
```

Or install its declared Pi package:

```bash
pi install /path/to/find2fd
```

The extension keeps Pi's native `bash` tool and adds the private Rust-dispatching find function to eligible model-issued commands by default. User `!` commands retain normal shell execution. The default provider is `qwen-r9700`; an exact comma-separated list replaces that default:

```bash
export FIND2FD_PI_PROVIDERS='qwen-r9700,my-local-provider'
pi -e /path/to/find2fd/pi/find2fd.ts
```

An explicitly empty value enables no providers. Other providers require opt-in.

This extension installs its own native `bash` override. If your harness already overrides that tool, compose the wrapper hook within that implementation rather than registering a second competing tool.

The package exports the wrapper helper for that composition:

```js
import { withGrepWrapper } from "grep2rg";
import { withFindWrapper } from "find2fd";

function searchSpawnHook(context, shellPath) {
  return withFindWrapper(withGrepWrapper(context, shellPath), shellPath);
}
```

Attach it through one native Bash tool's `spawnHook`, keeping your harness's provider checks and existing settings. The standalone extensions do not install this combined hook for you.

## How execution works

1. CLI, private Bash and allowed-provider Pi calls honor explicit GNU optouts. Closed standard descriptors delegate immediately so runtime initialization cannot change their meaning.
2. Default calls invoke the package-relative `rust/target/release/find2fd-rust`, or `FIND2FD_RUST_BINARY` when explicitly provided. A missing build delegates directly to GNU. No Node helper, fd subprocess or topology sample runs on this default path.
3. Rust parses the qualified expression and performs bounded physical traversal. Directory descriptors anchor no-follow descent; raw filenames and GNU sibling order are preserved. Starting paths are included, booleans short-circuit, and repeated print actions retain their exact placement.
4. Native results remain buffered until preparation succeeds. Unsupported syntax, metadata/actions, locale cases or failed preparation execute `/usr/bin/find` with the original arguments before output. Output errors after emission never replay the search or actions.

See [Rust bounds and fallback boundaries](docs/rust-engine.md#fallback-boundaries) for supported expressions and conservative memory, traversal and output limits.

The explicitly enabled JS experiment retains the older fd discovery, ordering and nonrecursive GNU predicate broker. Its resource limits are distinct from those of the default Rust engine:

Each fd search has a **10-second timeout**, with a **32 MiB** candidate-capture cap across starting paths. Separate limits cover 100,000 candidates, 10,000 ordering directories and 200,000 ordering entries. Expressions are bounded to **256 nodes**, **64 nesting levels** and **8,192 bytes per predicate or format argument**. The in-process listing route also caps rendered output at **32 MiB** and **100,000 records**, including repeated print actions. The GNU broker bounds its input lists and contextual rewrites before output, then inherits stdout without those listing-output caps. Any ordering directory exceeding **10,000 entries** uses GNU find because GNU's FTS traversal can switch to inode ordering. See [the complete bounds](docs/compatibility.md#resource-bounds).

Recovering order repeats directory enumeration for the candidate ancestors; broad searches can therefore re-enumerate most directories. It does not run a second GNU find traversal to build an ordering map, but it is additional work, and fd is not universally faster. Detected missing paths or type inconsistencies cause fallback; the wrapper does not provide an atomic filesystem snapshot or prove equivalence under arbitrary concurrent changes.

## Verification

Tests follow the implementation boundary:

| Layer | Language and location | Run |
| --- | --- | --- |
| Native parser, matcher, traversal and resource invariants | Rust unit/property tests under `rust/src/` | `npm run test:rust:unit` |
| Actual optimized engine versus GNU, including seeded and fault cases | Rust release harness under `rust/tests/` | `npm run test:rust:oracle` |
| Pi Bash scope and public CLI integration | JavaScript under `tests/` | `npm run test:integration` |
| Retained experimental JavaScript adapters | JavaScript under `tests/` | `node tools/verify.mjs --core` |

`npm test` runs the Rust, integration and adapter layers. `npm run test:rust`
runs the native layers without Node test assertions. Plain `cargo test --locked
--manifest-path rust/Cargo.toml` runs the fast Rust unit/property checks; the
`release-oracle` feature explicitly enables the longer GNU comparison campaign.
The external campaign tests the uninstrumented optimized executable, even when
unit tests use a debug build. GNU fallback checks retain separate counts and do
not claim native implementation coverage.

`npm run verify:rust` packs and extracts the actual npm source archive, builds
an independent production release, runs Rust units in debug and release, and
executes the Rust oracle and Node integration tests outside the checkout. Its
report rejects empty/skipped suites, missing classes and mismatched artifact
identities. The GNU campaign runs once per qualification; debug and release
unit results are reported separately rather than adding duplicate GNU cases.

The compiled dispatch regression traces the actual public and private Bash exec chains. It verifies Rust execution without Node/fd, exact GNU fallback, optouts and missing builds, local scope, closed descriptors and relocated/symlinked installations. Run the engine suite with `npm run test:rust` and the launcher/Pi checks with `npm run test:integration`; `node tools/verify-rust-artifact.mjs` rebuilds and tests the shipped source outside the checkout.

Run focused checks, then the bounded or larger synthetic campaigns:

```bash
npm run build:rust
node tools/verify.mjs --core --output artifacts/core.json
node tools/verify.mjs --output artifacts/default.json
node tools/verify.mjs --deep --output artifacts/deep.json
```

Before release, verify the extracted npm artifact:

```bash
node tools/verify-artifact.mjs --deep --output artifacts/package-deep.json
```

SDK checks are explicit:

```bash
FIND2FD_TEST_PI_ROOT=/path/to/node_modules/@earendil-works \
  node tools/verify-artifact.mjs --deep --sdk --output artifacts/package-deep-sdk.json
```

Tests use disposable synthetic trees and compare output bytes, diagnostics and exit status with GNU find. The suite distinguishes actual CLI comparisons, routing decisions and verified fd invocations. See [verification](docs/verification.md) for coverage and evidence. No universal equivalence or speed claim follows from a finite test suite.

The historical automatic JS/fd product source passed **102 Node groups** through the extracted npm artifact: **93 core, 2 deep campaigns and 7 installed-Pi SDK groups**, with no failures, skips or source changes. The campaigns completed **3,072 seeded GNU comparisons** and **1,536 locale/expression comparisons**, with zero mismatches and zero runtime fallbacks in qualified cases. The automatic-routing regression adds 20 complete GNU comparisons with eight actual automatic fd calls; the speed capture adds 432 timing/warmup comparisons across 18 classes. [Historical automatic qualification](docs/automatic-qualification.json) records exact hashes and scope, including its tested archive identity. Documentation edits after that test do not redefine the archive's original bytes.

The retained pre-automatic qualification tested experimental semantic routes and the previous native-default policy. The packed build passed **100 Node test groups** in each of the Node 26/fd 9 desktop and Node 24/fdfind 10 VM environments: **91 core, 2 campaign and 7 SDK groups**, including offline installation, with no failures or skips. Both replayed the **3,072-case seeded CLI** and **1,536-case expression** campaigns with zero mismatches. The expression campaign required 2,152 actual fd searches and zero native fallbacks. The seeded campaign separates 350 original-native cases, 16 incremental cases and 340 scan-free cases from 2,366 batched fd-search cases; those routes made 3,743 actual fd calls per environment. Metadata, formatting, raw-byte, traversal, descriptor, documented-alias and cancellation regressions add separately recorded checks. See [pre-automatic qualification](docs/broader-qualification.json) for the immutable archive, hashes and actual routing evidence, and [the coverage map](docs/coverage.json) for explicit native boundaries. Replaying a corpus on two environments does not double unique-case coverage.

The [earlier expanded qualification](docs/expanded-qualification.json), which passed 64 Node tests per environment before the metadata/formatting broker and descriptor repair, and [original qualification](docs/qualification.json) remain historical evidence.

## Project structure

```text
find2fd/
├── bin/
│   ├── find2fd                   Public Bash CLI; Rust default, direct GNU fallback and explicit JS experiment
│   ├── find2fd.mjs               Internal Node dispatcher; original GNU arguments
│   └── find2fd-shell-prefix.mjs  Emits the private Bash function
├── src/
│   ├── find-options.mjs         GNU expression parsing and qualification
│   ├── find-order.mjs           Candidate records, ancestor ordering and path rendering
│   ├── find-evaluate.mjs        Nonrecursive GNU predicates and contextual formatting
│   ├── find-descriptors.mjs     Caller descriptor preservation and private input slots
│   ├── find-incremental.mjs     GNU control decisions before immediate fd listing
│   ├── find-runtime.mjs         fd execution, limits and transparent GNU fallback
│   └── find-wrapper.mjs         planFind, runFind and withFindWrapper interfaces
├── pi/
│   └── find2fd.ts               Optional provider-scoped native Pi bash integration
├── rust/
│   ├── Cargo.toml               Native Rust executable and locked dependencies
│   ├── Cargo.lock               Reproducible dependency resolution
│   ├── src/main.rs              GNU-compatible parsing, matching and ordered traversal
│   ├── src/tests.rs              Native unit/property tests
│   └── tests/gnu_oracle.rs       Release GNU comparisons and owned fault fixtures
├── tests/                       Pi/package and retained JavaScript adapter checks
├── tools/
│   ├── verify.mjs               Tiered checks and structured JSON reports
│   ├── verify-artifact.mjs      Packs, extracts and verifies the existing npm CLI
│   ├── verify-rust-artifact.mjs Rebuilds and verifies the packaged Rust source
│   ├── benchmark-processes.py  Bounded process timer with complete byte capture
│   └── benchmark-rust-engine.py Compares Rust, direct GNU find and direct fd
├── docs/                        Compatibility and verification details
├── package.json                 CLI, runtime and optional Pi metadata
├── LICENSE                      Full Apache License 2.0
└── NOTICE                       Copyright and implementation origin
```

Install the dependencies and package, then use the CLI or opt into a shell or harness integration. Run verification after changing the code or engine versions.

## Origin and license

This is a new GNU find compatibility implementation by **Terrydaktal**. Its packaging and scoped shell/Pi integration follow the approach developed for [grep2rg](https://github.com/Terrydaktal/grep2rg); it was not extracted from an existing find wrapper. GNU find and fd are separately installed dependencies, and their implementation code is not included here.

find2fd's original code is licensed under [Apache 2.0](LICENSE). See [NOTICE](NOTICE) for attribution.
