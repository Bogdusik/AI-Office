"use client";

import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const components: Components = {
  h1: ({ children }) => <h1 className="mt-3 mb-2 text-base font-semibold text-ink first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="mt-3 mb-1.5 text-[15px] font-semibold text-ink first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="mt-2.5 mb-1 text-sm font-semibold text-ink first:mt-0">{children}</h3>,
  p: ({ children }) => <p className="my-2 leading-relaxed first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
  blockquote: ({ children }) => <blockquote className="my-2 border-l-2 border-accent/50 pl-3 text-ink/70">{children}</blockquote>,
  code: ({ children }) => <code className="rounded bg-ink/6 px-1 py-0.5 font-mono text-[12px]">{children}</code>,
  pre: ({ children }) => <pre className="my-2 overflow-x-auto rounded-lg bg-ink/5 p-2.5 text-[12px]">{children}</pre>,
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noreferrer" className="text-accent underline underline-offset-2">
      {children}
    </a>
  ),
  hr: () => <hr className="my-3 border-line" />,
  strong: ({ children }) => <strong className="font-semibold text-ink">{children}</strong>,
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto rounded-lg border border-line">
      <table className="w-full border-collapse text-[13px] [overflow-wrap:normal]">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-paper/80 text-left">{children}</thead>,
  tr: ({ children }) => <tr className="border-t border-line first:border-t-0">{children}</tr>,
  th: ({ children, style }) => (
    <th className="px-2.5 py-1.5 align-bottom font-semibold whitespace-nowrap text-ink" style={style}>
      {children}
    </th>
  ),
  td: ({ children, style }) => (
    <td className="px-2.5 py-1.5 align-top" style={style}>
      {children}
    </td>
  ),
  del: ({ children }) => <del className="text-ink/50">{children}</del>,
};

const plugins = [remarkGfm];

/** Model output as Markdown (GitHub flavour: tables, strikethrough, task lists, autolinks); raw HTML is not rendered. */
export function Markdown({ text }: { text: string }) {
  return (
    <div className="text-sm text-ink/90 [overflow-wrap:anywhere]">
      <ReactMarkdown remarkPlugins={plugins} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
