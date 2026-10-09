"use client";

import { type FormEvent, useMemo, useState } from "react";
import { type FloorState, type Profile, type ProfileUpdate, api } from "@/lib/api";
import { humanize } from "@/lib/errors";
import { type Key, useT } from "@/lib/i18n";
import { TASK_STATUS_COLOR, agentTag, stageName, taskTag } from "@/lib/labels";
import { useAction } from "@/lib/useAction";
import { useFetched } from "@/lib/useFetched";
import { allAgents, findAgent } from "@/lib/world";
import { useTasksStore } from "@/store/useTasksStore";
import { useUiStore } from "@/store/useUiStore";
import { useWorldStore } from "@/store/useWorldStore";
import { Button, CloseButton, ConfirmButton, Empty, ErrorNote, Eyebrow, Field, Pill, card, formatDate, inputCls } from "./ui";

type Tab = "team" | "review" | "profile" | "floors";

const MAX_CAPACITY = 10;

function useGoToAgent() {
  const setDirectorOpen = useUiStore((s) => s.setDirectorOpen);
  const focusOn = useUiStore((s) => s.focusOn);
  const openTask = useUiStore((s) => s.openTask);
  return (agentId: number, floorNumber: number, taskId?: number) => {
    setDirectorOpen(false);
    focusOn({ kind: "agent", id: agentId }, floorNumber);
    if (taskId !== undefined) openTask(taskId);
  };
}

/** «Release all»: everyone in the office with nothing to work on goes home, one after another. */
function ReleaseAll({ agents }: { agents: ReturnType<typeof allAgents> }) {
  const t = useT();
  const { busy, error, run } = useAction();
  const free = agents.filter(({ agent }) => agent.release_blocked === null && !agent.leave_at).length;
  const busyOnes = agents.filter(({ agent }) => agent.release_blocked === "tasks").length;
  const hint = free
    ? busyOnes
      ? t("director.willLeaveBusy", { count: free, busy: busyOnes })
      : t("director.willLeave", { count: free })
    : busyOnes
      ? t("director.nobodyBusy")
      : t("director.nobodyHere");
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span title={free ? undefined : hint}>
        <Button onClick={() => run("release-all", () => api.releaseAll())} disabled={!free} busy={busy === "release-all"} data-testid="release-all">
          {free ? t("director.releaseAllCount", { count: free }) : t("director.releaseAll")}
        </Button>
      </span>
      <span className="text-xs text-ink/55" data-testid="release-all-hint">
        {hint}
      </span>
      <ErrorNote text={error} />
    </div>
  );
}

function Team() {
  const t = useT();
  const world = useWorldStore((s) => s.world);
  const go = useGoToAgent();
  const rows = allAgents(world);
  if (!rows.length) return <Empty>{t("director.nobodyYet")}</Empty>;
  const th = "px-4 py-2.5 font-medium";
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-white">
      <table className="w-full text-sm" data-testid="team-table">
        <thead className="bg-paper/70 text-left text-xs text-ink/50">
          <tr>
            <th className={th}>{t("director.colAgent")}</th>
            <th className={th}>{t("director.colFloor")}</th>
            <th className={th}>{t("director.colStatus")}</th>
            <th className={th}>{t("director.colTask")}</th>
            <th className={th}>{t("director.colStage")}</th>
            <th className={`${th} text-right`}>{t("director.colQueue")}</th>
            <th className={`${th} text-right`}>{t("director.colReview")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ agent, floor }) => {
            const s = agentTag(t, agent);
            const task = agent.current_task;
            const ts = task ? taskTag(t, task.status) : null;
            return (
              <tr key={agent.id} onClick={() => go(agent.id, floor.number)} className="cursor-pointer border-t border-line transition hover:bg-accent/5">
                <td className="px-4 py-2.5">
                  <div className="font-medium text-ink">{agent.title}</div>
                  <div className="text-xs text-ink/50">{agent.name}</div>
                </td>
                <td className="px-4 py-2.5 text-ink/70">
                  {floor.number} · {floor.name}
                </td>
                <td className="px-4 py-2.5">
                  <Pill label={s.label} color={s.color} size="xs" />
                </td>
                <td className="max-w-72 px-4 py-2.5">
                  {task && ts ? (
                    <div className="flex flex-col gap-0.5">
                      <span className="truncate text-ink">{task.title}</span>
                      <span className="text-xs" style={{ color: ts.color }}>
                        {ts.label}
                      </span>
                    </div>
                  ) : (
                    <span className="text-ink/35">—</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-ink/70">{task?.stage ? stageName(t, task.stage) : "—"}</td>
                <td className="px-4 py-2.5 text-right font-mono">{agent.queue_length}</td>
                <td className={`px-4 py-2.5 text-right font-mono ${agent.awaiting_review ? "font-semibold text-[#6b4fd6]" : ""}`}>{agent.awaiting_review}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Review() {
  const t = useT();
  const world = useWorldStore((s) => s.world);
  const tasks = useTasksStore((s) => s.tasks);
  const go = useGoToAgent();
  const waiting = tasks.filter((task) => task.status === "needs_review").flatMap((task) => {
    const located = findAgent(world, task.agent_id);
    return located ? [{ task, ...located }] : [];
  });
  if (!waiting.length) return <Empty>{t("director.nothingToReview")}</Empty>;
  return (
    <ul className="flex flex-col gap-2" data-testid="review-list">
      {waiting.map(({ task, agent, floor }) => (
        <li key={task.id}>
          <button
            type="button"
            onClick={() => go(agent.id, floor.number, task.id)}
            className="flex w-full items-center gap-4 rounded-xl border border-line bg-white px-4 py-3 text-left transition hover:border-accent"
          >
            <span className="h-9 w-1 rounded-full" style={{ backgroundColor: TASK_STATUS_COLOR.needs_review }} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium text-ink">{task.title}</span>
              <span className="text-xs text-ink/50">{t("director.reviewFloor", { title: agent.title, name: agent.name, floor: floor.number })}</span>
            </span>
            <span className="text-xs text-ink/45">{formatDate(task.created_at)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

const PROFILE_FIELDS: { key: keyof ProfileUpdate; label: Key; hint: Key; rows: number }[] = [
  { key: "summary", label: "director.summary", hint: "director.summaryHint", rows: 4 },
  { key: "goal", label: "director.goal", hint: "director.goalHint", rows: 3 },
  { key: "constraints", label: "director.constraints", hint: "director.constraintsHint", rows: 3 },
  { key: "notes", label: "director.notes", hint: "director.notesHint", rows: 4 },
];

function ProfileForm({ initial }: { initial: Profile }) {
  const t = useT();
  const [form, setForm] = useState<ProfileUpdate>(() => {
    const { name, summary, goal, constraints, notes } = initial;
    return { name, summary, goal, constraints, notes };
  });
  const [base, setBase] = useState<Profile>(initial);
  const { busy, error, run } = useAction();
  const dirty = form.name !== base.name || PROFILE_FIELDS.some((f) => form[f.key] !== base[f.key]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const r = await run("save", () => api.saveProfile(form));
    if (r.ok) setBase(r.value);
  };

  return (
    <form onSubmit={submit} className="flex max-w-3xl flex-col gap-4" aria-label={t("director.profileForm")}>
      <Field label={t("director.name")}>
        <input className={inputCls} name="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={200} />
      </Field>
      {PROFILE_FIELDS.map((f) => (
        <Field key={f.key} label={t(f.label)} hint={t(f.hint)}>
          <textarea className={`${inputCls} resize-y`} name={f.key} rows={f.rows} value={form[f.key]} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
        </Field>
      ))}
      <ErrorNote text={error} />
      <div className="flex items-center justify-end gap-3">
        <span className="text-xs text-ink/45" data-testid="profile-saved">
          {dirty ? t("director.unsaved") : t("director.saved", { date: formatDate(base.updated_at) })}
        </span>
        <Button type="submit" variant="primary" busy={busy === "save"} disabled={!dirty}>
          {t("director.saveProfile")}
        </Button>
      </div>
    </form>
  );
}

function ProfileTab() {
  const t = useT();
  const { data, error } = useFetched((signal) => api.profile(signal), []);
  if (error) return <ErrorNote text={humanize(t, error)} />;
  if (!data) return <p className="text-sm text-ink/50">{t("common.loading")}</p>;
  return <ProfileForm initial={data} />;
}

function FloorRow({ floor }: { floor: FloorState }) {
  const t = useT();
  const { busy, error, run } = useAction();
  const deletable = floor.kind === "office" && floor.agents.length === 0 && !floor.has_director_office;
  const why =
    floor.kind === "reception" ? t("director.reception") : floor.has_director_office ? t("director.directorOffice") : floor.agents.length ? t("director.hasAgents") : null;
  return (
    <li className="flex flex-col gap-2 rounded-xl border border-line bg-white px-4 py-3" data-floor={floor.number}>
      <div className="flex items-center gap-4">
        <span className="grid h-9 w-9 place-items-center rounded-lg bg-ink font-mono text-sm font-semibold text-paper">{floor.number}</span>
        <div className="min-w-0 flex-1">
          <div className="font-medium text-ink">{floor.name}</div>
          <div className="text-xs text-ink/50">
            {floor.kind === "reception" ? t("director.receptionNoDesks") : t("director.desks", { capacity: floor.capacity, taken: floor.agents.length })}
          </div>
        </div>
        {deletable ? (
          <ConfirmButton
            label={t("director.delete")}
            question={t("director.deleteQuestion", { number: floor.number })}
            busy={busy === "delete"}
            onConfirm={() => run("delete", () => api.deleteFloor(floor.id))}
          />
        ) : (
          <span className="text-xs text-ink/35">{why}</span>
        )}
      </div>
      <ErrorNote text={error} />
    </li>
  );
}

function Floors() {
  const t = useT();
  const floors = useWorldStore((s) => s.world?.floors ?? []);
  const [name, setName] = useState("");
  const [capacity, setCapacity] = useState(5);
  const { busy, error, run } = useAction();
  const next = useMemo(() => Math.max(0, ...floors.map((f) => f.number)) + 1, [floors]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const r = await run("add", () => api.createFloor(next, name.trim(), capacity));
    if (r.ok) setName("");
  };

  return (
    <div className="grid max-w-5xl grid-cols-[1fr_320px] gap-6">
      <ul className="flex flex-col gap-2" data-testid="floor-list">
        {[...floors].reverse().map((f) => (
          <FloorRow key={f.id} floor={f} />
        ))}
      </ul>
      <form onSubmit={submit} className="flex h-fit flex-col gap-3 rounded-xl border border-line bg-white p-4" aria-label={t("director.addFloorForm")}>
        <h3 className="text-sm font-semibold text-ink">{t("director.newFloor", { number: next })}</h3>
        <Field label={t("director.floorName")}>
          <input className={inputCls} name="floor-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} placeholder={t("director.floorNamePlaceholder")} />
        </Field>
        <Field label={t("director.capacity")} hint={t("director.capacityHint", { max: MAX_CAPACITY })}>
          <input
            className={`${inputCls} font-mono`}
            name="capacity"
            type="number"
            min={1}
            max={MAX_CAPACITY}
            value={capacity}
            onChange={(e) => setCapacity(Math.min(MAX_CAPACITY, Math.max(1, Number(e.target.value) || 1)))}
          />
        </Field>
        <ErrorNote text={error} />
        <Button type="submit" variant="primary" busy={busy === "add"} disabled={!name.trim()}>
          {t("director.addFloor")}
        </Button>
      </form>
    </div>
  );
}

const TABS: { id: Tab; label: Key }[] = [
  { id: "team", label: "director.team" },
  { id: "review", label: "director.review" },
  { id: "profile", label: "director.profile" },
  { id: "floors", label: "director.floors" },
];

export function DirectorPanel() {
  const open = useUiStore((s) => s.directorOpen);
  return open ? <DirectorView /> : null;
}

function DirectorView() {
  const t = useT();
  const back = useUiStore((s) => s.back);
  const world = useWorldStore((s) => s.world);
  const reviewCount = useTasksStore((s) => s.tasks.filter((task) => task.status === "needs_review" && findAgent(world, task.agent_id)).length);
  const [tab, setTab] = useState<Tab>("team");
  const agents = allAgents(world);

  return (
    <div className="absolute inset-0 z-30 bg-ink/15 p-4 backdrop-blur-[2px]" onClick={back}>
      <section
        data-testid="director-panel"
        className={`${card} flex h-full flex-col overflow-hidden bg-paper/97`}
        onClick={(e) => e.stopPropagation()}
        aria-label={t("director.eyebrow")}
      >
        <header className="flex items-center gap-6 border-b border-line px-6 py-4">
          <div>
            <Eyebrow>{t("director.eyebrow")}</Eyebrow>
            <h2 className="mt-0.5 text-xl font-semibold tracking-tight text-ink">{t("director.title")}</h2>
          </div>
          <nav className="flex gap-1 rounded-full border border-line bg-white p-1" role="tablist">
            {TABS.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={tab === item.id}
                onClick={() => setTab(item.id)}
                className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium transition ${tab === item.id ? "bg-ink text-paper" : "text-ink/65 hover:bg-ink/5"}`}
              >
                {t(item.label)}
                {item.id === "review" && reviewCount > 0 && <span className="rounded-full bg-[#8b6cf0] px-1.5 font-mono text-[10px] text-white">{reviewCount}</span>}
                {item.id === "team" && <span className="font-mono text-[11px] opacity-50">{agents.length}</span>}
              </button>
            ))}
          </nav>
          <div className="flex-1" />
          <CloseButton onClick={back} />
        </header>
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {tab === "team" && (
            <div className="flex flex-col gap-3">
              {agents.length > 0 && <ReleaseAll agents={agents} />}
              <Team />
            </div>
          )}
          {tab === "review" && <Review />}
          {tab === "profile" && <ProfileTab />}
          {tab === "floors" && <Floors />}
        </div>
      </section>
    </div>
  );
}
