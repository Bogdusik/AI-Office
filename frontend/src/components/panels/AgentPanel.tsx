"use client";

import { type FormEvent, useMemo, useState } from "react";
import { type Agent, type Task, api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { agentTag, stageName, taskTag } from "@/lib/labels";
import { useAction } from "@/lib/useAction";
import { useFetched } from "@/lib/useFetched";
import type { LocatedAgent } from "@/lib/world";
import { useTasksStore } from "@/store/useTasksStore";
import { useUiStore } from "@/store/useUiStore";
import { TaskRow } from "./TaskRow";
import { Button, ConfirmButton, Empty, ErrorNote, Field, PanelShell, Pill, Section, inputCls } from "./ui";

const FINISHED = new Set(["done", "failed", "cancelled"]);

function NewTaskForm({ agentId }: { agentId: number }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const t = useT();
  const { busy, error, run } = useAction();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const created = await run("create", () => api.createTask(agentId, title, description));
    if (created.ok) {
      setTitle("");
      setDescription("");
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 rounded-xl border border-line bg-paper/50 p-3" aria-label={t("agent.newTask")}>
      <input className={inputCls} placeholder={t("agent.taskTitle")} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} name="title" />
      <textarea
        className={`${inputCls} min-h-16 resize-y`}
        placeholder={t("agent.taskDescription")}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        name="description"
      />
      <ErrorNote text={error} />
      <div className="flex justify-end">
        <Button type="submit" variant="primary" busy={busy === "create"} disabled={!title.trim()}>
          {t("agent.enqueue")}
        </Button>
      </div>
    </form>
  );
}

function EditForm({ agent, onDone }: { agent: Agent; onDone: () => void }) {
  const [title, setTitle] = useState(agent.title);
  const [prompt, setPrompt] = useState(agent.system_prompt);
  const [model, setModel] = useState(agent.model ?? "");
  const [web, setWeb] = useState(agent.web_access);
  const [jobs, setJobs] = useState(agent.tools.includes("jobs"));
  const t = useT();
  const { busy, error, run } = useAction();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const saved = await run("save", () =>
      api.updateAgent(agent.id, { title, system_prompt: prompt, model: model.trim() || null, web_access: web, tools: jobs ? ["jobs"] : [] }),
    );
    if (saved.ok) onDone();
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-xl border border-line bg-paper/50 p-3" aria-label={t("agent.editForm")}>
      <Field label={t("agent.jobTitle")}>
        <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
      </Field>
      <Field label={t("agent.model")} hint={t("agent.modelHint")}>
        <input className={`${inputCls} font-mono`} value={model} onChange={(e) => setModel(e.target.value)} placeholder={t("agent.modelPlaceholder")} maxLength={200} />
      </Field>
      <Field label={t("agent.systemPrompt")}>
        <textarea className={`${inputCls} min-h-40 resize-y font-mono text-xs leading-relaxed`} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
      </Field>
      <label className="flex items-center gap-2 text-sm text-ink">
        <input type="checkbox" checked={web} onChange={(e) => setWeb(e.target.checked)} className="h-4 w-4 accent-[var(--color-accent)]" />
        {t("agent.webAccess")}
      </label>
      <label className="flex items-center gap-2 text-sm text-ink">
        <input type="checkbox" checked={jobs} onChange={(e) => setJobs(e.target.checked)} className="h-4 w-4 accent-[var(--color-accent)]" />
        {t("agent.jobTools")} <span className="text-xs text-ink/45">(Adzuna, Reed)</span>
      </label>
      <ErrorNote text={error} />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" variant="primary" busy={busy === "save"} disabled={!title.trim()}>
          {t("common.save")}
        </Button>
      </div>
    </form>
  );
}

export function AgentPanel({ located }: { located: LocatedAgent }) {
  const { agent: state, floor } = located;
  const t = useT();
  const select = useUiStore((s) => s.select);
  const openTask = useUiStore((s) => s.openTask);
  const following = useUiStore((s) => s.follow === state.id);
  const setFollow = useUiStore((s) => s.setFollow);
  const revision = useTasksStore((s) => s.revision);
  const allTasks = useTasksStore((s) => s.tasks);
  const details = useFetched((signal) => api.agent(state.id, signal), [state.id, revision]);
  const [editing, setEditing] = useState(false);
  const { busy, error, run } = useAction();

  const groups = useMemo(() => {
    const own = allTasks.filter((t) => t.agent_id === state.id);
    const currentId = state.current_task?.id;
    const byPosition = (a: Task, b: Task) => a.position - b.position;
    return {
      queue: own.filter((t) => t.id !== currentId && (t.status === "queued" || t.status === "in_progress" || t.status === "paused" || t.status === "changes_requested")).sort(byPosition),
      review: own.filter((t) => t.id !== currentId && t.status === "needs_review").sort(byPosition),
      finished: own.filter((t) => FINISHED.has(t.status)).sort((a, b) => (b.finished_at ?? "").localeCompare(a.finished_at ?? "")),
    };
  }, [allTasks, state.id, state.current_task?.id]);

  const agent = details.data;
  const status = agentTag(t, state);
  const current = state.current_task;

  const archive = async () => {
    const done = await run("archive", () => api.archiveAgent(state.id));
    if (done.ok) select(null);
  };
  const release = () => run("release", () => api.releaseAgent(state.id));
  const blocked = state.release_blocked;

  return (
    <PanelShell
      testId="agent-panel"
      eyebrow={t("agent.eyebrow", { floor: floor.number, floorName: floor.name, desk: state.desk_index + 1 })}
      title={state.title}
      subtitle={state.name}
      onClose={() => select(null)}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Pill label={status.label} color={status.color} />
        <span className="rounded-full border border-line px-2.5 py-0.5 font-mono text-[11px] text-ink/70" title={t("agent.model")}>
          {agent ? (agent.model ?? t("agent.defaultModel")) : "…"}
        </span>
        <span className="rounded-full border border-line px-2.5 py-0.5 text-[11px] text-ink/70">{state.web_access ? t("agent.webOn") : t("agent.webOff")}</span>
        {state.tools.includes("jobs") && <span className="rounded-full border border-line px-2.5 py-0.5 text-[11px] text-ink/70">{t("agent.jobSearch")}</span>}
      </div>

      {editing && agent ? (
        <EditForm agent={agent} onDone={() => setEditing(false)} />
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant={following ? "primary" : undefined} onClick={() => setFollow(following ? null : state.id)} aria-pressed={following}>
            {following ? t("agent.unfollow") : t("agent.follow")}
          </Button>
          <Button onClick={() => setEditing(true)} disabled={!agent}>
            {t("agent.edit")}
          </Button>
          <span title={blocked ? t(`releaseBlocked.${blocked}`) : undefined}>
            <Button onClick={release} disabled={blocked !== null} busy={busy === "release"} data-testid="release-agent">
              {t("agent.release")}
            </Button>
          </span>
          <ConfirmButton label={t("agent.archive")} question={t("agent.archiveQuestion")} onConfirm={archive} busy={busy === "archive"} />
        </div>
      )}
      {!editing && blocked && blocked !== "away" && (
        <p className="text-xs text-ink/55" data-testid="release-hint">
          {t("agent.releaseHint", { reason: t(`releaseBlocked.${blocked}`).toLowerCase() })}
        </p>
      )}
      {!editing && !blocked && state.leave_at && <p className="text-xs text-ink/55">{t("agent.leavingSoon")}</p>}
      <ErrorNote text={error} />

      <Section title={t("agent.currentTask")}>
        {current ? (
          <button
            type="button"
            onClick={() => openTask(current.id)}
            className="flex flex-col gap-1.5 rounded-xl border border-ink/15 bg-gradient-to-br from-white to-paper p-3 text-left transition hover:border-accent"
          >
            <span className="text-sm font-semibold text-ink">{current.title}</span>
            <span className="flex items-center gap-2">
              <Pill {...taskTag(t, current.status)} size="xs" />
              <span className="text-xs text-ink/55">{current.stage ? t("agent.stage", { stage: stageName(t, current.stage) }) : t("agent.stageNotStarted")}</span>
            </span>
          </button>
        ) : (
          <Empty>{t("agent.idleNow")}</Empty>
        )}
      </Section>

      <Section title={t("agent.newTask")}>
        <NewTaskForm agentId={state.id} />
      </Section>

      <Section title={t("agent.queue")} count={groups.queue.length}>
        {groups.queue.length ? groups.queue.map((x) => <TaskRow key={x.id} task={x} onOpen={() => openTask(x.id)} meta={x.status === "queued" ? t("agent.queuePosition", { position: x.position }) : undefined} />) : <Empty>{t("agent.queueEmpty")}</Empty>}
      </Section>

      <Section title={t("agent.review")} count={groups.review.length}>
        {groups.review.length ? groups.review.map((x) => <TaskRow key={x.id} task={x} onOpen={() => openTask(x.id)} />) : <Empty>{t("agent.reviewEmpty")}</Empty>}
      </Section>

      <Section title={t("agent.finished")} count={groups.finished.length}>
        {groups.finished.length ? groups.finished.map((x) => <TaskRow key={x.id} task={x} onOpen={() => openTask(x.id)} />) : <Empty>{t("agent.finishedEmpty")}</Empty>}
      </Section>
    </PanelShell>
  );
}
