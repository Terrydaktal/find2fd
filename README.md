# find2fd

**GNU find compatibility with a qualified fd execution path.**

find2fd accepts GNU `find` arguments. It uses fd for eligible directory searches, restores GNU's traversal order, and preserves path bytes and output format. Expressions that need GNU-specific behavior run unchanged through GNU find, without a guidance message or a request to rewrite the command.

The package provides a direct CLI, a private Bash function and an optional Pi extension. Its core works with any harness that runs shell commands; it needs no model or inference backend. The Pi extension defaults to the `qwen-r9700` provider.

## Requirements

- Linux, **Node.js 24 or newer**, **GNU find**, **Bash** and **GNU coreutils `readlink`**.
- **fd 9 or newer**, named `fd` or Debian's `fdfind`, for acceleration. Without a usable engine, commands use GNU find.
- Python 3, GNU coreutils `mkfifo`, npm and tar for verification and package checks.
- An installed Pi SDK only for the optional Pi extension or `--sdk` verification.

GNU find remains a runtime dependency. The wrapper deliberately delegates expressions outside its qualified subset to the original implementation.

## Install

Install the checkout with a user prefix:

```bash
git clone https://github.com/Terrydaktal/find2fd.git
cd find2fd
npm install --global --prefix "$HOME/.local" .
export PATH="$HOME/.local/bin:$PATH"
```

Alternatively, create links to the checkout:

```bash
mkdir -p "$HOME/.local/bin"
ln -s "$(pwd)/bin/find2fd" "$HOME/.local/bin/find2fd"
ln -s "$(pwd)/bin/find2fd-shell-prefix.mjs" "$HOME/.local/bin/find2fd-shell-prefix"
```

Keep that checkout in place, or recreate the links after moving it. Do not replace or symlink the system `find` executable.

## Direct CLI

These simple directory searches fit the fd candidate path:

```bash
find2fd -P . -type f -name '*.ts' | head -50
find2fd src -mindepth 1 -maxdepth 3 -type f -name '*test*' -print0
find2fd . -type d -name 'build' -print | cat
```

Newline output on a terminal uses GNU find for its pathname quoting. Piped or redirected newline output, and `-print0`, can qualify for fd. Qualification also depends on the actual filesystem and resource limits; a very large result or ordering directory uses GNU find instead.

The full GNU interface remains available through transparent fallback:

```bash
find2fd . -type f -mtime -1 -print
find2fd . -type f -name '*.log' -exec wc -l '{}' +
find2fd . -name node_modules -prune -o -name '*.ts' -print
```

`find2fd --help` and `find2fd --version` return GNU find's help and version. There are no additional wrapper flags mixed into the GNU expression. Exit status follows find: a successful search returns `0`, including a search with no matches; errors return a nonzero status.

## What qualifies for fd

The initial candidate subset is intentionally small:

| Part | Qualified form |
| --- | --- |
| Starting paths | Up to 256 existing directories, normalized ASCII paths and default physical traversal, `-P` |
| Expressions | Implicit conjunctions; `-a`/`-and` between supported predicates or before the final print action |
| Name matching | Nonempty ASCII literals and `*`; excludes `?`, brackets, braces, backslashes and `/` |
| File types | `-type f`, `d`, `l`, `p`, `s`, `b` or `c`; repeated type tests must be identical |
| Depth | `-mindepth` and `-maxdepth` before predicates, at most ten decimal digits and values up to 1,000,000; the last repeated value wins |
| Output | Default print or one final `-print`, with nonterminal stdout; `-print0` also qualifies |

Other GNU expressions go to GNU find before fd is invoked. This includes metadata tests, Unicode or more elaborate glob syntax, logical alternatives, symbolic-link following, pruning, early termination, formatting and actions. Normalized paths permit `.`/`./`/`/`, a leading `./` and a trailing slash, but not internal `.`/`..` components or repeated separators. See [compatibility](docs/compatibility.md) for the exact boundary and ordering limits.

## Opt in inside Bash

Load the private function into one shell:

```bash
eval "$(find2fd-shell-prefix)"
find -P . -type f -name '*.ts' | head -50
```

`find2fd-shell-prefix` takes no arguments. It prints the function definition and pins its Node executable and wrapper path. The function is not exported to child shells. User scripts and subprocesses continue using the system executable.

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

The extension keeps Pi's native `bash` tool and adds the private function only to eligible model-issued commands. User `!` commands retain normal shell execution. The default provider is `qwen-r9700`; an exact comma-separated list replaces that default:

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

1. The public CLI or Bash function preserves original arguments. Non-ASCII argument bytes go directly to GNU find before Node can decode them.
2. The parser selects a qualified expression or GNU fallback. The runtime checks starting paths and invokes fd with unrestricted traversal, explicit matching rules, no colors and NUL-separated output.
3. fd candidates remain buffered. The wrapper evaluates starting directories itself, since fd omits them, and reads candidate parents and ancestors with `opendir` to recover GNU's sibling order.
4. The wrapper emits the reordered paths with GNU root spelling and the requested newline or NUL separator. Problems detected before output cause the original command to run through GNU find instead.

Each fd search has a **10-second timeout**. Captured candidate bytes and rendered output each have a **32 MiB** cap; separate limits cover 100,000 candidates, 10,000 ordering directories and 200,000 ordering entries across starting paths. Any ordering directory exceeding **10,000 entries** uses GNU find because GNU's FTS traversal can switch to inode ordering. See [the complete bounds](docs/compatibility.md#resource-bounds).

Recovering order repeats directory enumeration for the candidate ancestors; broad searches can therefore re-enumerate most directories. It does not run a second GNU find traversal to build an ordering map, but it is additional work, and fd is not universally faster. Detected missing paths or type inconsistencies cause fallback; the wrapper does not provide an atomic filesystem snapshot or prove equivalence under arbitrary concurrent changes.

## Verification

Run focused checks, then the bounded or larger synthetic campaigns:

```bash
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

The packed deep suite and Pi SDK checks passed in both a Node 26/fd 9 environment and a Node 24/fdfind 10 VM. Each run passed **55 Node tests** and replayed the same **3,072 distinct full CLI comparisons** with zero mismatches; these are 3,072 unique cases, not 6,144. See [the qualification record](docs/qualification.json) for the captured package, source hashes and exact engine versions.

## Project structure

```text
find2fd/
├── bin/
│   ├── find2fd                   Public Bash CLI; preserves raw argument bytes
│   ├── find2fd.mjs               Internal Node dispatcher; original GNU arguments
│   └── find2fd-shell-prefix.mjs  Emits the private Bash function
├── src/
│   ├── find-options.mjs         GNU expression parsing and qualification
│   ├── find-order.mjs           Candidate records, ancestor ordering and path rendering
│   ├── find-runtime.mjs         fd execution, limits and transparent GNU fallback
│   └── find-wrapper.mjs         planFind, runFind and withFindWrapper interfaces
├── pi/
│   └── find2fd.ts               Optional provider-scoped native Pi bash integration
├── tests/                       Synthetic GNU comparisons and focused regressions
├── tools/
│   ├── verify.mjs               Tiered checks and structured JSON reports
│   └── verify-artifact.mjs      Packs, extracts and verifies the npm artifact
├── docs/                        Compatibility and verification details
├── package.json                 CLI, runtime and optional Pi metadata
├── LICENSE                      Full Apache License 2.0
└── NOTICE                       Copyright and implementation origin
```

Install the dependencies and package, then use the CLI or opt into a shell or harness integration. Run verification after changing the code or engine versions.

## Origin and license

This is a new GNU find compatibility implementation by **Terrydaktal**. Its packaging and scoped shell/Pi integration follow the approach developed for [grep2rg](https://github.com/Terrydaktal/grep2rg); it was not extracted from an existing find wrapper. GNU find and fd are separately installed dependencies, and their implementation code is not included here.

find2fd's original code is licensed under [Apache 2.0](LICENSE). See [NOTICE](NOTICE) for attribution.
