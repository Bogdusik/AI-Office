"use client";

import { useEffect } from "react";
import { card } from "@/components/panels/ui";
import { useT } from "@/lib/i18n";
import { TASK_STATUS_COLOR } from "@/lib/labels";
import { findAgent } from "@/lib/world";
import { type Notice, useNotifyStore } from "@/store/useNotifyStore";
import { useUiStore } from "@/store/useUiStore";
import { useWorldStore } from "@/store/useWorldStore";

const LIFETIME_MS = 10_000;

function NoticeCard({ notice }: { notice: Notice }) {
  const t = useT();
  const dismiss = useNotifyStore((s) => s.dismiss);
  const focusOn = useUiStore((s) => s.focusOn);
  const openTask = useUiStore((s) => s.openTask);
  const world = useWorldStore((s) => s.world);
  const located = findAgent(world, notice.agentId);

  useEffect(() => {
    const timer = setTimeout(() => dismiss(notice.id), LIFETIME_MS);
    return () => clearTimeout(timer);
  }, [notice.id, dismiss]);

  const open = () => {
    if (located) focusOn({ kind: "agent", id: notice.agentId }, located.floor.number);
    openTask(notice.taskId);
    dismiss(notice.id);
  };

  return (
    <div role="status" data-testid="notice" className={`${card} pointer-events-auto flex w-[320px] items-stretch overflow-hidden`}>
      <span className="w-1 shrink-0" style={{ backgroundColor: TASK_STATUS_COLOR.needs_review }} />
      <button type="button" onClick={open} className="min-w-0 flex-1 px-3.5 py-2.5 text-left transition hover:bg-ink/3">
        <span className="block text-[11px] font-medium text-[#6b4fd6]">{t("hud.noticeTitle")}</span>
        <span className="block truncate text-sm font-semibold text-ink">{notice.title}</span>
        {located && (
          <span className="block truncate text-xs text-ink/55">
            {located.agent.title} · {located.agent.name}
          </span>
        )}
      </button>
      <button type="button" onClick={() => dismiss(notice.id)} aria-label={t("hud.noticeDismiss")} className="px-2.5 text-ink/35 hover:text-ink">
        ×
      </button>
    </div>
  );
}

export function Notices() {
  const notices = useNotifyStore((s) => s.notices);
  if (!notices.length) return null;
  return (
    <div className="flex flex-col items-end gap-2">
      {notices.map((n) => (
        <NoticeCard key={n.id} notice={n} />
      ))}
    </div>
  );
}
