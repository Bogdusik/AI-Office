"use client";

import { useState } from "react";
import type { Artifact, Run } from "@/lib/api";
import { TASK_STAGE } from "@/lib/labels";
import { Markdown } from "./Markdown";
import { Button, Empty, formatDate } from "./ui";

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  return (
    <Button variant="outline" className="!px-2.5 !py-1 text-xs" onClick={copy} data-testid="copy-result">
      {copied ? "Скопировано" : "Копировать"}
    </Button>
  );
}

/** Versions of the result with a switcher; the newest is shown first. */
export function ResultView({ artifacts }: { artifacts: Artifact[] }) {
  const [picked, setPicked] = useState<number | null>(null);
  if (!artifacts.length) return <Empty>Результата пока нет.</Empty>;
  const latest = artifacts.at(-1)!;
  const shown = artifacts.find((a) => a.version === picked) ?? latest;

  return (
    <div className="flex flex-col gap-2" data-testid="result">
      <div className="flex items-center gap-2">
        <div role="tablist" aria-label="Версии результата" className="flex gap-0.5 rounded-full bg-ink/5 p-0.5">
          {artifacts.map((a) => (
            <button
              key={a.version}
              type="button"
              role="tab"
              aria-selected={a.version === shown.version}
              onClick={() => setPicked(a.version)}
              className={`rounded-full px-2.5 py-0.5 font-mono text-[11px] transition ${a.version === shown.version ? "bg-white text-ink shadow-sm" : "text-ink/55 hover:text-ink"}`}
            >
              v{a.version}
            </button>
          ))}
        </div>
        <span className="flex-1 truncate text-[11px] text-ink/45">
          {formatDate(shown.created_at)}
          {shown.version !== latest.version && " · не последняя версия"}
        </span>
        <CopyButton text={shown.content} />
      </div>
      <div className="max-h-[26rem] overflow-auto rounded-lg border border-line bg-white p-3.5" data-version={shown.version}>
        <Markdown text={shown.content} />
      </div>
    </div>
  );
}

/** The stage being worked on right now, with the text as it is being written. */
export function LiveRun({ run }: { run: Run }) {
  const waiting = run.status === "waiting";
  const note = waiting ? "ждёт очереди к модели" : run.output ? "пишет…" : "думает…";
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-accent/30 bg-accent/5 p-3" data-testid="live-run" data-status={run.status}>
      <div className="flex items-center gap-2 text-xs">
        <span className="relative flex h-2 w-2">
          {!waiting && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />}
          <span className={`relative inline-flex h-2 w-2 rounded-full ${waiting ? "bg-[#6f9bc6]" : "bg-accent"}`} />
        </span>
        <span className="font-medium text-ink">Этап: {TASK_STAGE[run.stage]}</span>
        <span className="text-ink/55">· {note}</span>
        {run.model && <span className="ml-auto font-mono text-[10px] text-ink/40">{run.model}</span>}
      </div>
      {run.output && (
        <div className="max-h-64 overflow-auto rounded-lg bg-white/80 p-3" data-testid="live-text">
          <Markdown text={run.output} />
        </div>
      )}
    </div>
  );
}
