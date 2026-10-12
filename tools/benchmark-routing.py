#!/usr/bin/env python3
"""Measure shipping automatic routes against GNU and the broader fd experiment.

Owned warm-cache fixtures only. No chat data, cache dropping or user actions.
Results include entry-point startup, policy sampling, traversal and output.
"""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import platform
import random
import shutil
import statistics
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parent.parent


def tree(root, parents, children, files=4, sparse_every=20):
    root.mkdir()
    for top in range(parents):
        parent = root / f"parent-{top:03}"
        parent.mkdir()
        for child in range(children):
            directory = parent / f"child-{child:03}"
            directory.mkdir()
            for leaf in range(files):
                (directory / f"common-{leaf}.txt").write_bytes(b"owned fixture\n")
            if top % sparse_every == 0 and child == 0:
                (directory / "rare-result.dat").write_bytes(b"owned fixture\n")


def measure(command, env, cwd):
    start = time.perf_counter_ns()
    native = command[0] == "/usr/bin/find"
    invocation = ["find", *command[1:]] if native else command
    result = subprocess.run(invocation, executable="/usr/bin/find" if native else None, env=env, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30)
    elapsed = (time.perf_counter_ns() - start) / 1e6
    return elapsed, result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True)
    parser.add_argument("--runs", type=int, default=7)
    args = parser.parse_args()
    if not 5 <= args.runs <= 31:
        parser.error("--runs must be between 5 and 31")
    env = os.environ.copy()
    env.pop("FIND2FD_EXPERIMENTAL_FD", None)
    env.pop("FIND2FD_ACCELERATION", None)
    env.update(LC_ALL="C", LANG="C")
    env.pop("POSIXLY_CORRECT", None)
    experimental = {**env, "FIND2FD_EXPERIMENTAL_FD": "1"}
    owned = Path(tempfile.mkdtemp(prefix="find2fd-routing-owned-"))
    # Share the root team's measurement lock: competing fixture creation/tests
    # must not be mistaken for wrapper overhead or a backend performance event.
    lock = open("/tmp/coherence-search-wrapper-benchmark.lock", "a")
    fcntl.flock(lock, fcntl.LOCK_EX)
    try:
        small = owned / "small"; small.mkdir()
        for index in range(128): (small / f"item-{index}.txt").write_bytes(b"owned\n")
        (small / "rare-result.dat").write_bytes(b"owned\n")
        flat = owned / "flat"; flat.mkdir()
        for index in range(8192): (flat / f"item-{index}.txt").write_bytes(b"owned\n")
        (flat / "rare-result.dat").write_bytes(b"owned\n")
        deep = owned / "deep"; deep.mkdir(); descendant = deep
        for index in range(180):
            descendant = descendant / "d"; descendant.mkdir()
            (descendant / "common.txt").write_bytes(b"owned\n")
        (descendant / "rare-result.dat").write_bytes(b"owned\n")
        medium = owned / "medium"; tree(medium, 64, 80)
        large = owned / "large"; tree(large, 100, 300)
        cases = [
            ("small-sparse", ["small", "-name", "rare-result.dat", "-print0"], "small trees: GNU"),
            ("wide-flat", ["flat", "-name", "rare-result.dat", "-print0"], "flat file-heavy trees: GNU"),
            ("deep-chain", ["deep", "-name", "rare-result.dat", "-print0"], "deep chains: GNU"),
            ("medium-sparse", ["medium", "-name", "rare-result.dat", "-print0"], "below measured topology threshold: GNU"),
            ("large-sparse-exact", ["large", "-name", "rare-result.dat", "-print0"], "large layered sparse names: fd"),
            ("large-sparse-glob", ["large", "-name", "rare*.dat", "-print0"], "large layered sparse star globs: fd"),
            ("large-sparse-type", ["large", "-type", "f", "-name", "rare-result.dat", "-print0"], "large layered sparse name/type: fd"),
            ("large-absent", ["large", "-name", "no-such-owned-name", "-print0"], "large layered absent names: fd"),
            ("large-dense-exact", ["large", "-name", "common-0.txt", "-print0"], "density sample rejects repeated names: GNU"),
            ("large-broad-name", ["large", "-name", "*.txt", "-print0"], "density sample rejects broad matches: GNU"),
            ("large-broad-type", ["large", "-type", "f", "-print0"], "unfiltered broad type output: GNU"),
            ("large-shallow", ["large", "-maxdepth", "1", "-name", "rare-result.dat", "-print0"], "shallow traversal: GNU"),
            ("large-metadata", ["large", "-type", "f", "-size", "+0c", "-print0"], "metadata broker startup and broad discovery: GNU"),
            ("large-format", ["large", "-name", "rare-result.dat", "-printf", "%p\n"], "GNU formats: GNU"),
            ("large-boolean", ["large", "-name", "rare-result.dat", "-o", "-name", "common-0.txt", "-print0"], "compound/repeated output ordering: GNU"),
            ("small-prune", ["small", "-maxdepth", "3", "-name", "node_modules", "-prune", "-o", "-print0"], "incremental per-directory fd/helper overhead: GNU"),
            ("small-exec", ["small", "-name", "rare-result.dat", "-exec", "/usr/bin/true", "{}", ";"], "command actions execute exactly once natively"),
            ("missing-root", ["not-present", "-name", "rare-result.dat", "-print0"], "GNU diagnostics: GNU"),
        ]
        rng = random.Random(120026)
        records = []
        for identifier, argv, policy in cases:
            commands = {"gnu": (["/usr/bin/find", *argv], env),
                        "automatic": ([str(ROOT / "bin/find2fd"), *argv], env),
                        "experimental_fd": ([str(ROOT / "bin/find2fd"), *argv], experimental)}
            _, expected = measure(commands["gnu"][0], env, owned)
            times = {name: [] for name in commands}
            checks = 0
            for repetition in range(args.runs + 1):
                order = list(commands); rng.shuffle(order)
                for name in order:
                    cmd, selected_env = commands[name]
                    elapsed, actual = measure(cmd, selected_env, owned)
                    if (actual.returncode, actual.stdout, actual.stderr) != (expected.returncode, expected.stdout, expected.stderr):
                        raise RuntimeError(f"GNU differential failure in {identifier}/{name}")
                    checks += 1
                    if repetition: times[name].append(elapsed)
            medians = {name: statistics.median(values) for name, values in times.items()}
            records.append({"id": identifier, "argv": argv, "policy": policy, "median_ms": medians,
                "samples_ms": times, "gnu_output_sha256": hashlib.sha256(expected.stdout).hexdigest(),
                "gnu_stdout_bytes": len(expected.stdout), "gnu_stderr_bytes": len(expected.stderr), "gnu_status": expected.returncode,
                "actual_gnu_differential_checks": checks,
                "speedup_vs_gnu": medians["gnu"] / medians["automatic"]})
            print(identifier, json.dumps(medians), flush=True)
        sources = [*sorted((ROOT / "src").glob("find-*")), ROOT / "bin/find2fd", ROOT / "bin/find2fd.mjs",
                   ROOT / "bin/find2fd-shell-prefix.mjs", ROOT / "pi/find2fd.ts", Path(__file__).resolve()]
        versions = {}
        for program, argv in [("gnu_find", ["/usr/bin/find", "--version"]), ("fd", ["fd", "--version"]), ("node", ["node", "--version"])]:
            versions[program] = subprocess.check_output(argv, text=True).splitlines()[0]
        result = {"schemaVersion": 1, "capture_date": "2026-10-12", "platform": platform.platform(),
            "logical_cpus": os.cpu_count(), "versions": versions, "clock": "perf_counter_ns: monotonic wall-clock",
            "scope": "Actual shipping Bash CLI, including shell/Node startup, policy metadata and bounded density sampling, ordering and output. Owned warm-cache synthetic fixtures. No universal speed claim.",
            "runs_per_engine_case": args.runs, "warmup_runs_per_engine_case": 1, "timing_order_seed": 120026,
            "timing_order": "randomized within each paired repetition", "shared_measurement_lock": "/tmp/coherence-search-wrapper-benchmark.lock",
            "source_sha256": {str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest() for path in sources},
            "cases": records}
        output = Path(args.output); output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(result, indent=2) + "\n")
    finally:
        shutil.rmtree(owned)
        fcntl.flock(lock, fcntl.LOCK_UN)
        lock.close()


if __name__ == "__main__": main()
