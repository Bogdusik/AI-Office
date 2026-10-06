import type { FloorState } from "@/lib/api";
import {
  DIM,
  type BuildingLayout,
  type CoreLayout,
  type FloorLayout,
  columnPositions,
  deskIndices,
  storeyHeight,
  wallWithWindows,
} from "@/scene/layout";
import { PALETTE } from "@/scene/palette";
import { isPresent } from "@/store/useWorldStore";
import { CoreSegment } from "./CoreSegment";
import { DirectorOffice, Lounge } from "./DirectorOffice";
import { Block } from "./parts/Block";
import { Workstation } from "./Workstation";

type Props = {
  floor: FloorState;
  layout: FloorLayout;
  building: BuildingLayout;
  core: CoreLayout;
  isTop: boolean;
  preview: boolean;
};

function Wall({ length, rotationY, position }: { length: number; rotationY: number; position: [number, number, number] }) {
  const pieces = wallWithWindows(length, DIM.floorHeight - DIM.slab);
  return (
    <group position={position} rotation-y={rotationY}>
      {pieces.solid.map((b, i) => (
        <Block key={`s${i}`} position={b.position} size={b.size} color={PALETTE.wall} />
      ))}
      {pieces.glass.map((b, i) => (
        <Block key={`g${i}`} position={b.position} size={b.size} color={PALETTE.glass} opacity={0.35} />
      ))}
    </group>
  );
}

export function FloorLevel({ floor, layout, building, core, isTop, preview }: Props) {
  const { width, depth } = building;
  const byDesk = new Map(floor.agents.map((a) => [a.desk_index, a]));

  return (
    <group position={[0, layout.baseY, 0]}>
      <Block position={[width / 2, -DIM.slab / 2, depth / 2]} size={[width, DIM.slab, depth]} color={PALETTE.slab} />
      <Block position={[width / 2, -DIM.slab / 2, depth + 0.01]} size={[width, DIM.slab, 0.02]} color={PALETTE.slabEdge} castShadow={false} />
      <Block position={[width + 0.01, -DIM.slab / 2, depth / 2]} size={[0.02, DIM.slab, depth]} color={PALETTE.slabEdge} castShadow={false} />

      {!isTop &&
        columnPositions(building).map(([x, , z]) => (
          <Block
            key={`${x}:${z}`}
            position={[x, storeyHeight(false) / 2 - DIM.slab, z]}
            size={[0.18, storeyHeight(false) - DIM.slab, 0.18]}
            color={PALETTE.slabEdge}
          />
        ))}

      <Wall length={width} rotationY={0} position={[0, 0, DIM.wall / 2]} />
      <Wall length={depth} rotationY={-Math.PI / 2} position={[DIM.wall / 2, 0, 0]} />

      {deskIndices(floor.capacity).map((i) => {
        const agent = byDesk.get(i);
        return (
          <Workstation
            key={i}
            deskIndex={i}
            agent={agent}
            present={agent !== undefined && isPresent(agent, preview)}
          />
        );
      })}

      {layout.hasDirectorOffice ? (
        <DirectorOffice room={building.officeRoom} />
      ) : (
        <Lounge position={building.lounge} />
      )}

      <CoreSegment
        core={building.core}
        layout={core}
        floorIndex={layout.index}
        floorNumber={floor.number}
        floorName={floor.name}
        isTop={isTop}
      />
    </group>
  );
}
