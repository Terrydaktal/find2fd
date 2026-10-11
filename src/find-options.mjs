import { basename, isAbsolute } from "node:path";

const native = (args, reason) => ({ eligible: false, args, reason });
const ascii = (value) => typeof value === "string" && /^[\x01-\x7f]*$/.test(value);
const isExpression = (value) => value.startsWith("-") || ["!", "(", ")", ","].includes(value);
const TYPE_METHODS = { f: "isFile", d: "isDirectory", l: "isSymbolicLink", p: "isFIFO", s: "isSocket", b: "isBlockDevice", c: "isCharacterDevice" };

export function normalizedRoot(value) {
  if (!value || !ascii(value)) return false;
  if ([".", "./", "/"].includes(value)) return true;
  let path = value;
  if (path.startsWith("./")) path = path.slice(2);
  else if (isAbsolute(path)) path = path.slice(1);
  if (path.endsWith("/")) path = path.slice(0, -1);
  return path.length > 0 && path.split("/").every((part) => part && part !== "." && part !== "..");
}

export function rootName(root) {
  return Buffer.from(root === "/" ? "/" : [".", "./"].includes(root) ? "." : basename(root));
}

// ASCII literals and '*' have the same byte matching semantics without locale
// folding, bracket expressions, GNU escapes or fd's brace alternatives.
export function safeName(pattern) {
  return ascii(pattern) && pattern.length > 0 && !/[?\[\]{}\\/]/.test(pattern);
}

export function nameMatches(name, pattern) {
  const source = pattern.split("*").map((part) => part.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&")).join("[\\s\\S]*");
  return new RegExp(`^(?:${source})(?![\\s\\S])`).test(name.toString("latin1"));
}

/** Parse only pure GNU listing expressions. Everything else remains GNU argv. */
export function parseFindOptions(argv) {
  if (!Array.isArray(argv) || !argv.every(ascii)) return native(argv, "non-ASCII or invalid argument bytes");
  let index = argv[0] === "-P" ? 1 : 0;
  const roots = [];
  while (index < argv.length && !isExpression(argv[index])) roots.push(argv[index++]);
  if (!roots.length) roots.push(".");
  if (!roots.every(normalizedRoot)) return native(argv, "unnormalized starting paths");
  const options = { roots, minDepth: 0, maxDepth: null, names: [], type: null, action: "print" };
  while (["-mindepth", "-maxdepth"].includes(argv[index])) {
    const flag = argv[index++], value = argv[index++];
    if (!/^\d+$/.test(value ?? "") || value.length > 10 || Number(value) > 1000000)
      return native(argv, "GNU depth validation or unbounded depth");
    options[flag === "-mindepth" ? "minDepth" : "maxDepth"] = Number(value);
  }
  let previous = false, needPrimary = false;
  while (index < argv.length) {
    const flag = argv[index++];
    if (flag === "-a" || flag === "-and") {
      if (!previous || needPrimary) return native(argv, "GNU conjunction syntax");
      needPrimary = true;
      continue;
    }
    if (flag === "-print" || flag === "-print0") {
      if (index !== argv.length) return native(argv, "only one terminal print action qualifies");
      options.action = flag === "-print0" ? "print0" : "print";
      needPrimary = false;
      previous = true;
      continue;
    }
    if (flag === "-name") {
      const pattern = argv[index++];
      if (!safeName(pattern)) return native(argv, "GNU filename pattern requires native matching");
      options.names.push(pattern);
    } else if (flag === "-type") {
      const type = argv[index++];
      if (!/^[fdlpsbc]$/.test(type ?? "") || (options.type && options.type !== type))
        return native(argv, "GNU file type syntax or combined type tests");
      options.type = type;
    } else return native(argv, "GNU expression, option, diagnostic or action outside the listing subset");
    needPrimary = false;
    previous = true;
  }
  if (needPrimary) return native(argv, "GNU conjunction is missing its right operand");
  return { eligible: true, options };
}

export function typeMatches(entry, type) {
  if (!type) return true;
  return entry[TYPE_METHODS[type]]();
}

export function fdArguments(path, options) {
  const args = ["--hidden", "--no-ignore", "--no-ignore-parent", "--show-errors", "--print0", "--color", "never", "--threads", "8", "--absolute-path", "--case-sensitive"];
  if (options.type) args.push("--type", options.type);
  if (options.minDepth) args.push("--min-depth", String(options.minDepth));
  if (options.maxDepth !== null) args.push("--max-depth", String(options.maxDepth));
  if (options.names.length) args.push("--glob");
  args.push("--search-path", path, "--", options.names[0] ?? "");
  return args;
}
