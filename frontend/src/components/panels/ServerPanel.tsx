"use client";

import { useEffect, useState } from "react";
import { type ModelUser, type ServerRoom, api } from "@/lib/api";
import { humanize } from "@/lib/errors";
import { useFormat, useT } from "@/lib/i18n";
import { stageName } from "@/lib/labels";
import { useUiStore } from "@/store/useUiStore";
import { useWorldStore } from "@/store/useWorldStore";
import { Empty, ErrorNote, PanelShell, Section, formatDate, formatNumber } from "./ui";

const POLL_MS = 3000;

function Dot({ ok, label, detail }: { ok: boolean; label: string; detail?: string | null }) {
  const t = useT();
  return (
    <div className="flex items-center gap-2 rounded-lg border border-line bg-white px-3 py-2 text-sm" data-ok={ok}>
      <span className={`h-2 w-2 shrink-0 rounded-full ${ok ? "bg-signal-ok shadow-[0_0_8px_var(--color-signal-ok)]" : "bg-signal-down"}`} />
      <span className="font-medium text-ink">{label}</span>
      <span className="ml-auto truncate text-xs text-ink/50">{detail ?? (ok ? t("server.up") : t("server.down"))}</span>
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
  const t = useT();
  if (!users.length) return <Empty>{empty}</Empty>;
  return (
    <ul className="flex flex-col gap-1.5">
      {users.map((u) => (
        <li key={`${u.agent_id}-${u.since}`} className="rounded-lg border border-line bg-white px-3 py-2 text-sm">
          <div className="flex justify-between gap-2">
            <span className="truncate font-medium text-ink">
              {u.title} · {u.name}
            </span>
            <span className="shrink-0 text-xs text-ink/45">{t("server.since", { date: formatDate(u.since) })}</span>
          </div>
          <div className="truncate text-xs text-ink/55">
            {stageName(t, u.stage)} · {u.task_title}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** The server room: model server, GPU, web search, who uses the model and token usage (real model only). */
export function ServerPanel() {
  const t = useT();
  const fmt = useFormat();
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
    <PanelShell
      testId="server-panel"
      eyebrow={t("server.eyebrow")}
      title={t("server.title")}
      subtitle={room ? t("server.worker", { worker: room.worker === "llm" ? t("server.workerLlm") : t("server.workerFake") }) : undefined}
      onClose={() => select(null)}
    >
      {error && !room ? <ErrorNote text={humanize(t, error)} /> : null}
      {room && (
        <>
          <Section title={t("server.services")}>
            <div className="flex flex-col gap-1.5">
              <Dot
                ok={room.ollama.up}
                label="Ollama"
                detail={room.ollama.up ? t("server.ollamaVersion", { version: room.ollama.version ?? "?" }) : t("server.notAnswering", { url: room.ollama.url })}
              />
              <Dot ok={room.searxng_up} label={t("server.search")} detail={room.searxng_up ? room.searxng_url : t("server.notAnswering", { url: room.searxng_url })} />
            </div>
          </Section>

          <Section title={t("server.jobSources")}>
            <div className="flex flex-col gap-1.5" data-testid="job-sources">
              {room.job_sources.map((s) => {
                const failedLast = s.last_error_at !== null && (s.last_ok_at === null || s.last_error_at > s.last_ok_at);
                const detail = !s.configured
                  ? t("server.noKeys")
                  : failedLast
                    ? `${s.last_error} · ${formatDate(s.last_error_at)}`
                    : s.last_ok_at
                      ? t("server.keysLastRequest", { date: formatDate(s.last_ok_at) })
                      : t("server.keysNoRequests");
                return <Dot key={s.name} ok={s.configured && !failedLast} label={s.label} detail={detail} />;
              })}
            </div>
          </Section>

          <Section title={t("server.model")}>
            <div className="grid grid-cols-2 gap-2" data-testid="server-model">
              <Stat
                label={t("server.loaded")}
                value={model ? model.name : "—"}
                sub={model ? t("server.context", { size: model.context_length ?? 0 }) : t("server.defaultModel", { model: room.default_model })}
              />
              <Stat
                label={t("server.vram")}
                value={model ? t("server.gb", { value: fmt.decimal(model.vram_gb, 1) }) : "—"}
                sub={model ? t("server.ofGb", { value: fmt.decimal(model.size_gb, 1) }) : t("server.notLoaded")}
              />
              <Stat
                label={t("server.gpu")}
                value={gpu ? t("server.gpuUsage", { used: fmt.decimal(gpu.used_mb / 1024, 1), total: fmt.decimal(gpu.total_mb / 1024, 0) }) : "—"}
                sub={gpu ? t("server.gpuLoad", { name: gpu.name.replace("NVIDIA GeForce ", ""), load: gpu.utilization }) : t("server.noSmi")}
              />
              <Stat
                label={t("server.speed")}
                value={room.last_speed ? t("server.tokensPerSecond", { value: fmt.decimal(room.last_speed.tokens_per_second, 1) }) : "—"}
                sub={room.last_speed ? `${room.last_speed.agent_title} · ${formatDate(room.last_speed.finished_at)}` : t("server.noRequests")}
              />
            </div>
          </Section>

          <Section title={t("server.running")} count={room.running.length}>
            <Users users={room.running} empty={t("server.modelFree")} />
          </Section>
          <Section title={t("server.queue")} count={room.queue.length}>
            <Users users={room.queue} empty={t("server.noQueue")} />
          </Section>

          <Section title={t("server.tokens")} action={<span className="text-[11px] text-ink/40">{t("server.noFake")}</span>}>
            <div className="grid grid-cols-2 gap-2" data-testid="server-tokens">
              <Stat label={t("server.today")} value={`${formatNumber(room.totals.today_in)} / ${formatNumber(room.totals.today_out)}`} />
              <Stat label={t("server.allTime")} value={`${formatNumber(room.totals.total_in)} / ${formatNumber(room.totals.total_out)}`} />
            </div>
            {room.tokens.length ? (
              <div className="overflow-hidden rounded-lg border border-line">
                <table className="w-full text-xs">
                  <thead className="bg-paper/70 text-left text-ink/50">
                    <tr>
                      <th className="px-2.5 py-1.5 font-medium">{t("server.agent")}</th>
                      <th className="px-2.5 py-1.5 text-right font-medium">{t("server.todayShort")}</th>
                      <th className="px-2.5 py-1.5 text-right font-medium">{t("server.totalShort")}</th>
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
              <Empty>{t("server.noTokens")}</Empty>
            )}
          </Section>
        </>
      )}
    </PanelShell>
  );
}
