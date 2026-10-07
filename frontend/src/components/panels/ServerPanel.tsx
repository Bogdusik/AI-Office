"use client";

import { useEffect, useState } from "react";
import { type ModelUser, type ServerRoom, api } from "@/lib/api";
import { humanize } from "@/lib/errors";
import { TASK_STAGE } from "@/lib/labels";
import { useUiStore } from "@/store/useUiStore";
import { useWorldStore } from "@/store/useWorldStore";
import { Empty, ErrorNote, PanelShell, Section, formatDate, formatNumber } from "./ui";

const POLL_MS = 3000;

function Dot({ ok, label, detail }: { ok: boolean; label: string; detail?: string | null }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-line bg-white px-3 py-2 text-sm" data-ok={ok}>
      <span className={`h-2 w-2 shrink-0 rounded-full ${ok ? "bg-signal-ok shadow-[0_0_8px_var(--color-signal-ok)]" : "bg-signal-down"}`} />
      <span className="font-medium text-ink">{label}</span>
      <span className="ml-auto truncate text-xs text-ink/50">{detail ?? (ok ? "работает" : "недоступен")}</span>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-line bg-white px-3 py-2">
      <p className="text-[11px] text-ink/50">{label}</p>
      <p className="font-mono text-lg font-semibold text-ink tabular-nums">{value}</p>
      {sub && <p className="truncate text-[11px] text-ink/45">{sub}</p>}
    </div>
  );
}

function Users({ users, empty }: { users: ModelUser[]; empty: string }) {
  if (!users.length) return <Empty>{empty}</Empty>;
  return (
    <ul className="flex flex-col gap-1.5">
      {users.map((u) => (
        <li key={`${u.agent_id}-${u.since}`} className="rounded-lg border border-line bg-white px-3 py-2 text-sm">
          <div className="flex justify-between gap-2">
            <span className="truncate font-medium text-ink">
              {u.title} · {u.name}
            </span>
            <span className="shrink-0 text-xs text-ink/45">с {formatDate(u.since)}</span>
          </div>
          <div className="truncate text-xs text-ink/55">
            {TASK_STAGE[u.stage]} · {u.task_title}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** The server room: model server, GPU, web search, who uses the model and token usage (real model only). */
export function ServerPanel() {
  const select = useUiStore((s) => s.select);
  const lastUpdated = useWorldStore((s) => s.lastUpdated);
  const [room, setRoom] = useState<ServerRoom | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const next = await api.serverRoom();
        if (active) {
          setRoom(next);
          setError(null);
        }
      } catch (err) {
        if (active) setError(err);
      }
    };
    void load();
    const id = setInterval(load, POLL_MS);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [lastUpdated]);

  const gpu = room?.gpu;
  const model = room?.ollama.models[0];

  return (
    <PanelShell testId="server-panel" eyebrow="Серверная · Engineering" title="Модель и сеть" subtitle={room ? `Исполнитель: ${room.worker === "llm" ? "локальная модель" : "фальшивый"}` : undefined} onClose={() => select(null)}>
      {error && !room ? <ErrorNote text={humanize(error)} /> : null}
      {room && (
        <>
          <Section title="Сервисы">
            <div className="flex flex-col gap-1.5">
              <Dot ok={room.ollama.up} label="Ollama" detail={room.ollama.up ? `версия ${room.ollama.version ?? "?"}` : `не отвечает · ${room.ollama.url}`} />
              <Dot ok={room.searxng_up} label="Поиск (SearXNG)" detail={room.searxng_up ? room.searxng_url : `не отвечает · ${room.searxng_url}`} />
            </div>
          </Section>

          <Section title="Модель">
            <div className="grid grid-cols-2 gap-2" data-testid="server-model">
              <Stat label="Загружена" value={model ? model.name : "—"} sub={model ? `контекст ${formatNumber(model.context_length ?? 0)}` : `по умолчанию ${room.default_model}`} />
              <Stat label="Модель в видеопамяти" value={model ? `${model.vram_gb} ГБ` : "—"} sub={model ? `из ${model.size_gb} ГБ` : "не загружена"} />
              <Stat
                label="Видеокарта"
                value={gpu ? `${(gpu.used_mb / 1024).toFixed(1)} / ${(gpu.total_mb / 1024).toFixed(0)} ГБ` : "—"}
                sub={gpu ? `${gpu.name.replace("NVIDIA GeForce ", "")} · загрузка ${gpu.utilization}%` : "nvidia-smi недоступен"}
              />
              <Stat
                label="Скорость последнего запроса"
                value={room.last_speed ? `${room.last_speed.tokens_per_second} ток/с` : "—"}
                sub={room.last_speed ? `${room.last_speed.agent_title} · ${formatDate(room.last_speed.finished_at)}` : "запросов ещё не было"}
              />
            </div>
          </Section>

          <Section title="Работает с моделью" count={room.running.length}>
            <Users users={room.running} empty="Модель свободна." />
          </Section>
          <Section title="Очередь к модели" count={room.queue.length}>
            <Users users={room.queue} empty="Очереди нет." />
          </Section>

          <Section title="Токены" action={<span className="text-[11px] text-ink/40">без запусков fake</span>}>
            <div className="grid grid-cols-2 gap-2" data-testid="server-tokens">
              <Stat label="Сегодня (вход / выход)" value={`${formatNumber(room.totals.today_in)} / ${formatNumber(room.totals.today_out)}`} />
              <Stat label="Всего (вход / выход)" value={`${formatNumber(room.totals.total_in)} / ${formatNumber(room.totals.total_out)}`} />
            </div>
            {room.tokens.length ? (
              <div className="overflow-hidden rounded-lg border border-line">
                <table className="w-full text-xs">
                  <thead className="bg-paper/70 text-left text-ink/50">
                    <tr>
                      <th className="px-2.5 py-1.5 font-medium">Сотрудник</th>
                      <th className="px-2.5 py-1.5 text-right font-medium">Сегодня</th>
                      <th className="px-2.5 py-1.5 text-right font-medium">Всего</th>
                    </tr>
                  </thead>
                  <tbody>
                    {room.tokens.map((r) => (
                      <tr key={r.agent_id} className="border-t border-line">
                        <td className="max-w-40 truncate px-2.5 py-1.5" title={`${r.title} · ${r.name}`}>
                          {r.title}
                        </td>
                        <td className="px-2.5 py-1.5 text-right font-mono">{formatNumber(r.today_in + r.today_out)}</td>
                        <td className="px-2.5 py-1.5 text-right font-mono">{formatNumber(r.total_in + r.total_out)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty>Настоящая модель ещё не тратила токены.</Empty>
            )}
          </Section>
        </>
      )}
    </PanelShell>
  );
}
