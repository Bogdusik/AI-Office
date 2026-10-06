"use client";

import { useMemo } from "react";
import type { WorldState } from "@/lib/api";
import { buildingLayout, coreLayout, entranceLayout, greenery, siteLayout } from "@/scene/layout";
import { carColor } from "@/scene/palette";
import { isFloorVisible, useUiStore } from "@/store/useUiStore";
import { isPresent } from "@/store/useWorldStore";
import { CoreSegment } from "./CoreSegment";
import { Entrance } from "./Entrance";
import { FloorLevel } from "./FloorLevel";
import { type ParkedCar, Parking } from "./Parking";
import { GreeneryPiece } from "./parts/Greenery";

export function useSiteLayout(world: WorldState) {
  return useMemo(() => {
    const building = buildingLayout(world.floors);
    const site = siteLayout(building);
    const entrance = entranceLayout(building, site.road.z0);
    return {
      building,
      core: coreLayout(building),
      site,
      entrance,
      plants: greenery(building, site, entrance),
    };
  }, [world]);
}

export function Building({ world }: { world: WorldState }) {
  const selected = useUiStore((s) => s.selectedFloor);
  const preview = useUiStore((s) => s.preview);
  const { building, core, site, entrance, plants } = useSiteLayout(world);
  const floorsByNumber = useMemo(() => new Map(world.floors.map((f) => [f.number, f])), [world]);
  const visible = building.floors.filter((f) => isFloorVisible(f.number, selected));
  const topVisible = visible.at(-1)?.number;

  const cars: ParkedCar[] = building.floors.flatMap((layout) => {
    const floor = floorsByNumber.get(layout.number);
    if (!floor) return [];
    return floor.agents
      .filter((a) => isPresent(a, preview))
      .map((a) => ({ key: a.id, spot: site.deskSpot(layout.index, a.desk_index), color: carColor(a.role_key) }));
  });

  return (
    <group>
      {visible.map((layout) => {
        const floor = floorsByNumber.get(layout.number);
        if (!floor) return null;
        const isTop = layout.number === topVisible;
        return (
          <group key={floor.id}>
            <FloorLevel floor={floor} layout={layout} building={building} isTop={isTop} preview={preview} />
            <group position={[0, layout.baseY, 0]}>
              <CoreSegment
                building={building}
                core={core}
                floorIndex={layout.index}
                floorNumber={floor.number}
                floorName={floor.name}
                isTop={isTop}
              />
            </group>
          </group>
        );
      })}
      {building.floors.length > 0 && <Entrance layout={entrance} />}
      <Parking site={site} cars={cars} />
      {plants.map((item, i) => (
        <GreeneryPiece key={i} item={item} />
      ))}
    </group>
  );
}
