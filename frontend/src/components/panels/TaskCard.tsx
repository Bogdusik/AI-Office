"use client";

import { type FormEvent, useState } from "react";
import { type TaskDetail, type TaskStatus, api } from "@/lib/api";
import { humanize } from "@/lib/errors";
import { type Key, useT } from "@/lib/i18n";
import { jobCounts, runError, stageName, taskTag } from "@/lib/labels";
import { useAction } from "@/lib/useAction";
import { useFetched } from "@/lib/useFetched";
import type { LocatedAgent } from "@/lib/world";
import { useTasksStore } from "@/store/useTasksStore";
import { useUiStore } from "@/store/useUiStore";
import { LiveRun, ResultView, WebSteps } from "./ResultView";
import { Button, ConfirmButton, Empty, ErrorNote, PanelShell, Pill, Section, formatDate, formatNumber, inputCls } from "./ui";

const TERMINAL: TaskStatus[] = ["done", "failed", "cancelled"];

/** Which director actions the backend accepts in each status (mirrors ALLOWED_TRANSITIONS in rules.py). */
function actionsFor(status: TaskStatus) {
  return {
    approve: status === "needs_review",
    requestChanges: status === "needs_review",
    pause: status === "in_progress",
    resume: status === "paused",
    retry: status === "failed",
    cancel: !TERMINAL.includes(status),
  };
}

function Actions({ task }: { task: TaskDetail }) {
  const t = useT();
  const can = actionsFor(task.status);
  const [returning, setReturning] = useState(false);
  const [reason, setReason] = useState("");
  const { busy, error, setError, run } = useAction();

  const sendBack = async (e: FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) {
      setError(t("errors.commentRequired"));
      return;
    }
    const r = await run("return", () => api.requestChanges(task.id, reason));
    if (r.ok) {
      setReturning(false);
      setReason("");
    }
  };

  if (!Object.values(can).some(Boolean)) return null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {can.approve && (
          <Button variant="primary" busy={busy === "approve"} onClick={() => run("approve", () => api.approve(task.id))}>
            {t("task.approve")}
          </Button>
        )}
        {can.requestChanges && !returning && <Button onClick={() => setReturning(true)}>{t("task.requestChanges")}</Button>}
        {can.pause && (
          <Button busy={busy === "pause"} onClick={() => run("pause", () => api.pause(task.id))}>
            {t("task.pause")}
          </Button>
        )}
        {can.resume && (
          <Button busy={busy === "resume"} onClick={() => run("resume", () => api.resume(task.id))}>
            {t("task.resume")}
          </Button>
        )}
        {can.retry && (
          <Button variant="primary" busy={busy === "retry"} onClick={() => run("retry", () => api.retry(task.id))} title={t("task.retryTitle")}>
            {t("task.retry")}
          </Button>
        )}
        {can.cancel && (
          <ConfirmButton label={t("task.cancel")} question={t("task.cancelQuestion")} busy={busy === "cancel"} onConfirm={() => run("cancel", () => api.cancel(task.id))} />
        )}
      </div>
      {returning && (
        <form onSubmit={sendBack} className="flex flex-col gap-2 rounded-xl border border-accent/40 bg-accent/5 p-3" aria-label={t("task.requestChanges")}>
          <textarea autoFocus className={`${inputCls} min-h-20 resize-y`} placeholder={t("task.whatToFix")} value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setReturning(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" variant="primary" busy={busy === "return"}>
              {t("task.sendBack")}
            </Button>
          </div>
        </form>
      )}
      <ErrorNote text={error} />
    </div>
  );
}

function CommentForm({ taskId }: { taskId: number }) {
  const t = useT();
  const [body, setBody] = useState("");
  const { busy, error, run } = useAction();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const r = await run("comment", () => api.comment(taskId, body));
    if (r.ok) setBody("");
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-2" aria-label={t("task.commentLabel")}>
      <textarea className={`${inputCls} min-h-14 resize-y`} placeholder={t("task.commentPlaceholder")} value={body} onChange={(e) => setBody(e.target.value)} />
      <ErrorNote text={error} />
      <div className="flex justify-end">
        <Button type="submit" busy={busy === "comment"} disabled={!body.trim()}>
          {t("task.addComment")}
        </Button>
      </div>
    </form>
  );
}

export function TaskCard({ taskId, located }: { taskId: number; located: LocatedAgent | null }) {
  const t = useT();
  const openTask = useUiStore((s) => s.openTask);
  const select = useUiStore((s) => s.select);
  const revision = useTasksStore((s) => s.revision);
  const listed = useTasksStore((s) => s.tasks.find((x) => x.id === taskId));
  const live = useTasksStore((s) => s.progress[taskId] ?? 0);
  const { data: task, error } = useFetched((signal) => api.task(taskId, signal), [taskId, revision, live, listed?.status, listed?.stage]);

  const back = located ? () => openTask(null) : () => select(null);
  const s = task ? taskTag(t, task.status) : null;
  const active = task?.runs.findLast((r) => r.status === "running" || r.status === "waiting");
  const failedRun = task?.runs.findLast((r) => r.status === "failed");
  const failure = failedRun ? runError(t, failedRun) : null;
  const research = task?.runs.findLast((r) => r.stage === "research" && r.id !== active?.id && r.activity.length > 0);
  const tokens = task?.runs.reduce((n, r) => n + r.input_tokens + r.output_tokens, 0) ?? 0;

  return (
    <PanelShell
      testId="task-card"
      eyebrow={
        <button type="button" onClick={back} className="hover:text-ink">
          ← {located ? `${located.agent.title} · ${located.agent.name}` : t("common.back")}
        </button>
      }
      title={task?.title ?? listed?.title ?? t("task.fallbackTitle")}
      onClose={back}
    >
      {error && !task ? <ErrorNote text={humanize(t, error)} /> : null}
      {task && s && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Pill label={s.label} color={s.color} />
            <span className="rounded-full border border-line px-2.5 py-0.5 text-[11px] text-ink/70">{t("task.stage", { stage: task.stage ? stageName(t, task.stage) : "—" })}</span>
            <span className="font-mono text-[11px] text-ink/45">#{task.id}</span>
          </div>
          <dl className="grid grid-cols-3 gap-2 text-xs">
            {(
              [
                [t("task.created"), task.created_at],
                [t("task.started"), task.started_at],
                [t("task.finished"), task.finished_at],
              ] as const
            ).map(([label, at]) => (
              <div key={label} className="rounded-lg bg-paper/70 px-2.5 py-1.5">
                <dt className="text-ink/45">{label}</dt>
                <dd className="font-medium text-ink">{formatDate(at)}</dd>
              </div>
            ))}
          </dl>

          <Actions task={task} />
          {task.status === "failed" && <ErrorNote text={failure ?? t("stageError.fallback")} />}
          {active && <LiveRun run={active} />}

          <Section title={t("task.description")}>
            {task.description ? <p className="text-sm leading-relaxed whitespace-pre-wrap text-ink/85">{task.description}</p> : <Empty>{t("task.noDescription")}</Empty>}
          </Section>

          <Section title={t("task.result")} count={task.artifacts.length || undefined}>
            <ResultView artifacts={task.artifacts} />
          </Section>

          {research && (
            <Section
              title={research.activity.some((step) => step.kind === "jobs" || step.kind === "job") ? t("task.researchJobs") : t("task.research")}
              count={research.activity.length}
              action={
                <span className="font-mono text-[11px] text-ink/40">
                  {research.jobs ? `${jobCounts(t, research.jobs)} · ` : ""}v{research.attempt}
                </span>
              }
            >
              <WebSteps
                steps={research.activity.map((step) =>
                  step.status === "running" ? { ...step, status: "failed", detail: undefined, detail_code: "interrupted", detail_params: undefined } : step,
                )}
              />
            </Section>
          )}

          <Section title={t("task.comments")} count={task.comments.length}>
            {task.comments.map((c) => (
              <div key={c.id} className={`rounded-lg px-3 py-2 text-sm ${c.author === "director" ? "bg-ink/5" : "border border-line bg-white"}`}>
                <div className="mb-0.5 flex justify-between text-[11px] text-ink/45">
                  <span className="font-medium">{c.author === "director" ? t("task.director") : t("task.agent")}</span>
                  <span>{formatDate(c.created_at)}</span>
                </div>
                <p className="whitespace-pre-wrap text-ink/90">{c.body}</p>
              </div>
            ))}
            <CommentForm taskId={task.id} />
          </Section>

          <Section title={t("task.runs")} count={task.runs.length}>
            {task.runs.length ? (
              <div className="overflow-hidden rounded-lg border border-line">
                <table className="w-full text-xs">
                  <thead className="bg-paper/70 text-left text-ink/50">
                    <tr>
                      <th className="px-2.5 py-1.5 font-medium">{t("task.runStage")}</th>
                      <th className="px-2.5 py-1.5 font-medium">{t("task.runModel")}</th>
                      <th className="px-2.5 py-1.5 text-right font-medium">{t("task.runTokens")}</th>
                      <th className="px-2.5 py-1.5 font-medium">{t("task.runStatus")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {task.runs.map((r) => (
                      <tr key={r.id} className="border-t border-line">
                        <td className="px-2.5 py-1.5 whitespace-nowrap">
                          <span className="font-mono text-ink/45">v{r.attempt}</span> {stageName(t, r.stage)}
                        </td>
                        <td className="max-w-24 truncate px-2.5 py-1.5 font-mono" title={r.model ?? r.provider}>
                          {r.model ?? r.provider}
                        </td>
                        <td className="px-2.5 py-1.5 text-right font-mono">
                          {formatNumber(r.input_tokens)} / {formatNumber(r.output_tokens)}
                        </td>
                        <td className="px-2.5 py-1.5" title={runError(t, r) ?? undefined}>
                          {t(`runStatus.${r.status}` as Key)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-line bg-paper/50">
                      <td colSpan={2} className="px-2.5 py-1.5 text-ink/55">
                        {t("task.total")}
                      </td>
                      <td className="px-2.5 py-1.5 text-right font-mono font-medium">{formatNumber(tokens)}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            ) : (
              <Empty>{t("task.noRuns")}</Empty>
            )}
          </Section>
        </>
      )}
    </PanelShell>
  );
}
