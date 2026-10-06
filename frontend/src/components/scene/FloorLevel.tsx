import type { FloorState } from "@/lib/api";
import {
  DIM,
  type BuildingLayout,
  type FloorLayout,
  type WallSpec,
  columnPositions,
  deskIndices,
  elevatorOpening,
  floorWalls,
  loungeLayout,
  storeyHeight,
  wallWithWindows,
} from "@/scene/layout";
import { PALETTE } from "@/scene/palette";
import { isPresent } from "@/store/useWorldStore";
import { DirectorOffice, Lounge } from "./DirectorOffice";
import { Lobby } from "./Lobby";
import { Block } from "./parts/Block";
import { Fade } from "./parts/Fade";
import { Workstation } from "./Workstation";

type Props = {
  floor: FloorState;
  layout: FloorLayout;
  building: BuildingLayout;
  isTop: boolean;
  preview: boolean;
};

function Facade({ spec }: { spec: WallSpec }) {
  const pieces = wallWithWindows(spec.length, DIM.floorHeight - DIM.slab, spec.openings);
  return (
    <Fade normal={spec.normal}>
      <group position={spec.origin} rotation-y={spec.yaw}>
        {pieces.solid.map((b, i) => (
          <Block key={`s${i}`} position={b.position} size={b.size} color={PALETTE.wall} />
        ))}
        {pieces.glass.map((b, i) => (
          <Block key={`g${i}`} position={b.position} size={b.size} color={PALETTE.glass} opacity={0.35} />
        ))}
      </group>
    </Fade>
  );
}

/** Elevator landing doors on the inner face of the left wall (the shaft is right behind it). */
function ElevatorDoors({ building }: { building: BuildingLayout }) {
  const o = elevatorOpening(building);
  const mid = (o.from + o.to) / 2;
  const w = o.to - o.from;
  const h = 2.3;
  const x = DIM.wall + 0.03;
  return (
    <group>
      <Block position={[x, h + 0.1, mid]} size={[0.06, 0.2, w + 0.3]} color={PALETTE.steel} />
      {[-1, 1].map((s) => (
        <Block key={`f${s}`} position={[x, h / 2, mid + (s * (w + 0.15)) / 2]} size={[0.06, h, 0.15]} color={PALETTE.steel} />
      ))}
      {[-1, 1].map((s) => (
        <Block key={`d${s}`} position={[x - 0.02, h / 2, mid + (s * w) / 4]} size={[0.04, h, w / 2 - 0.02]} color={PALETTE.metal} />
      ))}
    </group>
  );
}

export function FloorLevel({ floor, layout, building, isTop, preview }: Props) {
  const { width } = building;
  const depth = layout.depth;
  const byDesk = new Map(floor.agents.map((a) => [a.desk_index, a]));
  const span = storeyHeight(building, false) - DIM.slab;

  return (
    <group position={[0, layout.baseY, 0]}>
      <Block position={[width / 2, -DIM.slab / 2, depth / 2]} size={[width, DIM.slab, depth]} color={PALETTE.slab} />

      {!isTop &&
        columnPositions(building).map(([x, , z]) => (
          <Block key={`${x}:${z}`} position={[x, span / 2, z]} size={[0.2, span, 0.2]} color={PALETTE.slabEdge} />
        ))}

      {floorWalls(building, layout).map((spec) => (
        <Facade key={spec.key} spec={spec} />
      ))}
      <ElevatorDoors building={building} />

      {deskIndices(floor.capacity).map((i) => {
        const agent = byDesk.get(i);
        return (
          <Workstation key={i} deskIndex={i} agent={agent} present={agent !== undefined && isPresent(agent, preview)} />
        );
      })}

      {layout.hasDirectorOffice ? (
        <DirectorOffice room={building.officeRoom} />
      ) : (
        <Lounge layout={loungeLayout(building.sideZone)} />
      )}

      {layout.isGround && <Lobby building={building} />}
    </group>
  );
}
