"use client";

import { useMemo } from "react";
import type { WorldState } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { agentTag } from "@/lib/labels";
import { allAgents } from "@/lib/world";
import { buildingLayout, presence, siteLayout } from "@/scene/layout";
import { useUiStore } from "@/store/useUiStore";
import { Button, Empty, PanelShell, Pill } from "./ui";

export function SpotPanel({ world, index }: { world: WorldState; index: number }) {
  const t = useT();
  const select = useUiStore((s) => s.select);
  const focusOn = useUiStore((s) => s.focusOn);
  const preview = useUiStore((s) => s.preview);

  const { spot, owner } = useMemo(() => {
    const building = buildingLayout(world.floors);
    const site = siteLayout(building);
    const floorIndex = new Map(building.floors.map((f) => [f.number, f.index]));
    const owner = allAgents(world).find(({ agent, floor }) => site.deskSpot(floorIndex.get(floor.number) ?? -1, agent.desk_index) === index);
    return { spot: site.spots[index], owner };
  }, [world, index]);

  if (!spot) return null;
  const status = owner ? agentTag(t, owner.agent) : null;

  return (
    <PanelShell testId="spot-panel" eyebrow={t("spot.eyebrow", { number: index + 1 })} title={t(`spot.${spot.kind}`)} onClose={() => select(null)}>
      {spot.kind === "desk" &&
        (owner && status ? (
          <div className="flex flex-col gap-3 rounded-xl border border-line bg-white p-3">
            <div>
              <p className="text-sm font-semibold text-ink">{owner.agent.title}</p>
              <p className="text-sm text-ink/60">{owner.agent.name}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Pill label={status.label} color={status.color} />
              <span className="text-xs text-ink/55">{presence(owner.agent.status, preview).carParked ? t("spot.carHere") : t("spot.noCar")}</span>
            </div>
            <Button onClick={() => focusOn({ kind: "agent", id: owner.agent.id }, owner.floor.number)}>{t("spot.toAgent")}</Button>
          </div>
        ) : (
          <Empty>{t("spot.freeDesk")}</Empty>
        ))}
      {spot.kind === "director" && <Empty>{t("spot.directorOnly")}</Empty>}
      {spot.kind === "guest" && <Empty>{t("spot.guests")}</Empty>}
    </PanelShell>
  );
}
