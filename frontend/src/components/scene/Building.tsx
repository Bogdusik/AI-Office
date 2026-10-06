"use client";

import { useMemo } from "react";
import type { WorldState } from "@/lib/api";
import {
  buildingLayout,
  coreLayout,
  entranceLayout,
  siteLayout,
  treePositions,
} from "@/scene/layout";
import { isFloorVisible, useUiStore } from "@/store/useUiStore";
import { Entrance } from "./Entrance";
import { FloorLevel } from "./FloorLevel";
import { Parking } from "./Parking";
import { Tree } from "./parts/Plant";

export function useSiteLayout(world: WorldState) {
  return useMemo(() => {
    const building = buildingLayout(world.floors);
    const agents = world.floors.flatMap((f) => f.agents).sort((a, b) => a.id - b.id);
    const site = siteLayout(building, agents.length);
    const entrance = entranceLayout(building);
    return {
      building,
      core: coreLayout(building),
      entrance,
      site,
      trees: treePositions(site, entrance.walkway),
      agents,
    };
  }, [world]);
}

export function Building({ world }: { world: WorldState }) {
  const selected = useUiStore((s) => s.selectedFloor);
  const preview = useUiStore((s) => s.preview);
  const { building, core, entrance, site, trees, agents } = useSiteLayout(world);
  const floorsByNumber = new Map(world.floors.map((f) => [f.number, f]));
  const visible = building.floors.filter((f) => isFloorVisible(f.number, selected));
  const topVisible = visible.at(-1)?.number;

  return (
    <group>
      {visible.map((layout) => {
        const floor = floorsByNumber.get(layout.number);
        if (!floor) return null;
        return (
          <FloorLevel
            key={floor.id}
            floor={floor}
            layout={layout}
            building={building}
            core={core}
            isTop={layout.number === topVisible}
            preview={preview}
          />
        );
      })}
      {building.floors.length > 0 && <Entrance layout={entrance} />}
      <Parking site={site} agents={agents} preview={preview} />
      {trees.map((p) => (
        <Tree key={`${p[0]}:${p[2]}`} position={p} />
      ))}
    </group>
  );
}
