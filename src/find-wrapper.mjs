import { basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runFind } from "./find-runtime.mjs";
export { planFind, runFind } from "./find-runtime.mjs";

const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
const wrapperPath = fileURLToPath(import.meta.url);

// Bash expands quotes and globs first. This function is intentionally private to
// its shell; user commands and build scripts retain their native executable.
export function withFindWrapper(context, shellPath) {
  if (shellPath && !/^bash(?:\.exe)?$/.test(basename(shellPath))) return context;
  const prefix = `if [ -n "\${BASH_VERSION-}" ]; then
\tfind() {
\t\tif ! (
\t\t\tLC_ALL=C
\t\t\t_find2fd_nonascii=$'[^\\001-\\177]'
\t\t\tfor _find2fd_arg; do
\t\t\t\tif [[ $_find2fd_arg =~ $_find2fd_nonascii ]]; then exit 1; fi
\t\t\tdone
\t\t); then
\t\t\tcommand find "$@"
\t\t\treturn
\t\tfi
\t\tcommand ${quote(process.execPath)} ${quote(wrapperPath)} "$@"
\t}

\texport -n -f find
fi
`;
  return { ...context, command: prefix + context.command };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.exitCode = await runFind(process.argv.slice(2));
}
