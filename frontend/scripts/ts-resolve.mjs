// Node resolve hook for running TypeScript sources directly (with --experimental-strip-types):
// maps the "@/..." alias to src/ and adds a missing ".ts" / "/index.ts" to extensionless relative imports.
const SRC = new URL("../src/", import.meta.url);

export async function resolve(specifier, context, next) {
  const spec = specifier.startsWith("@/") ? new URL(specifier.slice(2), SRC).href : specifier;
  try {
    return await next(spec, context);
  } catch (error) {
    const local = spec.startsWith(".") || spec.startsWith("file:");
    if (!local || /\.[cm]?[jt]sx?$/.test(spec)) throw error;
    for (const suffix of [".ts", "/index.ts"]) {
      try {
        return await next(spec + suffix, context);
      } catch {
        // try the next candidate
      }
    }
    throw error;
  }
}
