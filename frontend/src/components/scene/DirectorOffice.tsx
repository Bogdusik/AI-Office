import { type Rect, rectCenter, rectSize } from "@/scene/layout";
import { PALETTE } from "@/scene/palette";
import { Block } from "./parts/Block";
import { Label } from "./parts/Label";
import { Plant } from "./parts/Plant";

const GLASS_H = 2.6;
const DOOR_W = 1.1;
const RUG = "#f1e3da";
const EXEC_WOOD = "#9c8064";

export function DirectorOffice({ room }: { room: Rect }) {
  const [cx, cz] = rectCenter(room);
  const [w, d] = rectSize(room);
  const frontLeft = (w - DOOR_W) / 2;

  return (
    <group>
      <Block position={[cx, 0.01, cz]} size={[w - 0.3, 0.02, d - 0.3]} color={RUG} castShadow={false} />

      {/* glass partition, left side (x0) */}
      <Block position={[room.x0, GLASS_H / 2, cz]} size={[0.05, GLASS_H, d]} color={PALETTE.glass} opacity={0.35} />
      <Block position={[room.x0, GLASS_H, cz]} size={[0.1, 0.08, d]} color={PALETTE.accent} />
      {/* glass partition, right side (x1) */}
      <Block position={[room.x1, GLASS_H / 2, cz]} size={[0.05, GLASS_H, d]} color={PALETTE.glass} opacity={0.35} />
      <Block position={[room.x1, GLASS_H, cz]} size={[0.1, 0.08, d]} color={PALETTE.accent} />
      {/* front (z1) with a door gap in the middle */}
      {[room.x0 + frontLeft / 2, room.x1 - frontLeft / 2].map((x) => (
        <Block key={x} position={[x, GLASS_H / 2, room.z1]} size={[frontLeft, GLASS_H, 0.05]} color={PALETTE.glass} opacity={0.35} />
      ))}
      <Block position={[cx, GLASS_H, room.z1]} size={[w, 0.08, 0.1]} color={PALETTE.accent} />

      {/* executive desk facing the door */}
      <Block position={[cx, 0.76, cz - 0.4]} size={[2.2, 0.08, 1]} color={EXEC_WOOD} />
      <Block position={[cx, 0.36, cz - 0.4]} size={[2.1, 0.72, 0.9]} color={EXEC_WOOD} />
      <Block position={[cx, 1.0, cz - 0.75]} size={[0.07, 0.4, 0.07]} color={PALETTE.metal} />
      <Block position={[cx, 1.3, cz - 0.75]} size={[1.0, 0.5, 0.05]} color={PALETTE.dark} />
      <Block position={[cx, 1.3, cz - 0.72]} size={[0.92, 0.42, 0.005]} color={PALETTE.screenOn} emissive={PALETTE.screenOn} castShadow={false} />
      <Block position={[cx, 0.55, cz - 1.25]} size={[0.62, 0.1, 0.58]} color={PALETTE.dark} />
      <Block position={[cx, 1.0, cz - 1.52]} size={[0.62, 0.9, 0.08]} color={PALETTE.dark} />

      <group position={[cx, 2.25, room.z1 + 0.02]}>
        <Block position={[0, 0, 0]} size={[1.6, 0.36, 0.04]} color={PALETTE.accent} />
        <Label text="DIRECTOR" position={[0, 0, 0.025]} size={0.17} color="#ffffff" />
      </group>

      <Plant position={[room.x0 + 0.55, 0, room.z0 + 0.5]} />
      <Plant position={[room.x1 - 0.55, 0, room.z0 + 0.5]} scale={0.8} />
    </group>
  );
}

export function Lounge({ position }: { position: [number, number, number] }) {
  const [x, , z] = position;
  return (
    <group>
      <Block position={[x, 0.22, z]} size={[2.2, 0.44, 0.85]} color="#c9c4bb" />
      <Block position={[x, 0.6, z - 0.36]} size={[2.2, 0.5, 0.14]} color="#c9c4bb" />
      <Block position={[x, 0.2, z + 1]} size={[0.9, 0.4, 0.6]} color={PALETTE.wood} />
      <Plant position={[x + 1.5, 0, z - 0.2]} />
    </group>
  );
}
