"use client";

import { type FormEvent, useMemo, useState } from "react";
import { type FloorState, type Profile, type ProfileUpdate, api } from "@/lib/api";
import { humanize } from "@/lib/errors";
import { AGENT_STATUS, TASK_STAGE, TASK_STATUS } from "@/lib/labels";
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

function Team() {
  const world = useWorldStore((s) => s.world);
  const go = useGoToAgent();
  const rows = allAgents(world);
  if (!rows.length) return <Empty>В офисе пока никого нет.</Empty>;
  const th = "px-4 py-2.5 font-medium";
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-white">
      <table className="w-full text-sm" data-testid="team-table">
        <thead className="bg-paper/70 text-left text-xs text-ink/50">
          <tr>
            <th className={th}>Сотрудник</th>
            <th className={th}>Этаж</th>
            <th className={th}>Статус</th>
            <th className={th}>Текущая задача</th>
            <th className={th}>Этап</th>
            <th className={`${th} text-right`}>Очередь</th>
            <th className={`${th} text-right`}>Ждёт проверки</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ agent, floor }) => {
            const s = AGENT_STATUS[agent.status];
            const t = agent.current_task;
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
                  {t ? (
                    <div className="flex flex-col gap-0.5">
                      <span className="truncate text-ink">{t.title}</span>
                      <span className="text-xs" style={{ color: TASK_STATUS[t.status].color }}>
                        {TASK_STATUS[t.status].label}
                      </span>
                    </div>
                  ) : (
                    <span className="text-ink/35">—</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-ink/70">{t?.stage ? TASK_STAGE[t.stage] : "—"}</td>
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
  const world = useWorldStore((s) => s.world);
  const tasks = useTasksStore((s) => s.tasks);
  const go = useGoToAgent();
  const waiting = tasks.filter((t) => t.status === "needs_review").flatMap((t) => {
    const located = findAgent(world, t.agent_id);
    return located ? [{ task: t, ...located }] : [];
  });
  if (!waiting.length) return <Empty>Ничего не ждёт вашей проверки.</Empty>;
  return (
    <ul className="flex flex-col gap-2" data-testid="review-list">
      {waiting.map(({ task, agent, floor }) => (
        <li key={task.id}>
          <button
            type="button"
            onClick={() => go(agent.id, floor.number, task.id)}
            className="flex w-full items-center gap-4 rounded-xl border border-line bg-white px-4 py-3 text-left transition hover:border-accent"
          >
            <span className="h-9 w-1 rounded-full" style={{ backgroundColor: TASK_STATUS.needs_review.color }} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium text-ink">{task.title}</span>
              <span className="text-xs text-ink/50">
                {agent.title} · {agent.name} · этаж {floor.number}
              </span>
            </span>
            <span className="text-xs text-ink/45">{formatDate(task.created_at)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

const PROFILE_FIELDS: { key: keyof ProfileUpdate; label: string; hint: string; rows: number }[] = [
  { key: "summary", label: "Кто я", hint: "Опыт, навыки, контекст — сотрудники учитывают это в каждой задаче", rows: 4 },
  { key: "goal", label: "Цель", hint: "Чего вы добиваетесь сейчас", rows: 3 },
  { key: "constraints", label: "Ограничения", hint: "Чего делать нельзя, сроки, рамки", rows: 3 },
  { key: "notes", label: "Заметки", hint: "Всё остальное", rows: 4 },
];

function ProfileForm({ initial }: { initial: Profile }) {
  const [form, setForm] = useState<ProfileUpdate>(initial);
  const [base, setBase] = useState<Profile>(initial);
  const { busy, error, run } = useAction();
  const dirty = form.name !== base.name || PROFILE_FIELDS.some((f) => form[f.key] !== base[f.key]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const r = await run("save", () => api.saveProfile(form));
    if (r.ok) setBase(r.value);
  };

  return (
    <form onSubmit={submit} className="flex max-w-3xl flex-col gap-4" aria-label="Профиль директора">
      <Field label="Имя">
        <input className={inputCls} name="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={200} />
      </Field>
      {PROFILE_FIELDS.map((f) => (
        <Field key={f.key} label={f.label} hint={f.hint}>
          <textarea className={`${inputCls} resize-y`} name={f.key} rows={f.rows} value={form[f.key]} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
        </Field>
      ))}
      <ErrorNote text={error} />
      <div className="flex items-center justify-end gap-3">
        <span className="text-xs text-ink/45" data-testid="profile-saved">
          {dirty ? "Есть несохранённые изменения" : `Сохранено ${formatDate(base.updated_at)}`}
        </span>
        <Button type="submit" variant="primary" busy={busy === "save"} disabled={!dirty}>
          Сохранить профиль
        </Button>
      </div>
    </form>
  );
}

function ProfileTab() {
  const { data, error } = useFetched((signal) => api.profile(signal), []);
  if (error) return <ErrorNote text={humanize(error)} />;
  if (!data) return <p className="text-sm text-ink/50">Загрузка…</p>;
  return <ProfileForm initial={data} />;
}

function FloorRow({ floor }: { floor: FloorState }) {
  const { busy, error, run } = useAction();
  const deletable = floor.kind === "office" && floor.agents.length === 0 && !floor.has_director_office;
  const why = floor.kind === "reception" ? "Ресепшен" : floor.has_director_office ? "Кабинет директора" : floor.agents.length ? "Есть сотрудники" : null;
  return (
    <li className="flex flex-col gap-2 rounded-xl border border-line bg-white px-4 py-3" data-floor={floor.number}>
      <div className="flex items-center gap-4">
        <span className="grid h-9 w-9 place-items-center rounded-lg bg-ink font-mono text-sm font-semibold text-paper">{floor.number}</span>
        <div className="min-w-0 flex-1">
          <div className="font-medium text-ink">{floor.name}</div>
          <div className="text-xs text-ink/50">
            {floor.kind === "reception" ? "Ресепшен, без рабочих мест" : `Мест: ${floor.capacity} · занято: ${floor.agents.length}`}
          </div>
        </div>
        {deletable ? (
          <ConfirmButton label="Удалить" question={`Удалить этаж ${floor.number}?`} busy={busy === "delete"} onConfirm={() => run("delete", () => api.deleteFloor(floor.id))} />
        ) : (
          <span className="text-xs text-ink/35">{why}</span>
        )}
      </div>
      <ErrorNote text={error} />
    </li>
  );
}

function Floors() {
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
      <form onSubmit={submit} className="flex h-fit flex-col gap-3 rounded-xl border border-line bg-white p-4" aria-label="Добавить этаж">
        <h3 className="text-sm font-semibold text-ink">Новый этаж № {next}</h3>
        <Field label="Название">
          <input className={inputCls} name="floor-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} placeholder="Например, Research" />
        </Field>
        <Field label="Вместимость" hint={`Рабочих мест, от 1 до ${MAX_CAPACITY}`}>
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
          Добавить этаж
        </Button>
      </form>
    </div>
  );
}

const TABS: { id: Tab; label: string }[] = [
  { id: "team", label: "Команда" },
  { id: "review", label: "Ждут моей проверки" },
  { id: "profile", label: "Профиль" },
  { id: "floors", label: "Этажи" },
];

export function DirectorPanel() {
  const open = useUiStore((s) => s.directorOpen);
  return open ? <DirectorView /> : null;
}

function DirectorView() {
  const back = useUiStore((s) => s.back);
  const world = useWorldStore((s) => s.world);
  const reviewCount = useTasksStore((s) => s.tasks.filter((t) => t.status === "needs_review" && findAgent(world, t.agent_id)).length);
  const [tab, setTab] = useState<Tab>("team");
  const agents = allAgents(world);

  return (
    <div className="absolute inset-0 z-30 bg-ink/15 p-4 backdrop-blur-[2px]" onClick={back}>
      <section
        data-testid="director-panel"
        className={`${card} flex h-full flex-col overflow-hidden bg-paper/97`}
        onClick={(e) => e.stopPropagation()}
        aria-label="Кабинет директора"
      >
        <header className="flex items-center gap-6 border-b border-line px-6 py-4">
          <div>
            <Eyebrow>Кабинет директора</Eyebrow>
            <h2 className="mt-0.5 text-xl font-semibold tracking-tight text-ink">Управление офисом</h2>
          </div>
          <nav className="flex gap-1 rounded-full border border-line bg-white p-1" role="tablist">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium transition ${tab === t.id ? "bg-ink text-paper" : "text-ink/65 hover:bg-ink/5"}`}
              >
                {t.label}
                {t.id === "review" && reviewCount > 0 && <span className="rounded-full bg-[#8b6cf0] px-1.5 font-mono text-[10px] text-white">{reviewCount}</span>}
                {t.id === "team" && <span className="font-mono text-[11px] opacity-50">{agents.length}</span>}
              </button>
            ))}
          </nav>
          <div className="flex-1" />
          <CloseButton onClick={back} />
        </header>
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {tab === "team" && <Team />}
          {tab === "review" && <Review />}
          {tab === "profile" && <ProfileTab />}
          {tab === "floors" && <Floors />}
        </div>
      </section>
    </div>
  );
}
