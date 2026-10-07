"use client";

import type { WorldState } from "@/lib/api";
import { agentTag } from "@/lib/labels";
import { type FloorData, type SceneSpec, presence } from "@/scene/layout";
import { useUiStore } from "@/store/useUiStore";
import { Batches } from "./parts/Batches";
import { Highlight } from "./parts/Highlight";
import { Picking } from "./parts/Picking";
import { Roof } from "./parts/Roof";
import { RoutesOverlay } from "./parts/RoutesOverlay";
import { SceneLabels } from "./parts/SceneLabels";
import { Walls } from "./parts/Walls";

export function toFloorData(world: WorldState, preview: boolean): FloorData[] {
  return world.floors.map((f) => ({
    id: f.id,
    number: f.number,
    name: f.name,
    kind: f.kind,
    capacity: f.capacity,
    has_director_office: f.has_director_office,
    has_server_room: f.has_server_room,
    has_kitchen: f.has_kitchen,
    agents: f.agents.map((a) => ({
      id: a.id,
      deskIndex: a.desk_index,
      roleKey: a.role_key,
      title: a.title,
      ...presence(a.status, preview),
      status: agentTag(a).label,
      statusColor: agentTag(a).color,
    })),
  }));
}

export function Building({ scene, homeZoom }: { scene: SceneSpec; homeZoom: number }) {
  const selected = useUiStore((s) => s.selectedFloor);
  const showRoutes = useUiStore((s) => s.routes);

  return (
    <group>
      <Batches parts={scene.parts} />
      <Walls walls={scene.walls} />
      <SceneLabels labels={scene.labels} />
      <Picking picks={scene.picks} />
      <Highlight picks={scene.picks} />
      {selected === "all" && <Roof parts={scene.roof} homeZoom={homeZoom} />}
      {showRoutes && <RoutesOverlay routes={scene.routes} />}
    </group>
  );
}
