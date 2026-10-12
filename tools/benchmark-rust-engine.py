#!/usr/bin/env python3
"""Compare the native Rust find engine with direct GNU find and direct fd.

Uses owned synthetic trees, a warm-cache rotated order and the packaged process
timer. GNU comparisons are exact; fd comparisons explicitly allow output order
differences, and are absent when fd cannot execute an equivalent expression.
"""

import argparse
import base64
from datetime import datetime, timezone
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import platform
import random
import shutil
import statistics
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent.parent
DRIVER_SPEC = importlib.util.spec_from_file_location("find2fd_process_timer", ROOT / "tools/benchmark-processes.py")
DRIVER = importlib.util.module_from_spec(DRIVER_SPEC)
DRIVER_SPEC.loader.exec_module(DRIVER)
run_job = DRIVER.run_job


def digest(data):
    return hashlib.sha256(data).hexdigest()


def layered(root, parents, children):
    root.mkdir()
    for top in range(parents):
        parent = root / f"parent-{top:03}"
        parent.mkdir()
        for child in range(children):
            directory = parent / f"child-{child:03}"
            directory.mkdir()
            for leaf in range(4):
                (directory / f"common-{leaf}.txt").write_bytes(b"owned fixture\n")
            if top % 20 == 0 and child == 0:
                (directory / "rare-result.dat").write_bytes(b"owned fixture\n")


def cases(fd):
    common = [fd, "--hidden", "--no-ignore", "--case-sensitive", "--color=never",
              "--print0"]

    def direct(root, pattern, *flags):
        return [*common, *flags, pattern, root]

    return [
        ("small-sparse", "128-file sparse name", ["small", "-name", "rare-result.dat", "-print0"], direct("small", "^rare-result\\.dat$")),
        ("wide-flat", "8K-file flat sparse name", ["flat", "-name", "rare-result.dat", "-print0"], direct("flat", "^rare-result\\.dat$")),
        ("deep-chain", "180-level chain sparse name", ["deep", "-name", "rare-result.dat", "-print0"], direct("deep", "^rare-result\\.dat$")),
        ("medium-sparse", "5K-directory layered sparse name", ["medium", "-name", "rare-result.dat", "-print0"], direct("medium", "^rare-result\\.dat$")),
        ("large-sparse-exact", "30K-directory sparse exact name", ["large", "-name", "rare-result.dat", "-print0"], direct("large", "^rare-result\\.dat$")),
        ("large-sparse-glob", "30K-directory sparse star glob", ["large", "-name", "rare*.dat", "-print0"], direct("large", "rare*.dat", "--glob")),
        ("large-sparse-type", "30K-directory sparse name/type", ["large", "-type", "f", "-name", "rare-result.dat", "-print0"], direct("large", "^rare-result\\.dat$", "--type", "f")),
        ("large-absent", "30K-directory absent name", ["large", "-name", "no-such-owned-name", "-print0"], direct("large", "^no-such-owned-name$")),
        ("large-dense-exact", "30K-directory repeated filename", ["large", "-name", "common-0.txt", "-print0"], direct("large", "^common-0\\.txt$")),
        ("large-broad-name", "30K-directory broad name output", ["large", "-name", "*.txt", "-print0"], direct("large", "*.txt", "--glob")),
        ("large-broad-type", "30K-directory all regular files", ["large", "-type", "f", "-print0"], direct("large", ".", "--type", "f")),
        ("large-shallow", "30K-directory depth-one sparse name", ["large", "-maxdepth", "1", "-name", "rare-result.dat", "-print0"], direct("large", "^rare-result\\.dat$", "--max-depth", "1")),
        ("large-metadata", "Metadata size predicate", ["large", "-type", "f", "-size", "+0c", "-print0"], None),
        ("large-format", "GNU printf format", ["large", "-name", "rare-result.dat", "-printf", "%p\n"], None),
        ("large-boolean", "Boolean with short-circuit output", ["large", "-name", "rare-result.dat", "-o", "-name", "common-0.txt", "-print0"], None),
        ("large-iname", "Case-insensitive sparse name", ["large", "-iname", "RARE-RESULT.DAT", "-print0"], [*common, "--ignore-case", "^RARE-RESULT\\.DAT$", "large"]),
        ("large-path", "Full-path sparse glob", ["large", "-path", "*/rare-result.dat", "-print0"], direct("large", "/rare-result\\.dat$", "--full-path")),
        ("medium-compound", "Compound name/type negation", ["medium", "(", "-name", "rare*.dat", "-o", "-name", "common-0.txt", ")", "!", "-type", "d", "-print0"], direct("medium", "^(?:rare.*\\.dat|common-0\\.txt)$", "--type", "f")),
        ("medium-repeated-output", "Repeated print actions", ["medium", "-name", "rare-result.dat", "-print", "-print0"], None),
        ("small-prune", "Prune control", ["small", "-maxdepth", "3", "-name", "node_modules", "-prune", "-o", "-print0"], None),
        ("small-exec", "GNU exec action", ["small", "-name", "rare-result.dat", "-exec", "/usr/bin/true", "{}", ";"], None),
        ("missing-root", "Missing-root diagnostics", ["not-present", "-name", "rare-result.dat", "-print0"], None),
    ]


def observation(program, argv, cwd, env):
    result = run_job({"program": str(program), "argv": argv, "cwd": str(cwd),
                      "env": env, "timeoutMs": 30000,
                      "maxCapturedBytesPerChannel": 32 * 1024 * 1024})
    if result["error"] or result["signal"]:
        raise RuntimeError(f"Process failed: {program}: {result}")
    data = (result["status"], base64.b64decode(result["stdoutBase64"]),
            base64.b64decode(result["stderrBase64"]))
    return result["durationMs"], data


def snapshot(paths):
    return {str(path.relative_to(ROOT)): digest(path.read_bytes()) for path in paths}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", default=str(ROOT / "artifacts/rust-engine-performance.json"))
    parser.add_argument("--runs", type=int, default=15)
    parser.add_argument("--warmups", type=int, default=3)
    parser.add_argument("--engine", default=str(ROOT / "rust/target/release/find2fd-rust"))
    parser.add_argument("--previous-engine", help="Archived release executable to time on the same fixtures in the rotated trial order")
    args = parser.parse_args()
    if not 7 <= args.runs <= 61 or not 1 <= args.warmups <= 5:
        parser.error("Require 7–61 timed runs and 1–5 warmups")
    executable = Path(args.engine).resolve(strict=True)
    previous = Path(args.previous_engine).resolve(strict=True) if args.previous_engine else None
    previous_hash = digest(previous.read_bytes()) if previous else None
    fd = shutil.which("fd") or shutil.which("fdfind")
    if not fd:
        parser.error("Direct fd baseline is required")
    fd = str(Path(fd).resolve())
    env = dict(os.environ)
    for key in list(env):
        if key.startswith("FIND2FD_") or key == "POSIXLY_CORRECT":
            del env[key]
    env.update(LC_ALL="C", LANG="C")
    sources = [ROOT / name for name in ["rust/Cargo.toml", "rust/Cargo.lock", "rust/src/main.rs",
               "tools/benchmark-rust-engine.py", "tools/benchmark-processes.py"]]
    before = snapshot(sources)
    executable_hash = digest(executable.read_bytes())
    report = {"schemaVersion": 1, "createdAt": datetime.now(timezone.utc).isoformat(),
              "status": "running", "platform": platform.platform(), "logicalCPUs": os.cpu_count(),
              "sourceSHA256": before, "executableSHA256": executable_hash,
              "executable": str(executable), "runsPerEngineCase": args.runs,
              "baselineSHA256": {"gnu": digest(Path("/usr/bin/find").read_bytes()),
                                 "fd": digest(Path(fd).read_bytes())},
              "warmupsPerEngineCase": args.warmups, "orderSeed": 12102026,
              "timingBoundary": "Monotonic child creation through complete capture and pidfd reap; fixture setup, Python startup, hashing and comparison excluded.",
              "fdThreads": "fd default; no thread-count override",
              "scope": "Owned warm-cache synthetic trees, C locale. Rust/GNU exact ordered output; direct fd equivalent complete records with order differences allowed. No universal speed claim.",
              "cases": []}
    if previous:
        report["previousExecutable"] = str(previous)
        report["previousExecutableSHA256"] = previous_hash
    output = Path(args.output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    lock = open("/tmp/coherence-search-wrapper-benchmark.lock", "a")
    fcntl.flock(lock, fcntl.LOCK_EX)
    owned = Path(tempfile.mkdtemp(prefix="find2fd-rust-benchmark-"))
    try:
        for name, count in [("small", 128), ("flat", 8192)]:
            directory = owned / name
            directory.mkdir()
            for index in range(count):
                (directory / f"item-{index}.txt").write_bytes(b"owned\n")
            (directory / "rare-result.dat").write_bytes(b"owned\n")
        directory = owned / "deep"
        directory.mkdir()
        for _ in range(180):
            directory = directory / "d"
            directory.mkdir()
            (directory / "common.txt").write_bytes(b"owned\n")
        (directory / "rare-result.dat").write_bytes(b"owned\n")
        layered(owned / "medium", 64, 80)
        layered(owned / "large", 100, 300)
        rng = random.Random(report["orderSeed"])
        for identifier, description, argv, fd_argv in cases(fd):
            commands = {"gnu": ("/usr/bin/find", ["find", *argv]),
                        "rust": (str(executable), ["find2fd-rust", *argv])}
            if previous:
                commands["previousRust"] = (str(previous), ["find2fd-rust", *argv])
            if fd_argv:
                commands["fd"] = (fd, fd_argv)
            _, expected = observation(*commands["gnu"], owned, env)
            _, route_data = observation(str(executable), ["find2fd-rust", "--find2fd-route-json", *argv], owned, env)
            if route_data[0] != 0 or route_data[2]:
                raise RuntimeError(f"Invalid route evidence: {identifier}: {route_data}")
            route = json.loads(route_data[1])
            timings = {label: [] for label in commands}
            checks = {label: 0 for label in commands}
            fd_order_equal = True
            for round_number in range(args.runs + args.warmups):
                order = list(commands)
                rng.shuffle(order)
                for label in order:
                    elapsed, actual = observation(*commands[label], owned, env)
                    if label == "fd":
                        if actual[:1] != expected[:1] or actual[2] != expected[2] or sorted(actual[1].split(b"\0")) != sorted(expected[1].split(b"\0")):
                            raise RuntimeError(f"Direct fd coverage mismatch: {identifier}; status={actual[0]} expected={expected[0]}; stderr={actual[2][:1024]!r}; stdout={actual[1][:256]!r}; expected={expected[1][:256]!r}")
                        fd_order_equal &= actual[1] == expected[1]
                    elif actual != expected:
                        raise RuntimeError(f"Exact GNU mismatch: {identifier}/{label}")
                    checks[label] += 1
                    if round_number >= args.warmups:
                        timings[label].append(elapsed)
            medians = {label: statistics.median(values) for label, values in timings.items()}
            record = {"id": identifier, "description": description, "argv": argv,
                      "fdArgv": fd_argv, "route": route, "medianMs": medians,
                      "samplesMs": timings, "comparisons": checks,
                      "stdoutBytes": len(expected[1]), "stdoutSHA256": digest(expected[1]),
                      "stderrBytes": len(expected[2]), "stderrSHA256": digest(expected[2]),
                      "status": expected[0], "fdOrderEqual": fd_order_equal if fd_argv else None}
            report["cases"].append(record)
            print(identifier, json.dumps(medians), flush=True)
        after = snapshot(sources)
        if after != before or digest(executable.read_bytes()) != executable_hash:
            raise RuntimeError("Source or executable changed during timing")
        if previous and digest(previous.read_bytes()) != previous_hash:
            raise RuntimeError("Archived executable changed during timing")
        report.update(status="passed", sourceStable=True, executableStable=True)
        report["versions"] = {"GNU find": subprocess.check_output(["/usr/bin/find", "--version"], env=env).decode().splitlines()[0],
                              "fd": subprocess.check_output([fd, "--version"], env=env).decode().strip()}
    except BaseException as error:
        report.update(status="failed", failure=f"{type(error).__name__}: {error}")
        raise
    finally:
        output.write_text(json.dumps(report, indent=2) + "\n")
        shutil.rmtree(owned)
        fcntl.flock(lock, fcntl.LOCK_UN)
        lock.close()


if __name__ == "__main__":
    main()
