"use client";

import { useMemo } from "react";
import type { WorldState } from "@/lib/api";
import { type FloorData, buildScene } from "@/scene/layout";
import { isFloorVisible, useUiStore } from "@/store/useUiStore";
import { isPresent } from "@/store/useWorldStore";
import { Batches } from "./parts/Batches";
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
    agents: f.agents.map((a) => ({
      id: a.id,
      deskIndex: a.desk_index,
      roleKey: a.role_key,
      title: a.title,
      present: isPresent(a, preview),
    })),
  }));
}

export function Building({ world, homeZoom }: { world: WorldState; homeZoom: number }) {
  const selected = useUiStore((s) => s.selectedFloor);
  const preview = useUiStore((s) => s.preview);
  const showRoutes = useUiStore((s) => s.routes);
  const floors = useMemo(() => toFloorData(world, preview), [world, preview]);
  const scene = useMemo(() => buildScene(floors, (n) => isFloorVisible(n, selected)), [floors, selected]);

  return (
    <group>
      <Batches parts={scene.parts} />
      <Walls walls={scene.walls} />
      <SceneLabels labels={scene.labels} />
      {selected === "all" && <Roof parts={scene.roof} homeZoom={homeZoom} />}
      {showRoutes && <RoutesOverlay routes={scene.routes} />}
    </group>
  );
}
