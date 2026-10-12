#!/usr/bin/env python3
"""Render the Rust engine report from qualified measurements and package checks."""

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent


def main():
    performance = json.loads((ROOT / "docs/rust-engine-performance.json").read_text())
    qualification = json.loads((ROOT / "docs/rust-engine-qualification.json").read_text())
    if performance["status"] != "passed" or qualification["status"] != "passed":
        raise ValueError("Both captures must pass before publishing measurements")
    if performance["executableSHA256"] != qualification["executable"]["SHA256"]:
        raise ValueError("The timing and package tests must qualify the same release executable")
    native = [case for case in performance["cases"] if case["route"]["route"] == "native"]
    faster_gnu = sum(case["medianMs"]["rust"] < case["medianMs"]["gnu"] for case in native)
    comparable_fd = [case for case in native if "fd" in case["medianMs"]]
    faster_fd = sum(case["medianMs"]["rust"] < case["medianMs"]["fd"] for case in comparable_fd)
    rows = []
    compared_previous = "previousExecutableSHA256" in performance
    for case in performance["cases"]:
        timing = case["medianMs"]
        fd = f'{timing["fd"]:.3f}' if "fd" in timing else "—"
        route = case["route"]
        execution = f'Rust, {route["strategy"]}' if route["route"] == "native" else "GNU fallback"
        previous = f' {timing["previousRust"]:.3f} |' if compared_previous else ""
        rows.append(f'| {case["description"]} | {timing["gnu"]:.3f} | {fd} |{previous} {timing["rust"]:.3f} | {execution} |')
    old_heading = " Previous Rust ms |" if compared_previous else ""
    old_alignment = " ---: |" if compared_previous else ""
    comparison_note = ""
    if compared_previous:
        improved = sum(case["medianMs"]["rust"] < case["medianMs"]["previousRust"] for case in native)
        comparison_note = f'''The archived previous Rust release was measured on the same owned trees,
in the same rotated trial order, rather than comparing captures from different
times. {improved}/{len(native)} native-class medians improved. Its SHA-256 is
`{performance["previousExecutableSHA256"]}`. The previous executable is an
explicit optional benchmark input; ordinary package verification needs no
archived binary.
'''
    counts = qualification["tests"]
    text = f'''# Native Rust find engine

`rust/target/release/find2fd-rust` accepts GNU find arguments and performs
qualified physical directory searches inside one native process. The public CLI
and private Pi Bash hook select this release by default once it is built. Its fd-style
parallel discovery uses anchored Linux directory reads and Rayon; it launches neither fd
nor Node. Unsupported expressions execute `/usr/bin/find` directly with the
original argument bytes and `find` as argv[0].

## Measurements

Captured {performance["createdAt"]}, with {performance["warmupsPerEngineCase"]}
warmups and {performance["runsPerEngineCase"]} rotated timed trials per engine
and class. These are warm-cache owned synthetic trees in the C locale.
The large fixture contains 30,000 second-level directories and approximately
150,000 entries; the medium fixture contains 5,120 second-level directories.
The baselines are {performance["versions"]["GNU find"]} and
{performance["versions"]["fd"]}.

| Workload | Direct GNU find ms | Direct fd ms |{old_heading} Rust executable ms | Execution |
| --- | ---: | ---: |{old_alignment} ---: | --- |
{chr(10).join(rows)}

{len(native)} classes execute native Rust searches. Their medians are lower
than direct GNU in {faster_gnu}/{len(native)} cases and lower than direct fd
in {faster_fd}/{len(comparable_fd)} comparable cases. GNU fallback is recorded
separately and receives no native acceleration credit. Sub-millisecond margins
and finite warm-cache fixtures do not establish universal wins.

{comparison_note}

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
`{performance["executableSHA256"]}`.

## GNU correctness and packaging

The independently rebuilt npm source artifact passed
**{qualification["fullGNUComparisons"]} exact GNU comparisons**, including
**{counts["rustSearches"]} native Rust suite searches**. Native, fallback and
transport comparisons are counted separately. The suite exercises expression
precedence, short-circuit/repeated output, root inclusion and spelling, hidden
and ignored files, byte filenames, globs, depth, ordered parallel traversal,
unsupported options, safe action delegation, permissions and output failures.
GNU fallback is compatibility coverage, rather than proof that those features
have been reimplemented in Rust.

Verification packs the actual npm distribution, checks source identities and
build-output exclusion, extracts it outside the checkout, rebuilds locked
dependencies offline into an independent release target, and runs the packaged
oracle and process-timer tests there. The rebuilt executable has the same
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
node --test tests/test_rust_engine.mjs tests/test_find_rust_routing.mjs
node tools/verify-rust-artifact.mjs --output docs/rust-engine-qualification.json
python3 tools/benchmark-rust-engine.py --output docs/rust-engine-performance.json
python3 tools/render-rust-results.py
```

The public CLI and provider-scoped Pi hook select the compiled Rust release
without a Node/fd helper. Source-only installs and explicit optouts use GNU;
FIND2FD_EXPERIMENTAL_FD=1 retains the older JS/fd experiment. The private Bash
function is not exported: user shells, explicit native bypasses and child
scripts retain system find.
'''
    (ROOT / "docs/rust-engine.md").write_text(text)


if __name__ == "__main__":
    main()
