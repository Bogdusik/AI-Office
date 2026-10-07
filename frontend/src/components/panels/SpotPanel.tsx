"use client";

import { useMemo } from "react";
import type { WorldState } from "@/lib/api";
import { agentTag } from "@/lib/labels";
import { allAgents } from "@/lib/world";
import { buildingLayout, presence, siteLayout } from "@/scene/layout";
import { useUiStore } from "@/store/useUiStore";
import { Button, Empty, PanelShell, Pill } from "./ui";

const KIND = { director: "Место директора", desk: "Место сотрудника", guest: "Гостевое место" } as const;

export function SpotPanel({ world, index }: { world: WorldState; index: number }) {
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
  const status = owner ? agentTag(owner.agent) : null;

  return (
    <PanelShell testId="spot-panel" eyebrow={`Парковка · место ${index + 1}`} title={KIND[spot.kind]} onClose={() => select(null)}>
      {spot.kind === "desk" &&
        (owner && status ? (
          <div className="flex flex-col gap-3 rounded-xl border border-line bg-white p-3">
            <div>
              <p className="text-sm font-semibold text-ink">{owner.agent.title}</p>
              <p className="text-sm text-ink/60">{owner.agent.name}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Pill label={status.label} color={status.color} />
              <span className="text-xs text-ink/55">{presence(owner.agent.status, preview).carParked ? "Машина на месте" : "Машины нет"}</span>
            </div>
            <Button onClick={() => focusOn({ kind: "agent", id: owner.agent.id }, owner.floor.number)}>К сотруднику</Button>
          </div>
        ) : (
          <Empty>Стол, за которым закреплено это место, сейчас свободен.</Empty>
        ))}
      {spot.kind === "director" && <Empty>Закреплено за директором.</Empty>}
      {spot.kind === "guest" && <Empty>Для гостей офиса.</Empty>}
    </PanelShell>
  );
}
