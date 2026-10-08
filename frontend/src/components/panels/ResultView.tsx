"use client";

import { useState } from "react";
import type { Artifact, Run, WebStep } from "@/lib/api";
import { TASK_STAGE, freshnessNote } from "@/lib/labels";
import { JobList } from "./JobList";
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
      {shown.jobs && <JobList report={shown.jobs} />}
      {shown.sources.length > 0 && <SourceList urls={shown.sources} />}
    </div>
  );
}

function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname === "/" ? "" : u.pathname;
    return `${u.hostname.replace(/^www\./, "")}${path}`;
  } catch {
    return url;
  }
}

/** Numbered sources of a result; the numbers match the [n] marks in the text. */
export function SourceList({ urls }: { urls: string[] }) {
  return (
    <div className="flex flex-col gap-1" data-testid="sources">
      <span className="text-[11px] font-medium text-ink/55">Источники</span>
      <ol className="flex flex-col gap-0.5 text-xs">
        {urls.map((url, i) => (
          <li key={url} className="flex gap-2">
            <span className="w-6 shrink-0 font-mono text-ink/40">[{i + 1}]</span>
            <a href={url} target="_blank" rel="noopener noreferrer" className="truncate text-accent underline-offset-2 hover:underline" title={url}>
              {shortUrl(url)}
            </a>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** What the agent searched and read on the web, step by step. */
export function WebSteps({ steps }: { steps: WebStep[] }) {
  if (!steps.length) return null;
  return (
    <ul className="flex flex-col gap-1" data-testid="web-steps">
      {steps.map((s) => {
        const failed = s.status === "failed";
        const running = s.status === "running";
        const verb = s.kind === "search" ? (running ? "Ищет" : "Искал") : running ? "Читает" : "Прочитал";
        const row = `flex items-start gap-2 rounded-md px-2 py-1 text-xs ${failed ? "bg-signal-down/8 text-ink/70" : running ? "bg-[#2a9fd6]/10" : "bg-white/70"}`;
        if (s.kind === "jobs" || s.kind === "job") return <JobStep key={s.id} step={s} className={row} />;
        return (
          <li key={s.id} className={row} data-status={s.status} data-kind={s.kind}>
            <span aria-hidden>{s.kind === "search" ? "🔎" : "📄"}</span>
            <span className="min-w-0 flex-1">
              <span className="font-medium text-ink">{failed ? (s.kind === "search" ? "Поиск не удался" : "Не открылась") : verb}: </span>
              {s.kind === "fetch" && s.status === "done" && s.url ? (
                <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline" title={s.url}>
                  {s.detail || shortUrl(s.url)}
                </a>
              ) : (
                <span className="break-all text-ink/80">{s.kind === "fetch" ? shortUrl(s.target) : `«${s.target}»`}</span>
              )}
              {s.source !== undefined && <span className="ml-1 font-mono text-ink/45">[{s.source}]</span>}
              {s.detail && s.kind === "search" && <span className="text-ink/50"> · {s.detail}</span>}
              {failed && s.kind === "fetch" && s.detail && <span className="block text-ink/50">{s.detail}</span>}
            </span>
            {running && <span className="ml-auto shrink-0 animate-pulse text-[#2a9fd6]">…</span>}
          </li>
        );
      })}
    </ul>
  );
}

/** A job search ("found 18, excluded 2") or the reading of one job advert. */
function JobStep({ step: s, className }: { step: WebStep; className: string }) {
  const running = s.status === "running";
  const failed = s.status === "failed";
  const search = s.kind === "jobs";
  const verb = search ? (running ? "Ищет вакансии" : failed ? "Поиск вакансий не удался" : "Искал вакансии") : running ? "Читает вакансию" : failed ? "Не дочитал вакансию" : "Прочитал вакансию";
  return (
    <li className={className} data-status={s.status} data-kind={s.kind}>
      <span aria-hidden>{search ? "💼" : "📋"}</span>
      <span className="min-w-0 flex-1">
        <span className="font-medium text-ink">{verb}: </span>
        {!search && s.url ? (
          <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline" title={s.url}>
            {s.target}
          </a>
        ) : (
          <span className="break-all text-ink/80">{search ? `«${s.target}»` : s.target}</span>
        )}
        {s.detail && (
          <span className={failed || s.detail.startsWith("недоступна") || s.detail.startsWith("закрыта") ? "block text-ink/55" : "text-ink/50"}>
            {" "}
            · {s.detail.startsWith("закрыта: ") ? `закрыта: ${freshnessNote(s.detail.slice(9))}` : s.detail}
          </span>
        )}
      </span>
      {running && <span className="ml-auto shrink-0 animate-pulse text-[#2a9fd6]">…</span>}
    </li>
  );
}

/** The stage being worked on right now, with the text as it is being written. */
export function LiveRun({ run }: { run: Run }) {
  const waiting = run.status === "waiting";
  const step = run.activity.at(-1);
  const onWeb = step?.status === "running";
  const onJobs = onWeb && (step?.kind === "jobs" || step?.kind === "job");
  const note = waiting ? "ждёт очереди к модели" : onJobs ? "ищет вакансии…" : onWeb ? "ищет в сети…" : run.output ? "пишет…" : "думает…";
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
      <WebSteps steps={run.activity} />
      {run.output && (
        <div className="max-h-64 overflow-auto rounded-lg bg-white/80 p-3" data-testid="live-text">
          <Markdown text={run.output} />
        </div>
      )}
    </div>
  );
}
