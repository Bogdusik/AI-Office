/**
 * The interface is fully translated (no test runner):
 *   node --experimental-strip-types --no-warnings --import ./scripts/register-ts.mjs scripts/check-i18n.mts
 * Fails when Cyrillic appears in the frontend sources outside the Russian dictionary, or when the two
 * dictionaries differ in keys or in the `{placeholders}` of a key.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { en } from "@/lib/i18n/en";
import { ru } from "@/lib/i18n/ru";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/(\w:)/, "$1");
const RU_DICT = join(ROOT, "src", "lib", "i18n", "ru.ts");
const CYRILLIC = new RegExp(`[${String.fromCharCode(0x400)}-${String.fromCharCode(0x4ff)}]`);
const problems: string[] = [];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(ts|tsx|mts|mjs|js|css)$/.test(name) ? [path] : [];
  });
}

for (const path of [...files(join(ROOT, "src")), ...files(join(ROOT, "scripts"))]) {
  if (path === RU_DICT) continue;
  readFileSync(path, "utf8")
    .split("\n")
    .forEach((line, i) => {
      if (CYRILLIC.test(line)) problems.push(`Cyrillic outside the Russian dictionary: ${relative(ROOT, path)}:${i + 1}: ${line.trim()}`);
    });
}

type Tree = { readonly [key: string]: string | Tree };

function leaves(tree: Tree, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    if (typeof value === "string") out.set(prefix + key, value);
    else for (const [k, v] of leaves(value, `${prefix}${key}.`)) out.set(k, v);
  }
  return out;
}

/** `{name}` and `{name, plural, …}` → the parameter names a string expects. */
const placeholders = (text: string) => [...new Set([...text.matchAll(/\{(\w+)(?=[,}])/g)].map((m) => m[1]))].sort().join(",");

const english = leaves(en as Tree);
const russian = leaves(ru as Tree);
for (const key of english.keys()) if (!russian.has(key)) problems.push(`Missing in ru.ts: ${key}`);
for (const key of russian.keys()) if (!english.has(key)) problems.push(`Missing in en.ts: ${key}`);
for (const [key, text] of english) {
  const other = russian.get(key);
  if (other !== undefined && placeholders(text) !== placeholders(other))
    problems.push(`Different placeholders for ${key}: en {${placeholders(text)}} / ru {${placeholders(other)}}`);
  if (!text.trim() || (other !== undefined && !other.trim())) problems.push(`Empty text for ${key}`);
}

if (problems.length) {
  console.error(problems.join("\n"));
  console.error(`\ncheck:i18n failed: ${problems.length} problem(s)`);
  process.exit(1);
}
console.log(`ok  ${english.size} keys in both dictionaries, same placeholders; no Cyrillic outside ru.ts`);
