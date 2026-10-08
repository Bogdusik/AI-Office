"use client";

import type { JobRow, JobsReport } from "@/lib/api";
import { exclusionReason } from "@/lib/labels";

function Row({ job, excluded }: { job: JobRow; excluded?: boolean }) {
  const meta = [job.company, job.location, job.salary, job.posted ? `опубликована ${job.posted}` : null].filter(Boolean).join(" · ");
  const extra = Object.entries(job.links ?? {}).filter(([, url]) => url !== job.url);
  return (
    <li className={`rounded-lg border px-3 py-2 text-xs ${excluded ? "border-signal-down/25 bg-signal-down/5" : "border-line bg-white"}`} data-ref={job.ref}>
      <div className="flex items-start gap-2">
        {job.ref && !excluded && <span className="shrink-0 font-mono text-ink/40">{job.ref}</span>}
        <a href={job.url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 font-medium text-accent underline-offset-2 hover:underline" title={job.url}>
          {job.title || job.url}
        </a>
        {!excluded && <span className="shrink-0 text-[10px] text-ink/40">{job.full ? "полный текст" : "по фрагменту"}</span>}
      </div>
      {meta && <p className="mt-0.5 text-ink/60">{meta}</p>}
      {extra.length > 0 && (
        <p className="mt-0.5 text-ink/45">
          также:{" "}
          {extra.map(([source, url]) => (
            <a key={source} href={url} target="_blank" rel="noopener noreferrer" className="mr-2 text-accent hover:underline">
              {source}
            </a>
          ))}
        </p>
      )}
      {excluded &&
        job.exclusions.map((e) => (
          <p key={e.reason} className="mt-1 text-ink/75">
            <span className="font-medium text-signal-down">{exclusionReason(e.reason)}</span> · «{e.phrase}»
          </p>
        ))}
    </li>
  );
}

/** Vacancies behind a result: the ones the agent could use and, separately, the ones the hard filter excluded. */
export function JobList({ report }: { report: JobsReport }) {
  const failures = Object.entries(report.failures ?? {});
  if (!report.jobs.length && !report.excluded.length && !failures.length && !report.task_flags.length) return null;
  return (
    <div className="flex flex-col gap-2" data-testid="job-list">
      {report.task_flags.length > 0 && (
        <p className="rounded-lg border border-signal-down/30 bg-signal-down/8 px-3 py-2 text-xs text-ink" data-testid="job-verdict">
          <span className="font-semibold">Вакансия недоступна, заявка не готовится:</span>{" "}
          {report.task_flags.map((f) => `${exclusionReason(f.reason)} («${f.phrase}»)`).join("; ")}
        </p>
      )}
      {report.jobs.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-ink/55">Вакансии · {report.jobs.length}</span>
          <ul className="flex flex-col gap-1">
            {report.jobs.map((job) => (
              <Row key={job.ref || job.url} job={job} />
            ))}
          </ul>
        </div>
      )}
      {report.excluded.length > 0 && (
        <div className="flex flex-col gap-1" data-testid="job-excluded">
          <span className="text-[11px] font-medium text-ink/55">Недоступны · {report.excluded.length}</span>
          <ul className="flex flex-col gap-1">
            {report.excluded.map((job) => (
              <Row key={job.ref || job.url} job={job} excluded />
            ))}
          </ul>
        </div>
      )}
      {report.summary && <p className="text-[11px] text-ink/50">{report.summary}</p>}
      {failures.map(([source, why]) => (
        <p key={source} className="text-[11px] text-signal-down">
          {source}: {why}
        </p>
      ))}
    </div>
  );
}
