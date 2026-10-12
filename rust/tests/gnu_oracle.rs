//! Black-box qualification of the optimized RELEASE executable against GNU find.
//! This executable does not import the engine implementation or a JS test shim.
use serde_json::{json, Value};
use std::cell::RefCell;
use std::collections::{BTreeMap, BTreeSet};
use std::env;
use std::ffi::{CString, OsStr, OsString};
use std::fs;
use std::io::{Read, Write};
use std::os::fd::AsRawFd;
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::{symlink, PermissionsExt};
use std::os::unix::net::UnixListener;
use std::os::unix::process::{CommandExt, ExitStatusExt};
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Mutex, OnceLock};
static REPORTS: OnceLock<Mutex<Vec<Value>>> = OnceLock::new();
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const SEED: usize = 0x46444e31;
const CAMPAIGN_CASES: usize = 384;
static UNIQUE: AtomicUsize = AtomicUsize::new(0);
fn args(values: &[&str]) -> Vec<OsString> {
    values.iter().map(OsString::from).collect()
}
fn decoded(value: &Value) -> Vec<OsString> {
    value
        .as_array()
        .unwrap()
        .iter()
        .map(|v| OsString::from(v.as_str().unwrap()))
        .collect()
}
fn contract() -> Value {
    serde_json::from_str(include_str!("../../tests/rust-engine-contract.json")).unwrap()
}
fn cases() -> Value {
    serde_json::from_str(include_str!("fixtures/semantic_cases.json")).unwrap()
}
fn hash(path: &Path) -> String {
    let result = Command::new("/usr/bin/sha256sum")
        .arg(path)
        .output()
        .unwrap();
    assert!(result.status.success());
    String::from_utf8(result.stdout)
        .unwrap()
        .split_whitespace()
        .next()
        .unwrap()
        .to_string()
}
#[derive(Default, Clone)]
struct Run {
    locale: Option<&'static str>,
    transport: Option<&'static str>,
    input: Option<Vec<u8>>,
    environment: Vec<(String, OsString)>,
    trace: Option<PathBuf>,
    timeout: Option<Duration>,
}
impl Run {
    fn with_env(mut self, key: &str, value: impl AsRef<OsStr>) -> Self {
        self.environment
            .push((key.to_owned(), value.as_ref().to_owned()));
        self
    }
}
struct Fixture {
    cwd: PathBuf,
    binary: PathBuf,
    binary_hash: String,
    comparisons: usize,
    rust_searches: usize,
    gnu_fallbacks: usize,
    io_comparisons: usize,
    classes: BTreeMap<String, usize>,
    recent_invocations: RefCell<Vec<Value>>,
}
impl Fixture {
    fn new() -> Self {
        let binary = env::var_os("FIND2FD_RUST_BINARY")
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target/release/find2fd-rust")
            });
        assert!(
            binary.is_file(),
            "Build the real release artifact before qualification: {}",
            binary.display()
        );
        let cwd = env::temp_dir().join(format!(
            "find2fd-rust-oracle-{}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            UNIQUE.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&cwd).unwrap();
        fs::set_permissions(&cwd, fs::Permissions::from_mode(0o700)).unwrap();
        let fixture = Self {
            binary_hash: hash(&binary),
            binary,
            cwd,
            comparisons: 0,
            rust_searches: 0,
            gnu_fallbacks: 0,
            io_comparisons: 0,
            classes: BTreeMap::new(),
            recent_invocations: RefCell::new(Vec::new()),
        };
        for name in [
            "tree/z-dir/deep",
            "tree/a-dir",
            "tree/.hidden-dir",
            "tree/.git",
            "tree/empty",
            "second/nested",
        ] {
            fixture.directory(name);
        }
        for name in [
            "tree/z-last.txt",
            "tree/a-first.txt",
            "tree/foo.txt",
            "tree/Foo.txt",
            "tree/z-dir/target.txt",
            "tree/z-dir/deep/target.txt",
            "tree/a-dir/target.txt",
            "tree/.hidden.txt",
            "tree/.hidden-dir/target.txt",
            "tree/.git/inside.txt",
            "tree/ignored.txt",
            "tree/fdignored.txt",
            "tree/space name.txt",
            "tree/apostrophe's.txt",
            "tree/line\nbreak.txt",
            "tree/-hyphen.txt",
            "tree/literal[1].txt",
            "tree/literal*.txt",
            "tree/π.txt",
            "tree/Ä.txt",
            "second/nested/target.txt",
            "root-file",
            "!root-file",
            "(root-file",
        ] {
            fixture.put(name);
        }
        fs::write(fixture.cwd.join("tree/.gitignore"), "ignored.txt\n").unwrap();
        fs::write(fixture.cwd.join("tree/.fdignore"), "fdignored.txt\n").unwrap();
        fs::write(fixture.cwd.join("tree/.ignore"), "also-ignored\n").unwrap();
        fixture.put("tree/also-ignored");
        fs::write(
            fixture.cwd.join(OsStr::from_bytes(b"tree/\xff\xfe.txt")),
            b"raw filename\n",
        )
        .unwrap();
        for (target, name) in [
            ("z-dir", "tree/linkdir"),
            ("foo.txt", "tree/linkfile"),
            ("missing", "tree/dangling"),
            ("tree", "root-link"),
            ("absent-target", "root-dangling"),
        ] {
            symlink(target, fixture.cwd.join(name)).unwrap();
        }
        let fifo = CString::new(fixture.cwd.join("tree/pipe").as_os_str().as_bytes()).unwrap();
        assert_eq!(unsafe { libc::mkfifo(fifo.as_ptr(), 0o600) }, 0);
        // sockaddr_un has a short address limit even when TMPDIR is long.
        // Resolve the identical owned socket path through a pinned directory
        // descriptor instead of changing process cwd or weakening the fixture.
        let socket_directory = fs::File::open(&fixture.cwd).unwrap();
        let socket_path = format!("/proc/self/fd/{}/tree/socket", socket_directory.as_raw_fd());
        UnixListener::bind(socket_path).unwrap();
        fixture
    }
    fn directory(&self, name: impl AsRef<Path>) {
        fs::create_dir_all(self.cwd.join(name)).unwrap();
    }
    fn put(&self, name: impl AsRef<Path>) {
        fs::write(self.cwd.join(name), b"owned synthetic fixture\n").unwrap();
    }
    fn save_journal(&self) {
        let journal = json!({"artifactSHA256": self.binary_hash, "fixture": self.cwd,
            "recentInvocations": *self.recent_invocations.borrow()});
        let _ = fs::write(
            self.cwd.join("invocation-journal.json"),
            journal.to_string(),
        );
    }
    fn save_output(&self, label: &str, output: &Output) -> Value {
        fs::write(self.cwd.join(format!("{label}.stdout")), &output.stdout).unwrap();
        fs::write(self.cwd.join(format!("{label}.stderr")), &output.stderr).unwrap();
        json!({"exitCode": output.status.code(), "signal": output.status.signal(),
            "rawStatus": output.status.into_raw(), "stdoutBytes": output.stdout.len(),
            "stderrBytes": output.stderr.len(), "stdoutFile": format!("{label}.stdout"),
            "stderrFile": format!("{label}.stderr")})
    }
    fn invoke(&self, program: &Path, argv: &[OsString], run: &Run) -> Output {
        self.invoke_bounded(program, argv, run)
            .unwrap_or_else(|error| {
                self.save_journal();
                panic!("{error}; evidence: {}", self.cwd.display())
            })
    }
    fn invoke_bounded(
        &self,
        program: &Path,
        argv: &[OsString],
        run: &Run,
    ) -> Result<Output, String> {
        let started = Instant::now();
        let encoded = |value: &OsStr| {
            value
                .as_bytes()
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect::<String>()
        };
        let mut invocations = self.recent_invocations.borrow_mut();
        invocations.push(json!({"programHex": encoded(program.as_os_str()),
            "argvHex": argv.iter().map(|a| encoded(a)).collect::<Vec<_>>(),
            "locale": run.locale.unwrap_or("C"), "transport": run.transport,
            "inputBytes": run.input.as_ref().map(Vec::len),
            "environmentHex": run.environment.iter().map(|(k, v)| (k, encoded(v))).collect::<BTreeMap<_,_>>() }));
        if invocations.len() > 8 {
            invocations.remove(0);
        }
        drop(invocations);
        let mut command = if let Some(transport @ ("ignored-SIGPIPE" | "nonblocking-full-pipe")) =
            run.transport
        {
            let mut command = Command::new("/usr/bin/python3");
            command.args([
                OsStr::new("-c"),
                OsStr::new(include_str!("fixtures/descriptor_failure.py")),
                program.as_os_str(),
                OsStr::new(transport),
            ]);
            command.args(argv);
            command
        } else if let Some(transport) = run.transport {
            let script = match transport {
                "closed-output" => "set -o pipefail; program=$1; shift; { exec -a find \"$program\" \"$@\"; } | /usr/bin/head -c 1",
                "full-output" => "program=$1; shift; exec -a find \"$program\" \"$@\" > /dev/full",
                "limited-descriptors" => "ulimit -n 32; program=$1; shift; exec -a find \"$program\" \"$@\"",
                _ => panic!("Unknown test transport {transport}"),
            };
            let mut command = Command::new("/usr/bin/bash");
            command.args([
                OsStr::new("--noprofile"),
                OsStr::new("--norc"),
                OsStr::new("-c"),
                OsStr::new(script),
                OsStr::new("owned-find-stream-oracle"),
                program.as_os_str(),
            ]);
            command.args(argv);
            command
        } else if let Some(trace) = &run.trace {
            if program == self.binary {
                let mut command = Command::new("/usr/bin/strace");
                command.args(["-qq", "-f", "-e", "trace=execve", "-o"]);
                command.arg(trace).arg(program).args(argv);
                command
            } else {
                let mut command = Command::new(program);
                if program == self.binary || program == Path::new("/usr/bin/find") {
                    command.arg0("find");
                }
                command.args(argv);
                command
            }
        } else {
            let mut command = Command::new(program);
            if program == self.binary || program == Path::new("/usr/bin/find") {
                command.arg0("find");
            }
            command.args(argv);
            command
        };
        for (key, _) in env::vars_os() {
            if key.as_bytes().starts_with(b"FIND2FD_")
                || key == "POSIXLY_CORRECT"
                || key == "LD_PRELOAD"
            {
                command.env_remove(key);
            }
        }
        command
            .env("LC_ALL", run.locale.unwrap_or("C"))
            .env("LANG", "C")
            .env("TERM", "dumb")
            .env("NO_COLOR", "1");
        command
            .envs(run.environment.iter().cloned())
            .current_dir(&self.cwd)
            .stdin(if run.input.is_some() {
                Stdio::piped()
            } else {
                Stdio::null()
            })
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .process_group(0);
        // Cargo/Rust ignore SIGPIPE in the test runner. Normal child exec must
        // restore the shell's default; the Python regression deliberately keeps
        // its own ignored disposition for the engine subprocess.
        unsafe {
            command.pre_exec(|| {
                libc::signal(libc::SIGPIPE, libc::SIG_DFL);
                Ok(())
            });
        }
        let mut child = command
            .spawn()
            .map_err(|error| format!("{}: {error}", program.display()))?;
        let stdout = child.stdout.take().unwrap();
        let stderr = child.stderr.take().unwrap();
        let capture = |mut stream: Box<dyn Read + Send>| {
            let mut bytes = Vec::new();
            stream
                .by_ref()
                .take(8 * 1024 * 1024 + 1)
                .read_to_end(&mut bytes)
                .unwrap();
            bytes
        };
        let out = thread::spawn(move || capture(Box::new(stdout)));
        let err = thread::spawn(move || capture(Box::new(stderr)));
        let feeder = run.input.as_ref().map(|input| {
            let input = input.clone();
            let mut stdin = child.stdin.take().unwrap();
            thread::spawn(move || stdin.write_all(&input))
        });
        let deadline = run.timeout.unwrap_or(Duration::from_secs(15));
        let status = loop {
            match child.try_wait() {
                Ok(Some(status)) => break Ok(status),
                Err(error) => break Err(format!("{}: wait failed: {error}", program.display())),
                Ok(None) => {}
            }
            if started.elapsed() > deadline {
                break Err(format!("{} exceeded bounded deadline", program.display()));
            }
            thread::sleep(Duration::from_millis(1));
        };
        // Even when the leader exited successfully, an owned descendant can
        // retain stdout/stderr or stdin. Close the whole group before joining
        // pipe readers and the feeder; otherwise an oracle can hang forever.
        unsafe {
            libc::kill(-(child.id() as i32), libc::SIGKILL);
        }
        if status.is_err() {
            let _ = child.wait();
        }
        let stdout = out
            .join()
            .map_err(|_| "stdout capture worker panicked".to_owned())?;
        let stderr = err
            .join()
            .map_err(|_| "stderr capture worker panicked".to_owned())?;
        let feeding = feeder.map(|worker| worker.join());
        let status = match status {
            Ok(status) => status,
            Err(error) => {
                let _ = fs::write(self.cwd.join("failed-invocation.stdout"), &stdout);
                let _ = fs::write(self.cwd.join("failed-invocation.stderr"), &stderr);
                return Err(error);
            }
        };
        if let Some(feeding) = feeding {
            let feeding = feeding.map_err(|_| "stdin feeder worker panicked".to_owned())?;
            if let Err(error) = feeding {
                if error.kind() != std::io::ErrorKind::BrokenPipe {
                    return Err(format!("stdin feeder failed: {error}"));
                }
            }
        }
        let output = Output {
            status,
            stdout,
            stderr,
        };
        let failure =
            if output.stdout.len() > 8 * 1024 * 1024 || output.stderr.len() > 8 * 1024 * 1024 {
                Some("bounded child capture exceeded".to_owned())
            } else {
                status.signal().map(|signal| {
                    format!(
                        "{} unexpectedly terminated by signal {signal}",
                        program.display()
                    )
                })
            };
        if let Some(error) = failure {
            self.save_journal();
            let witness = self.save_output("failed-invocation", &output);
            fs::write(
                self.cwd.join("invoke-failure.json"),
                json!({"error": error, "result": witness}).to_string(),
            )
            .unwrap();
            return Err(error);
        }
        Ok(output)
    }

    fn route(&self, argv: &[OsString], run: &Run) -> Value {
        let mut argv = argv.to_vec();
        argv.insert(0, "--find2fd-route-json".into());
        let normal = Run {
            transport: None,
            trace: None,
            input: None,
            ..run.clone()
        };
        let output = self.invoke(&self.binary, &argv, &normal);
        let parsed = serde_json::from_slice::<Value>(&output.stdout);
        if !output.status.success()
            || !output.stderr.is_empty()
            || !matches!(
                parsed.as_ref().ok().and_then(|v| v["route"].as_str()),
                Some("native" | "gnu")
            )
        {
            self.save_journal();
            let witness = self.save_output("failed-route", &output);
            fs::write(self.cwd.join("route-failure.json"), witness.to_string()).unwrap();
            panic!("route failed; bounded evidence: {}", self.cwd.display());
        }
        parsed.unwrap()
    }
    fn exact(&mut self, id: &str, actual: &Output, expected: &Output, route: &str) {
        self.comparisons += 1;
        *self.classes.entry(id.to_owned()).or_default() += 1;
        match route {
            "native" => self.rust_searches += 1,
            "gnu" => self.gnu_fallbacks += 1,
            "io" => self.io_comparisons += 1,
            _ => panic!("unknown credit"),
        }
        if actual.status != expected.status
            || actual.stdout != expected.stdout
            || actual.stderr != expected.stderr
        {
            self.save_journal();
            let witness = json!({"case": id, "creditedRoute": route,
                "artifactSHA256": self.binary_hash, "actual": self.save_output("actual", actual),
                "expected": self.save_output("expected", expected)});
            fs::write(self.cwd.join("oracle-mismatch.json"), witness.to_string()).unwrap();
            panic!(
                "{id}: exact GNU status/stdout/stderr mismatch; bounded evidence: {}",
                self.cwd.display()
            );
        }
    }
    fn compare(&mut self, id: &str, argv: &[OsString], required: Option<&str>, run: &Run) -> Value {
        let route = self.route(argv, run);
        if let Some(required) = required {
            if route["route"] != required {
                self.save_journal();
                fs::write(
                    self.cwd.join("route-mismatch.json"),
                    json!({"case": id, "required": required, "actual": route}).to_string(),
                )
                .unwrap();
                panic!(
                    "{id}: native/fallback route mismatch; evidence: {}",
                    self.cwd.display()
                );
            }
        }
        let expected = self.invoke(Path::new("/usr/bin/find"), argv, run);
        let actual = self.invoke(&self.binary, argv, run);
        self.exact(
            id,
            &actual,
            &expected,
            if run.transport.is_some() {
                "io"
            } else {
                route["route"].as_str().unwrap()
            },
        );
        route
    }
    fn native(&mut self, id: &str, argv: &[OsString]) -> Value {
        self.compare(id, argv, Some("native"), &Run::default())
    }
    fn gnu(&mut self, id: &str, argv: &[OsString]) -> Value {
        self.compare(id, argv, Some("gnu"), &Run::default())
    }
    fn compile(&self, name: &str, source: &str, extra: &[&str]) -> PathBuf {
        let path = self.cwd.join(format!("{name}.c"));
        let binary = self.cwd.join(format!("{name}.so"));
        fs::write(&path, source).unwrap();
        let mut argv = args(&["-shared", "-fPIC", "-Wall", "-Wextra", "-Werror"]);
        argv.extend(args(extra));
        argv.push("-o".into());
        argv.push(binary.clone().into());
        argv.push(path.into());
        argv.push("-ldl".into());
        let result = self.invoke(Path::new("/usr/bin/gcc"), &argv, &Run::default());
        assert!(
            result.status.success(),
            "C hook compile failed: {:?}",
            result
        );
        binary
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let report = json!({"seed":format!("0x{SEED:x}"),"artifactSHA256":self.binary_hash,
            "comparisons":self.comparisons,"rustSearches":self.rust_searches,"gnuFallbacks":self.gnu_fallbacks,
            "ioComparisons":self.io_comparisons,"classes":self.classes,"failures":usize::from(thread::panicking()),
            "evidence": if thread::panicking() {Some(self.cwd.display().to_string())} else {None}});
        if self.comparisons > 0 || thread::panicking() {
            println!("# {report}");
            REPORTS
                .get_or_init(|| Mutex::new(Vec::new()))
                .lock()
                .unwrap()
                .push(report);
        }
        if thread::panicking() {
            self.save_journal();
        }
        if !thread::panicking() {
            assert_eq!(
                hash(&self.binary),
                self.binary_hash,
                "release binary changed during qualification"
            );
            fs::remove_dir_all(&self.cwd).unwrap();
        }
    }
}

fn native_grammar() {
    let mut f = Fixture::new();
    let data = cases();
    assert_eq!(
        data["grammar"]
            .as_array()
            .unwrap()
            .iter()
            .map(|c| c[0].clone())
            .collect::<Vec<_>>(),
        contract()["nativeRequiredClasses"]
            .as_array()
            .unwrap()
            .clone()
    );
    for case in data["grammar"].as_array().unwrap() {
        f.native(case[0].as_str().unwrap(), &decoded(&case[1]));
    }
    for root in [
        OsString::from("./tree"),
        "tree/".into(),
        "tree///".into(),
        f.cwd.join("tree").into(),
        "./!root-file".into(),
        "./(root-file".into(),
    ] {
        f.native("root-spelling", &[root.clone(), "-print0".into()]);
        f.native(
            "root-spelling-maxdepth-zero",
            &[root, "-maxdepth".into(), "0".into(), "-print0".into()],
        );
    }
    for kind in ["f", "d", "l", "p", "s", "b", "c"] {
        f.native("type-alphabet", &args(&["tree", "-type", kind, "-print0"]));
    }
    for pattern in [
        "[fF]oo.txt",
        "?oo.txt",
        "literal\\*.txt",
        "literal[[]1].txt",
        "",
        "π*",
        "[!a-z]*",
    ] {
        f.native(
            "gnu-glob-boundaries",
            &args(&["tree", "-name", pattern, "-print0"]),
        );
    }
    f.gnu(
        "pathname-name-warning-guard",
        &args(&["tree", "-name", "*/*", "-print0"]),
    );
    for pattern in [
        "tree/*",
        "*target*",
        "tree/*/target.txt",
        "*/*/*",
        "tree/.*",
        "tree/π*",
    ] {
        f.native(
            "gnu-path-boundaries",
            &args(&["tree", "-path", pattern, "-print0"]),
        );
    }
}
fn boolean_depth() {
    let mut f = Fixture::new();
    for case in cases()["booleans"].as_array().unwrap() {
        let mut argv = vec!["tree".into()];
        argv.extend(decoded(case));
        f.native("boolean-and-depth-boundaries", &argv);
    }
    f.native(
        "implicit-root",
        &args(&["-maxdepth", "1", "-type", "d", "-print0"]),
    );
    f.native("no-argv-default-root", &[]);
}
fn root_basename() {
    let mut f = Fixture::new();
    for root in [
        "tree/",
        "tree///",
        "root-link/",
        "root-link///",
        "./",
        "tree/.",
        "tree/../tree",
    ] {
        f.native(
            "root-terminal-slash-traversal",
            &args(&[root, "-maxdepth", "2", "-type", "d", "-print0"]),
        );
        for pattern in ["tree", "tree/", "root-link", "root-link/", ".", "./"] {
            f.compare(
                "root-basename-predicate",
                &args(&[root, "-maxdepth", "0", "-name", pattern, "-print0"]),
                Some(if pattern.contains('/') {
                    "gnu"
                } else {
                    "native"
                }),
                &Run::default(),
            );
        }
    }
    for root in ["root-file/", "root-dangling/", "tree/linkfile/"] {
        f.gnu("terminal-slash-invalid-root", &args(&[root, "-print0"]));
    }
}
fn seeded_campaign() {
    let mut f = Fixture::new();
    let roots = [
        args(&["tree"]),
        args(&["second"]),
        args(&["tree", "second", "tree"]),
        args(&["tree/foo.txt"]),
        args(&["tree/linkdir"]),
        args(&["tree/dangling"]),
        args(&["./tree/"]),
        args(&["tree/empty"]),
    ];
    let depths = [
        vec![],
        args(&["-maxdepth", "0"]),
        args(&["-maxdepth", "1"]),
        args(&["-mindepth", "1"]),
        args(&["-mindepth", "2", "-maxdepth", "3"]),
    ];
    let atoms = [
        args(&["-name", "*"]),
        args(&["-name", "*.txt"]),
        args(&["-name", "[fF]oo.txt"]),
        args(&["-name", "nothing"]),
        args(&["-iname", "*.TXT"]),
        args(&["-type", "d"]),
        args(&["-type", "f"]),
        args(&["-type", "l"]),
        args(&["-type", "p"]),
        args(&["-type", "s"]),
        args(&["-path", "*target*"]),
        args(&["-true"]),
        args(&["-false"]),
    ];
    let tails = [
        vec![],
        args(&["-print"]),
        args(&["-print0"]),
        args(&["-print0", "-print"]),
        args(&["-o", "-print0"]),
        args(&[",", "-false"]),
        args(&["-o", "-type", "d"]),
        args(&["-a", "!", "-type", "l"]),
    ];
    let mut pool = Vec::new();
    for root in &roots {
        for depth in &depths {
            for atom in &atoms {
                for tail in &tails {
                    pool.push([root.clone(), depth.clone(), atom.clone(), tail.clone()].concat());
                    pool.push(
                        [
                            root.clone(),
                            depth.clone(),
                            args(&["!", "("]),
                            atom.clone(),
                            args(&["-o", "-type", "d", ")"]),
                            tail.clone(),
                        ]
                        .concat(),
                    );
                }
            }
        }
    }
    fn gcd(a: usize, b: usize) -> usize {
        if b == 0 {
            a
        } else {
            gcd(b, a % b)
        }
    }
    let mut step = 7919;
    while gcd(step, pool.len()) != 1 {
        step += 1;
    }
    let mut seen = BTreeSet::new();
    let mut index = 0;
    while seen.len() < CAMPAIGN_CASES {
        let argv = &pool[(SEED + index * step) % pool.len()];
        index += 1;
        if seen.insert(argv.clone()) {
            f.native("seeded-native-expression", argv);
        }
    }
    assert_eq!(
        seen.len(),
        contract()["seededNativeComparisons"].as_u64().unwrap() as usize
    );
    assert_eq!(f.rust_searches, CAMPAIGN_CASES);
    assert_eq!(f.gnu_fallbacks, 0);
}
fn optimized_globs() {
    let mut f = Fixture::new();
    for name in [
        "xxx",
        "x-middle-x",
        "X-MIDDLE-X",
        "fooXXX",
        "Xfoo",
        "x",
        "FOO.TXT",
        "end.X",
        "prefix.x.tail",
    ] {
        f.put(format!("tree/{name}"));
    }
    for predicate in ["-name", "-iname"] {
        for pattern in [
            "", "*", "**", "***", "foo.txt", "f*", "F*", "foo**", "x**", "**x", "*x*", "*X*",
            "*txt", "*TXT", "**txt", "*oo*", "*OO*", "x*x", "*π*", "*\n*",
        ] {
            f.native(
                "optimized-name-glob-boundaries",
                &args(&["tree", predicate, pattern, "-print0"]),
            );
        }
    }
    for pattern in [
        "*",
        "**",
        "***",
        "tree/*",
        "tree/**",
        "*txt",
        "*target*",
        "**target*",
        "*π*",
        "*\n*",
    ] {
        f.native(
            "optimized-path-glob-boundaries",
            &args(&["tree", "-path", pattern, "-print0"]),
        );
    }
}
fn unsupported_semantics() {
    let mut f = Fixture::new();
    let data = cases();
    assert_eq!(
        data["fallback"]
            .as_array()
            .unwrap()
            .iter()
            .map(|c| c[0].clone())
            .collect::<Vec<_>>(),
        contract()["fallbackAllowedClasses"]
            .as_array()
            .unwrap()
            .clone()
    );
    for case in data["fallback"].as_array().unwrap() {
        let input = case.get(2).map(|hex| {
            let text = hex.as_str().unwrap();
            (0..text.len())
                .step_by(2)
                .map(|i| u8::from_str_radix(&text[i..i + 2], 16).unwrap())
                .collect()
        });
        f.compare(
            case[0].as_str().unwrap(),
            &decoded(&case[1]),
            Some("gnu"),
            &Run {
                input,
                ..Run::default()
            },
        );
    }
    for argv in [
        args(&["tree", "-type", "x"]),
        args(&["tree", "-type", "f,d"]),
        args(&["tree", "-mindepth", "-1"]),
        args(&["tree", "-maxdepth", "bad"]),
        args(&["tree", "-maxdepth"]),
        args(&["tree", "-unknown"]),
        args(&["tree", "("]),
        args(&["tree", ")"]),
        args(&["tree", "-o"]),
        args(&["tree", "!"]),
        args(&["tree", "-true", "-a"]),
        args(&["tree", ","]),
        args(&["-P", "-L", "-P", "tree"]),
        args(&["--", "tree", "-print0"]),
        args(&["-O2", "tree"]),
    ] {
        f.gnu("invalid-or-unsupported-argv", &argv);
    }
    for argv in [
        args(&["tree", "-type", "f", "-maxdepth", "1"]),
        args(&["tree", "-false", "-mindepth", "1"]),
    ] {
        f.gnu("later-global-option-warning", &argv);
    }
}
fn option_inventory() {
    let f = Fixture::new();
    let contract = contract();
    let inventory: Value =
        serde_json::from_str(include_str!("../../tests/find_option_inventory.json")).unwrap();
    let mut existing = BTreeSet::new();
    for collection in ["options", "operators"] {
        for option in inventory[collection].as_array().unwrap() {
            existing.insert(option["spelling"].as_str().unwrap().to_string());
        }
    }
    let options = contract["options"].as_array().unwrap();
    let declared: BTreeSet<_> = options
        .iter()
        .map(|o| o["spelling"].as_str().unwrap().to_string())
        .collect();
    assert_eq!(declared.len(), options.len());
    assert_eq!(declared, existing);
    let help = f.invoke(
        Path::new("/usr/bin/find"),
        &args(&["--help"]),
        &Run::default(),
    );
    let mut help_options = BTreeSet::new();
    let mut i = 0;
    while i < help.stdout.len() {
        if help.stdout[i] == b'-'
            && (i == 0
                || !(help.stdout[i - 1].is_ascii_alphanumeric() || help.stdout[i - 1] == b'_'))
        {
            let start = i;
            i += 1;
            if help.stdout.get(i) == Some(&b'-') {
                i += 1;
            }
            if help.stdout.get(i).is_some_and(u8::is_ascii_alphabetic) {
                i += 1;
                while help
                    .stdout
                    .get(i)
                    .is_some_and(|b| b.is_ascii_alphanumeric() || *b == b'_' || *b == b'-')
                {
                    i += 1;
                }
                let option = std::str::from_utf8(&help.stdout[start..i]).unwrap();
                if option != "-N" {
                    help_options.insert(option.to_owned());
                }
            }
        } else {
            i += 1;
        }
    }
    for option in &help_options {
        assert!(
            declared.contains(option),
            "Unclassified GNU help option {option}"
        );
    }
    for option in options {
        assert!(option["contract"].as_str().unwrap().len() > 10);
        assert_eq!(
            f.route(&decoded(&option["argv"]), &Run::default())["route"],
            option["route"]
        );
    }
    println!(
        "# {}",
        json!({"campaign":"rust-GNU-option-inventory","GNUHelpOptionSpellings":help_options.len(),"classifiedOptionsAndOperators":options.len(),"nonExecutingRouteChecks":options.len(),"destructiveActionsExecuted":0})
    );
}
fn fallback_side_effects() {
    let mut f = Fixture::new();
    for action in [
        args(&["-fprint", "action-output"]),
        args(&["-fprint0", "action-output"]),
        args(&["-fprintf", "action-output", "%p:%f\\0"]),
        args(&["-exec", "/usr/bin/printf", "%s\\0", "{}", "+"]),
        args(&["-execdir", "/usr/bin/printf", "%s\\0", "{}", ";"]),
    ] {
        let argv = [args(&["tree", "-maxdepth", "1"]), action].concat();
        let file = f.cwd.join("action-output");
        let _ = fs::remove_file(&file);
        assert_eq!(f.route(&argv, &Run::default())["route"], "gnu");
        let expected = f.invoke(Path::new("/usr/bin/find"), &argv, &Run::default());
        let expected_file = fs::read(&file).ok();
        let _ = fs::remove_file(&file);
        let actual = f.invoke(&f.binary, &argv, &Run::default());
        f.exact("owned-output-and-exec-actions", &actual, &expected, "gnu");
        assert_eq!(fs::read(&file).ok(), expected_file);
    }
    let create = |f: &Fixture| {
        f.directory("delete-me/nested");
        f.put("delete-me/one");
        f.put("delete-me/nested/two");
    };
    create(&f);
    let argv = args(&["delete-me", "-depth", "-delete"]);
    assert_eq!(f.route(&argv, &Run::default())["route"], "gnu");
    let expected = f.invoke(Path::new("/usr/bin/find"), &argv, &Run::default());
    assert!(!f.cwd.join("delete-me").exists());
    create(&f);
    let actual = f.invoke(&f.binary, &argv, &Run::default());
    f.exact("owned-delete-action", &actual, &expected, "gnu");
    assert!(!f.cwd.join("delete-me").exists());
    assert!(f.cwd.join("tree/foo.txt").exists());
}
fn parallel_order() {
    let mut f = Fixture::new();
    f.directory("parallel");
    for i in 0..160 {
        let base = format!("parallel/branch-{}", (i * 71) % 160);
        f.directory(format!("{base}/child"));
        f.put(format!("{base}/first.txt"));
        f.put(format!("{base}/child/target.txt"));
        f.put(format!("{base}/line\nbreak"));
    }
    for argv in [
        args(&["parallel", "-print0"]),
        args(&["parallel", "-name", "*target*", "-print0"]),
        args(&["parallel", "-maxdepth", "1", "-type", "d", "-print0"]),
        args(&["parallel", "-mindepth", "2", "-type", "f", "-print0"]),
        args(&["parallel", "tree", "parallel", "-print0"]),
        args(&[
            "parallel", "(", "-name", "*.txt", "-o", "-type", "d", ")", "-print0", "-print",
        ]),
    ] {
        let plan = f.native("parallel-native-GNU-order", &argv);
        if !argv.contains(&"-maxdepth".into()) {
            assert_eq!(plan["strategy"], "parallel");
            assert!(plan["workers"].as_u64().unwrap() > 1);
        }
    }
    f.compare(
        "parallel-descriptor-pressure",
        &args(&["parallel", "-print0"]),
        None,
        &Run {
            transport: Some("limited-descriptors"),
            ..Run::default()
        },
    );
}
fn shallow_no_pool() {
    let mut f = Fixture::new();
    for i in 0..48 {
        f.directory(format!("shallow/dir-{i}/deeper"));
        f.put(format!("shallow/dir-{i}/deeper/file"));
    }
    for argv in [
        args(&["shallow", "-maxdepth", "0", "-print0"]),
        args(&["shallow", "-maxdepth", "1", "-type", "d", "-print0"]),
        args(&["shallow", "-mindepth", "1", "-maxdepth", "1", "-print0"]),
    ] {
        let plan = f.native("shallow-no-pool-GNU-order", &argv);
        assert_eq!(plan["strategy"], "sequential");
        assert_eq!(plan["workers"], 1);
    }
}
fn errors_locales_transports() {
    let mut f = Fixture::new();
    assert_ne!(
        unsafe { libc::geteuid() },
        0,
        "Permission oracle must run unprivileged"
    );
    f.directory("tree/unreadable");
    f.put("tree/unreadable/secret");
    fs::set_permissions(
        f.cwd.join("tree/unreadable"),
        fs::Permissions::from_mode(0o0),
    )
    .unwrap();
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        f.gnu("unreadable-traversal", &args(&["tree", "-print0"]))
    }));
    fs::set_permissions(
        f.cwd.join("tree/unreadable"),
        fs::Permissions::from_mode(0o700),
    )
    .unwrap();
    if let Err(error) = result {
        std::panic::resume_unwind(error);
    }
    symlink("..", f.cwd.join("tree/z-dir/cycle")).unwrap();
    f.native("physical-cycle-no-follow", &args(&["tree", "-print0"]));
    f.gnu(
        "following-cycle-GNU-diagnostic",
        &args(&["-L", "tree", "-print0"]),
    );
    for argv in [
        args(&["tree", "-iname", "Ä*"]),
        args(&["tree", "-ipath", "*Ä*"]),
        args(&["tree", "-name", "[[:alpha:]]*"]),
        args(&["tree", "-name", "π*"]),
    ] {
        f.compare(
            "non-C-complex-pattern",
            &argv,
            Some("gnu"),
            &Run {
                locale: Some("C.UTF-8"),
                ..Run::default()
            },
        );
    }
    f.compare(
        "non-C-literal-ASCII",
        &args(&["tree", "-name", "foo.txt", "-print0"]),
        Some("native"),
        &Run {
            locale: Some("C.UTF-8"),
            ..Run::default()
        },
    );
    f.compare(
        "POSIX-complex-pattern",
        &args(&["tree", "-name", "[a-z]*", "-print0"]),
        Some("native"),
        &Run {
            locale: Some("POSIX"),
            ..Run::default()
        },
    );
    for (class, transport) in [
        ("closed-output", "closed-output"),
        ("full-output", "full-output"),
        ("descriptor-pressure", "limited-descriptors"),
    ] {
        f.compare(
            class,
            &args(&["tree", "-print0"]),
            None,
            &Run {
                transport: Some(transport),
                ..Run::default()
            },
        );
    }
}
fn atomic_bounds() {
    let mut f = Fixture::new();
    for (id, value) in [
        ("POSIXLY_CORRECT-delegation", "1"),
        ("POSIXLY_CORRECT-empty-delegation", ""),
    ] {
        f.compare(
            id,
            &args(&["tree", "-print0"]),
            Some("gnu"),
            &Run::default().with_env("POSIXLY_CORRECT", value),
        );
    }
    f.gnu(
        "pattern-preparation-bound",
        &args(&["tree", "-name", &"*".repeat(8193), "-print0"]),
    );
    let mut expression = args(&["tree"]);
    expression.extend((0..600).map(|_| OsString::from("-true")));
    expression.push("-print0".into());
    f.gnu("expression-preparation-bound", &expression);
    let mut root = String::from("deep");
    f.directory(&root);
    for _ in 0..258 {
        root.push_str("/d");
        f.directory(&root);
    }
    f.put(format!("{root}/tail"));
    f.gnu(
        "late-depth-preparation-bound",
        &args(&["tree", "deep", "-print0"]),
    );
}
fn stdout_regression(transport: &'static str) {
    let mut f = Fixture::new();
    let argv = args(&["tree/foo.txt", "-print0"]);
    let run = Run {
        transport: Some(transport),
        ..Run::default()
    };
    let expected = f.invoke(Path::new("/usr/bin/find"), &argv, &run);
    assert_eq!(expected.status.code(), Some(1));
    assert!(!expected.stderr.is_empty());
    f.compare(&format!("regression-{transport}"), &argv, None, &run);
}
fn ignored_sigpipe() {
    stdout_regression("ignored-SIGPIPE");
}
fn nonblocking_pipe() {
    stdout_regression("nonblocking-full-pipe");
}
fn ordinary_exec_proof() {
    let mut f = Fixture::new();
    let trace = f.cwd.join("native-exec.trace");
    f.compare(
        "external-native-execution-proof",
        &args(&["tree", "-name", "*.txt", "-print0"]),
        Some("native"),
        &Run {
            trace: Some(trace.clone()),
            ..Run::default()
        },
    );
    let text = fs::read_to_string(trace).unwrap();
    let lines: Vec<_> = text.lines().filter(|l| l.contains("execve(")).collect();
    assert_eq!(lines.len(), 1);
    assert!(lines[0].contains(&serde_json::to_string(&f.binary).unwrap()));
    let trace = f.cwd.join("gnu-exec.trace");
    f.compare(
        "external-GNU-execution-proof",
        &args(&["tree", "-maxdepth", "1", "-size", "+0c", "-print0"]),
        Some("gnu"),
        &Run {
            trace: Some(trace.clone()),
            ..Run::default()
        },
    );
    let text = fs::read_to_string(trace).unwrap();
    let lines: Vec<_> = text.lines().filter(|l| l.contains("execve(")).collect();
    assert_eq!(lines.len(), 2);
    assert!(lines[1].contains("execve(\"/usr/bin/find\", [\"find\", \"tree\", \"-maxdepth\", \"1\", \"-size\", \"+0c\", \"-print0\"]"));
}

fn namespace_replacement() {
    let mut f = Fixture::new();
    let hook = f.compile("race-hook", include_str!("fixtures/namespace_swap.c"), &[]);
    f.directory("outside");
    f.put("outside/OUTSIDE_SENTINEL");
    let marker = f.cwd.join("race-trigger");
    let victim = f.cwd.join("race/victim");
    let stash = f.cwd.join("race-stashed");
    let run = Run::default()
        .with_env("LD_PRELOAD", hook)
        .with_env("FIND2FD_RACE_MARKER", &marker)
        .with_env("FIND2FD_RACE_VICTIM", &victim)
        .with_env("FIND2FD_RACE_STASH", &stash)
        .with_env("FIND2FD_RACE_OUTSIDE", f.cwd.join("outside"));
    let reset = |f: &Fixture| {
        let _ = fs::remove_dir_all(f.cwd.join("race"));
        let _ = fs::remove_dir_all(&stash);
        let _ = fs::remove_file(&marker);
        f.directory("race/victim");
        f.put("race/head");
        f.put("race/victim/inside");
    };
    let argv = args(&["-P", "race", "-print0"]);
    reset(&f);
    f.compare(
        "race-hook-negative-control",
        &argv,
        Some("native"),
        &run.clone().with_env("FIND2FD_RACE_DISABLE", "1"),
    );
    assert!(!marker.exists());
    let actual = f.invoke(&f.binary, &argv, &run);
    assert!(
        marker.exists(),
        "controlled child swap must actually execute"
    );
    assert!(fs::read_to_string(&marker)
        .unwrap()
        .contains("immediately before directory open"));
    let expected = f.invoke(Path::new("/usr/bin/find"), &argv, &Run::default());
    f.exact("physical-child-symlink-swap", &actual, &expected, "io");
    assert!(
        !actual
            .stdout
            .windows(b"OUTSIDE_SENTINEL".len())
            .any(|bytes| bytes == b"OUTSIDE_SENTINEL"),
        "physical traversal must exclude the outside sentinel"
    );
    reset(&f);
    let mutant = f.invoke(
        &f.binary,
        &argv,
        &run.with_env("FIND2FD_RACE_STRIP_NOFOLLOW", "1"),
    );
    assert!(marker.exists());
    assert!(mutant.status.success());
    assert!(
        mutant
            .stdout
            .windows(b"OUTSIDE_SENTINEL".len())
            .any(|bytes| bytes == b"OUTSIDE_SENTINEL"),
        "the narrow O_NOFOLLOW mutation must be detected by the invariant"
    );
    println!(
        "# {}",
        json!({"campaign":"physical-child-symlink-swap","deterministicSwapChecks":1,"mutationControlsDetected":1,"productionDataRead":false})
    );
}
fn raw_directory_faults() {
    let mut f = Fixture::new();
    let hook = f.compile(
        "dirent-hook",
        include_str!("fixtures/directory_records.c"),
        &["-Wno-cast-function-type"],
    );
    let marker = f.cwd.join("dirent-hook-events");
    let run = Run::default()
        .with_env("LD_PRELOAD", hook)
        .with_env("FIND2FD_DIRENT_MARKER", &marker);
    f.compare(
        "raw-directory-negative-control",
        &args(&["tree", "-print0"]),
        Some("native"),
        &run.clone().with_env("FIND2FD_DIRENT_DISABLE", "1"),
    );
    assert!(!marker.exists());
    for argv in [
        args(&["tree", "-print0"]),
        args(&["tree", "-type", "f", "-print0"]),
        args(&["tree", "-type", "d", "-print0"]),
        args(&["tree", "-type", "l", "-print0"]),
        args(&["tree", "-type", "p", "-print0"]),
        args(&["tree", "-type", "s", "-print0"]),
        args(&["tree", "-name", "*txt", "-print0"]),
        args(&["tree", "-path", "*target*", "-print0"]),
    ] {
        f.compare("raw-directory-DT-UNKNOWN", &argv, Some("native"), &run);
    }
    assert!(fs::read_to_string(&marker)
        .unwrap()
        .contains("changed non-dot records"));
    f.directory("batches");
    for i in 0..720 {
        f.put(format!(
            "batches/file-{}-{}.txt",
            (i * 197) % 720,
            "x".repeat(32)
        ));
    }
    fs::remove_file(&marker).unwrap();
    f.compare(
        "raw-directory-multiple-batches",
        &args(&["batches", "-print0"]),
        Some("native"),
        &run,
    );
    assert!(
        fs::read_to_string(&marker).unwrap().lines().count() >= 4,
        "both the route query and actual search consume multiple real 32KiB batches"
    );
    for fault in ["zero-length", "missing-NUL", "short-header"] {
        f.compare(
            &format!("raw-directory-invalid-{fault}"),
            &args(&["tree", "-print0"]),
            Some("gnu"),
            &run.clone().with_env("FIND2FD_DIRENT_FAULT", fault),
        );
    }
    f.put("tree/ZERO_INODE_TEST");
    let trace = f.cwd.join("zero-inode-exec.trace");
    let actual = f.invoke(
        &f.binary,
        &args(&["tree", "-print0"]),
        &Run {
            trace: Some(trace.clone()),
            ..run.with_env("FIND2FD_DIRENT_FAULT", "zero-inode")
        },
    );
    assert!(
        !f.cwd.join("tree/ZERO_INODE_TEST").exists(),
        "injected inode-zero entry must actually be removed"
    );
    let expected = f.invoke(
        Path::new("/usr/bin/find"),
        &args(&["tree", "-print0"]),
        &Run::default(),
    );
    f.exact("raw-directory-zero-inode", &actual, &expected, "io");
    assert_eq!(
        fs::read_to_string(trace)
            .unwrap()
            .lines()
            .filter(|l| l.contains("execve("))
            .count(),
        1,
        "zero-inode skipping must be native, not masked by GNU fallback"
    );
    println!(
        "# {}",
        json!({"campaign":"raw-directory-batches","unknownTypeComparisons":9,"malformedRecordComparisons":3,"zeroInodeComparisons":1,"productionDataRead":false})
    );
}

fn runner_self_checks() {
    let fixture = Fixture::new();
    let shell = Path::new("/usr/bin/bash");
    let bounded = Run {
        timeout: Some(Duration::from_millis(250)),
        ..Run::default()
    };
    let started = Instant::now();
    let output = fixture
        .invoke_bounded(
            shell,
            &args(&["--noprofile", "--norc", "-c", "sleep 30 & printf done"]),
            &bounded,
        )
        .unwrap();
    assert_eq!(output.stdout, b"done");
    assert!(output.status.success());
    assert!(
        started.elapsed() < Duration::from_secs(2),
        "leader exit must not leave capture pipes blocked by its descendant"
    );
    let started = Instant::now();
    let nonreader = Run {
        input: Some(vec![b'x'; 2 * 1024 * 1024]),
        ..bounded.clone()
    };
    let error = fixture
        .invoke_bounded(
            shell,
            &args(&["--noprofile", "--norc", "-c", "sleep 30"]),
            &nonreader,
        )
        .unwrap_err();
    assert!(error.contains("exceeded bounded deadline"));
    assert!(
        started.elapsed() < Duration::from_secs(2),
        "blocked stdin must obey the same child deadline"
    );
    let output = fixture
        .invoke_bounded(
            shell,
            &args(&["--noprofile", "--norc", "-c", "exec 0<&-; printf closed"]),
            &nonreader,
        )
        .unwrap();
    assert_eq!(output.stdout, b"closed");
    assert!(
        output.status.success(),
        "early stdin close is a bounded BrokenPipe, not a failed oracle"
    );
    println!("# runner self-checks: 3 bounded stdin/descendant checks; no native or fallback comparison credit");
}

fn main() {
    if env::args().nth(1).as_deref() == Some("--runner-self-check") {
        runner_self_checks();
        return;
    }
    let tests: &[(&str, fn())] = &[
        ("bounded oracle process cleanup", runner_self_checks),
        ("native grammar and raw GNU order", native_grammar),
        ("boolean actions and global depth", boolean_depth),
        ("root basename and terminal slash", root_basename),
        ("384 seeded native interactions", seeded_campaign),
        ("specialized glob boundaries", optimized_globs),
        ("unsupported semantic delegation", unsupported_semantics),
        ("complete nonexecuting GNU inventory", option_inventory),
        ("owned GNU action effects", fallback_side_effects),
        ("ordered parallel traversal", parallel_order),
        ("shallow walk without workers", shallow_no_pool),
        (
            "errors locales cycles and output",
            errors_locales_transports,
        ),
        ("atomic preparation bounds", atomic_bounds),
        ("ignored SIGPIPE regression", ignored_sigpipe),
        ("nonblocking full stdout pipe regression", nonblocking_pipe),
        ("external actual exec proof", ordinary_exec_proof),
        ("controlled namespace replacement", namespace_replacement),
        (
            "raw directory type record and inode faults",
            raw_directory_faults,
        ),
    ];
    println!("TAP version 13");
    let mut failures = 0;
    for (index, (name, test)) in tests.iter().enumerate() {
        let result = std::panic::catch_unwind(*test);
        if result.is_err() {
            failures += 1;
            println!("not ok {} - {}", index + 1, name);
        } else {
            println!("ok {} - {}", index + 1, name);
        }
    }
    let reports = REPORTS.get().unwrap().lock().unwrap();
    let mut classes = BTreeMap::<String, usize>::new();
    let mut aggregate = json!({"artifactSHA256":reports[0]["artifactSHA256"],"comparisons":0,"rustSearches":0,"gnuFallbacks":0,"ioComparisons":0,"classes":{},"failures":failures,"runnerSelfChecks":3});
    for report in reports.iter() {
        assert_eq!(report["artifactSHA256"], aggregate["artifactSHA256"]);
        for key in [
            "comparisons",
            "rustSearches",
            "gnuFallbacks",
            "ioComparisons",
        ] {
            aggregate[key] =
                json!(aggregate[key].as_u64().unwrap() + report[key].as_u64().unwrap());
        }
        for (key, value) in report["classes"].as_object().unwrap() {
            *classes.entry(key.clone()).or_default() += value.as_u64().unwrap() as usize;
        }
    }
    aggregate["classes"] = json!(classes);
    println!("FIND2FD_ENGINE_REPORT={aggregate}");
    println!(
        "1..{}\n# tests {}\n# suites 0\n# pass {}\n# fail {}\n# cancelled 0\n# skipped 0\n# todo 0",
        tests.len(),
        tests.len(),
        tests.len() - failures,
        failures
    );
    if failures > 0 {
        std::process::exit(1);
    }
}
