import type { Placement, Vec3 } from "@/scene/layout";
import { PALETTE } from "@/scene/palette";
import { Block } from "./Block";

/** Small primitive furniture models. Each takes a placement (from layout) and owns only its own proportions. */

export function Sofa({ at, length = 2.4, color = PALETTE.fabric }: { at: Placement; length?: number; color?: string }) {
  return (
    <group position={at.position} rotation-y={at.yaw}>
      <Block position={[0, 0.22, 0]} size={[length, 0.44, 0.9]} color={color} />
      <Block position={[0, 0.62, -0.36]} size={[length, 0.5, 0.18]} color={color} />
      {[-1, 1].map((s) => (
        <Block key={s} position={[(s * (length - 0.18)) / 2, 0.36, 0]} size={[0.18, 0.72, 0.9]} color={PALETTE.fabricDark} />
      ))}
    </group>
  );
}

export function Armchair({ at }: { at: Placement }) {
  return <Sofa at={at} length={1} color={PALETTE.fabricDark} />;
}

export function LowTable({ position, size = [1.2, 0.4, 0.7] }: { position: Vec3; size?: Vec3 }) {
  return <Block position={[position[0], size[1] / 2, position[2]]} size={size} color={PALETTE.wood} />;
}

export function OfficeChair({ at, color = PALETTE.chair }: { at: Placement; color?: string }) {
  return (
    <group position={at.position} rotation-y={at.yaw}>
      <Block position={[0, 0.22, 0]} size={[0.06, 0.44, 0.06]} color={PALETTE.metal} />
      <Block position={[0, 0.48, 0]} size={[0.52, 0.08, 0.5]} color={color} />
      <Block position={[0, 0.82, -0.23]} size={[0.52, 0.6, 0.07]} color={color} />
    </group>
  );
}

export function ReceptionDesk({ at }: { at: Placement }) {
  return (
    <group position={at.position} rotation-y={at.yaw}>
      <Block position={[0, 0.55, 0]} size={[3.4, 1.1, 0.7]} color={PALETTE.slab} />
      <Block position={[0, 1.13, 0.05]} size={[3.6, 0.06, 0.85]} color={PALETTE.darkWood} />
      <Block position={[0, 0.55, 0.36]} size={[3.4, 0.08, 0.02]} color={PALETTE.accent} castShadow={false} />
      <Block position={[-0.8, 1.38, -0.12]} size={[0.6, 0.38, 0.04]} color={PALETTE.dark} />
    </group>
  );
}

export function Bookshelf({ at }: { at: Placement }) {
  return (
    <group position={at.position} rotation-y={at.yaw}>
      <Block position={[0, 1, 0]} size={[2, 2, 0.4]} color={PALETTE.darkWood} />
      {[0.5, 1, 1.5].map((y) => (
        <Block key={y} position={[0, y, 0.12]} size={[1.85, 0.32, 0.2]} color={PALETTE.fabric} castShadow={false} />
      ))}
    </group>
  );
}
