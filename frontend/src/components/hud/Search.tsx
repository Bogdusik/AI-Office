"use client";

import { useMemo, useState } from "react";
import { card } from "@/components/panels/ui";
import { TASK_STATUS, agentTag } from "@/lib/labels";
import { allAgents, findAgent } from "@/lib/world";
import { useTasksStore } from "@/store/useTasksStore";
import { useUiStore } from "@/store/useUiStore";
import { useWorldStore } from "@/store/useWorldStore";

type Result =
  | { kind: "agent"; key: string; agentId: number; floor: number; title: string; sub: string; color: string }
  | { kind: "task"; key: string; agentId: number; floor: number; taskId: number; title: string; sub: string; color: string };

const norm = (s: string) => s.toLocaleLowerCase("ru").replace(/ё/g, "е");

export function Search() {
  const world = useWorldStore((s) => s.world);
  const tasks = useTasksStore((s) => s.tasks);
  const focusOn = useUiStore((s) => s.focusOn);
  const openTask = useUiStore((s) => s.openTask);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const results = useMemo<Result[]>(() => {
    const q = norm(query.trim());
    if (!q) return [];
    const agents: Result[] = allAgents(world)
      .filter(({ agent }) => [agent.name, agent.title, agent.role_key].some((v) => norm(v).includes(q)))
      .slice(0, 5)
      .map(({ agent, floor }) => ({
        kind: "agent",
        key: `a${agent.id}`,
        agentId: agent.id,
        floor: floor.number,
        title: `${agent.title} · ${agent.name}`,
        sub: `Этаж ${floor.number} · ${agentTag(agent).label}`,
        color: agentTag(agent).color,
      }));
    const found: Result[] = tasks
      .filter((t) => norm(t.title).includes(q))
      .flatMap((t) => {
        const located = findAgent(world, t.agent_id);
        if (!located) return [];
        return [
          {
            kind: "task" as const,
            key: `t${t.id}`,
            agentId: t.agent_id,
            floor: located.floor.number,
            taskId: t.id,
            title: t.title,
            sub: `${located.agent.title} · ${TASK_STATUS[t.status].label}`,
            color: TASK_STATUS[t.status].color,
          },
        ];
      })
      .slice(0, 6);
    return [...agents, ...found];
  }, [query, world, tasks]);

  const choose = (r: Result) => {
    focusOn({ kind: "agent", id: r.agentId }, r.floor);
    if (r.kind === "task") openTask(r.taskId);
    setQuery("");
    setOpen(false);
  };

  const showList = open && query.trim().length > 0;

  return (
    <div className="pointer-events-auto relative w-full max-w-[380px]">
      <div className={`${card} flex items-center gap-2 px-3.5`}>
        <svg viewBox="0 0 16 16" className="h-4 w-4 shrink-0 text-ink/40" fill="none" stroke="currentColor" strokeWidth="1.7">
          <circle cx="7" cy="7" r="4.5" />
          <path d="M10.5 10.5 14 14" strokeLinecap="round" />
        </svg>
        <input
          type="search"
          role="combobox"
          aria-expanded={showList}
          aria-controls="search-results"
          aria-label="Поиск по сотрудникам и задачам"
          placeholder="Поиск сотрудника или задачи"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (!results.length) return;
            if (e.key === "ArrowDown") setActive((i) => (i + 1) % results.length);
            else if (e.key === "ArrowUp") setActive((i) => (i - 1 + results.length) % results.length);
            else if (e.key === "Enter") choose(results[active]);
            else return;
            e.preventDefault();
          }}
          className="h-10 w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink/40"
        />
      </div>
      {showList && (
        <ul id="search-results" role="listbox" className={`${card} absolute inset-x-0 top-12 max-h-96 overflow-y-auto p-1.5`}>
          {results.length === 0 && <li className="px-3 py-2 text-sm text-ink/45">Ничего не найдено</li>}
          {results.map((r, i) => (
            <li key={r.key} role="option" aria-selected={i === active}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(r)}
                className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left ${i === active ? "bg-ink/5" : ""}`}
              >
                <span className="font-mono text-[9px] tracking-wider text-ink/35 uppercase">{r.kind === "agent" ? "сотр" : "задача"}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-ink">{r.title}</span>
                  <span className="flex items-center gap-1.5 text-[11px] text-ink/50">
                    <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: r.color }} />
                    {r.sub}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
