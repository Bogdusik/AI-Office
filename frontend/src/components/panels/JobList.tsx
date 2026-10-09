"use client";

import type { JobRow, JobsReport } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { exclusionReason, freshnessNote } from "@/lib/labels";

type Kind = "job" | "excluded" | "closed";

function Freshness({ job }: { job: JobRow }) {
  const t = useT();
  if (!job.freshness) return null;
  const note = freshnessNote(t, job.freshness_note);
  if (job.freshness === "open") {
    return (
      <p className="mt-0.5 text-signal-ok" data-freshness="open">
        {note || t("jobs.open")}
      </p>
    );
  }
  return (
    <p className="mt-0.5 text-ink/50" data-freshness="unchecked" title={job.freshness_note}>
      {t("jobs.unchecked")}
      {note ? ` · ${note}` : ""}
    </p>
  );
}

function Row({ job, kind }: { job: JobRow; kind: Kind }) {
  const t = useT();
  const meta = [job.company, job.location, job.salary, job.posted ? t("jobs.posted", { date: job.posted }) : null].filter(Boolean).join(" · ");
  const extra = Object.entries(job.links ?? {}).filter(([, url]) => url !== job.url);
  const usable = kind === "job";
  return (
    <li
      className={`rounded-lg border px-3 py-2 text-xs ${usable ? "border-line bg-white" : kind === "closed" ? "border-line bg-ink/[0.03]" : "border-signal-down/25 bg-signal-down/5"}`}
      data-ref={job.ref}
    >
      <div className="flex items-start gap-2">
        {job.ref && usable && <span className="shrink-0 font-mono text-ink/40">{job.ref}</span>}
        <a href={job.url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 font-medium text-accent underline-offset-2 hover:underline" title={job.url}>
          {job.title || job.url}
        </a>
        {usable && <span className="shrink-0 text-[10px] text-ink/40">{job.full ? t("jobs.fullText") : t("jobs.snippet")}</span>}
      </div>
      {meta && <p className="mt-0.5 text-ink/60">{meta}</p>}
      {extra.length > 0 && (
        <p className="mt-0.5 text-ink/45">
          {t("jobs.also")}{" "}
          {extra.map(([source, url]) => (
            <a key={source} href={url} target="_blank" rel="noopener noreferrer" className="mr-2 text-accent hover:underline">
              {source}
            </a>
          ))}
        </p>
      )}
      {usable && <Freshness job={job} />}
      {kind === "excluded" &&
        job.exclusions.map((e) => (
          <p key={e.reason} className="mt-1 text-ink/75">
            <span className="font-medium text-signal-down">{exclusionReason(t, e.reason)}</span> · {t("common.quoted", { text: e.phrase })}
          </p>
        ))}
      {kind === "closed" && (
        <p className="mt-1 text-ink/75" title={job.freshness_note}>
          <span className="font-medium">{t("jobs.closed")}</span> · {freshnessNote(t, job.freshness_note)}
        </p>
      )}
    </li>
  );
}

function Group({ title, rows, kind, testId }: { title: string; rows: JobRow[]; kind: Kind; testId?: string }) {
  if (!rows.length) return null;
  return (
    <div className="flex flex-col gap-1" data-testid={testId}>
      <span className="text-[11px] font-medium text-ink/55">
        {title} · {rows.length}
      </span>
      <ul className="flex flex-col gap-1">
        {rows.map((job) => (
          <Row key={job.ref || job.url} job={job} kind={kind} />
        ))}
      </ul>
    </div>
  );
}

/** Vacancies behind a result: the ones the agent could use and, separately, the ones the hard filter excluded and the closed ones. */
export function JobList({ report }: { report: JobsReport }) {
  const t = useT();
  const failures = Object.entries(report.failures ?? {});
  const expired = report.expired ?? [];
  const closedTask = (report.task_pages ?? []).filter((p) => p.freshness === "expired");
  const uncheckedTask = (report.task_pages ?? []).filter((p) => p.freshness === "unchecked");
  if (!report.jobs.length && !report.excluded.length && !expired.length && !failures.length && !report.task_flags.length && !report.task_pages?.length) return null;
  return (
    <div className="flex flex-col gap-2" data-testid="job-list">
      {report.task_flags.length > 0 && (
        <p className="rounded-lg border border-signal-down/30 bg-signal-down/8 px-3 py-2 text-xs text-ink" data-testid="job-verdict">
          <span className="font-semibold">{t("jobs.verdictIneligible")}</span> {report.task_flags.map((f) => `${exclusionReason(t, f.reason)} (${t("common.quoted", { text: f.phrase })})`).join("; ")}
        </p>
      )}
      {!report.task_flags.length && closedTask.length > 0 && (
        <p className="rounded-lg border border-line bg-ink/[0.03] px-3 py-2 text-xs text-ink" data-testid="job-verdict">
          <span className="font-semibold">{t("jobs.verdictClosed")}</span> {closedTask.map((p) => freshnessNote(t, p.note)).join("; ")}
        </p>
      )}
      {uncheckedTask.map((p) => (
        <p key={p.url} className="text-[11px] text-ink/50" title={p.note}>
          {t("jobs.taskUnchecked")} · {freshnessNote(t, p.note)}
        </p>
      ))}
      <Group title={t("jobs.jobs")} rows={report.jobs} kind="job" />
      <Group title={t("jobs.excluded")} rows={report.excluded} kind="excluded" testId="job-excluded" />
      {report.summary && <p className="text-[11px] text-ink/50">{report.summary}</p>}
      <Group title={t("jobs.closedGroup")} rows={expired} kind="closed" testId="job-closed" />
      {failures.map(([source, why]) => (
        <p key={source} className="text-[11px] text-signal-down">
          {source}: {why}
        </p>
      ))}
    </div>
  );
}
