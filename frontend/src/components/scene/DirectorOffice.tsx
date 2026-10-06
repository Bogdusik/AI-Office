import { type LoungeLayout, type Rect, officeFurniture, rectCenter, rectSize } from "@/scene/layout";
import { PALETTE } from "@/scene/palette";
import { Block } from "./parts/Block";
import { Fade } from "./parts/Fade";
import { Bookshelf, LowTable, OfficeChair, Sofa } from "./parts/Furniture";
import { PottedPlant } from "./parts/Greenery";
import { Label } from "./parts/Label";

const GLASS_H = 2.7;

function GlassWall({ from, to, at, axis }: { from: number; to: number; at: number; axis: "x" | "z" }) {
  const len = to - from;
  const mid = (from + to) / 2;
  const pos = (y: number): [number, number, number] => (axis === "x" ? [mid, y, at] : [at, y, mid]);
  const size = (w: number, h: number, t: number): [number, number, number] => (axis === "x" ? [w, h, t] : [t, h, w]);
  return (
    <>
      <Block position={pos(GLASS_H / 2)} size={size(len, GLASS_H, 0.05)} color={PALETTE.glass} opacity={0.32} />
      <Block position={pos(GLASS_H)} size={size(len, 0.09, 0.11)} color={PALETTE.accent} />
    </>
  );
}

export function DirectorOffice({ room }: { room: Rect }) {
  const [cx, cz] = rectCenter(room);
  const [w, d] = rectSize(room);
  const f = officeFurniture(room);
  const [dx, , dz] = f.desk.position;
  const [mx, my, mz] = f.monitor.position;

  return (
    <group>
      <Block position={[cx, 0.01, cz]} size={[w - 0.4, 0.02, d - 0.4]} color={PALETTE.rug} castShadow={false} />

      <Fade normal={[-1, 0]}>
        <GlassWall from={room.z0} to={room.z1} at={room.x0} axis="z" />
      </Fade>
      <Fade normal={[1, 0]}>
        <GlassWall from={room.z0} to={room.z1} at={room.x1} axis="z" />
      </Fade>
      <Fade normal={[0, 1]}>
        <GlassWall from={room.x0} to={f.doorGap.from} at={room.z1} axis="x" />
        <GlassWall from={f.doorGap.to} to={room.x1} at={room.z1} axis="x" />
        <Block position={[cx, GLASS_H, room.z1]} size={[w, 0.09, 0.11]} color={PALETTE.accent} />
      </Fade>

      <Block position={[dx, 0.78, dz]} size={[2.6, 0.08, 1.15]} color={PALETTE.darkWood} />
      <Block position={[dx, 0.37, dz]} size={[2.5, 0.74, 1.05]} color={PALETTE.darkWood} />
      <Block position={[mx, my + 0.12, mz]} size={[0.08, 0.24, 0.08]} color={PALETTE.metal} />
      <Block position={[mx, my + 0.48, mz]} size={[1.1, 0.55, 0.05]} color={PALETTE.dark} />
      <Block
        position={[mx, my + 0.48, mz - 0.03]}
        size={[1.02, 0.47, 0.005]}
        color={PALETTE.screenOn}
        emissive={PALETTE.screenOn}
        castShadow={false}
      />
      <OfficeChair at={f.chair} color={PALETTE.dark} />

      <LowTable position={f.meetingTable.position} size={[1.3, 0.74, 1.3]} />
      {f.meetingChairs.map((c, i) => (
        <OfficeChair key={i} at={c} />
      ))}
      <Bookshelf at={f.shelf} />
      {f.plants.map((p, i) => (
        <PottedPlant key={i} position={p} />
      ))}

      <group position={f.sign}>
        <Block position={[0, 0, 0]} size={[2, 0.42, 0.04]} color={PALETTE.accent} />
        <Label text="DIRECTOR" position={[0, 0, 0.025]} size={0.24} color="#ffffff" />
      </group>
    </group>
  );
}

export function Lounge({ layout }: { layout: LoungeLayout }) {
  return (
    <group>
      <Sofa at={layout.sofa} length={2.6} />
      <LowTable position={layout.table} />
      {layout.plants.map((p, i) => (
        <PottedPlant key={i} position={p} />
      ))}
    </group>
  );
}
