import { DIM, type CoreLayout, type Rect, rectCenter, rectSize, stairSteps, storeyHeight } from "@/scene/layout";
import { PALETTE } from "@/scene/palette";
import { Block } from "./parts/Block";
import { Label } from "./parts/Label";

type Props = {
  core: Rect;
  layout: CoreLayout;
  floorIndex: number;
  floorNumber: number;
  floorName: string;
  isTop: boolean;
};

/** One storey of the elevator + stairs core, floor-local (y = 0 is the slab top). */
export function CoreSegment({ core, layout, floorIndex, floorNumber, floorName, isTop }: Props) {
  const [ccx, ccz] = rectCenter(core);
  const [cw, cd] = rectSize(core);
  const [sx, sz] = rectCenter(layout.shaft);
  const [sw, sd] = rectSize(layout.shaft);
  const h = storeyHeight(isTop);
  const t = DIM.wall;
  const slabRect = floorIndex === 0 ? core : { ...core, z1: layout.shaft.z1 + 0.2 };
  const [slx, slz] = rectCenter(slabRect);
  const [slw, sld] = rectSize(slabRect);

  return (
    <group>
      <Block position={[slx, -DIM.slab / 2, slz]} size={[slw, DIM.slab, sld]} color={PALETTE.core} />
      <Block position={[core.x0 + t / 2, h / 2 - DIM.slab, ccz]} size={[t, h, cd]} color={PALETTE.core} />
      <Block position={[ccx, h / 2 - DIM.slab, core.z0 + t / 2]} size={[cw, h, t]} color={PALETTE.core} />

      <Block position={[sx, h / 2 - DIM.slab / 2, sz]} size={[sw, h - DIM.slab, sd]} color={PALETTE.shaftGlass} opacity={0.4} />
      {[layout.shaft.x0, layout.shaft.x1].map((x) => (
        <Block key={x} position={[x, h / 2 - DIM.slab / 2, layout.shaft.z1]} size={[0.08, h - DIM.slab, 0.08]} color={PALETTE.metal} />
      ))}
      {floorIndex === 0 && (
        <Block position={[sx, 1.15, sz]} size={[sw - 0.3, 2.3, sd - 0.3]} color={PALETTE.metal} />
      )}

      {!isTop &&
        stairSteps(layout.stairs, floorIndex).map((step, i) => (
          <Block key={i} position={step.position} size={step.size} color={PALETTE.slabEdge} />
        ))}

      <group position={[layout.sign[0] + 0.55, 2.2, layout.sign[2]]}>
        <Block position={[0, 0, -0.03]} size={[0.8, 0.8, 0.04]} color={PALETTE.dark} castShadow={false} />
        <Label text={String(floorNumber)} position={[0, 0.04, 0]} size={0.46} color="#ffffff" />
        <Label text={floorName} position={[0.55, 0, 0]} size={0.22} color={PALETTE.dark} anchorX="left" />
      </group>

      {isTop && (
        <Block position={[ccx, h - DIM.slab + 0.45, ccz]} size={[cw, 0.9, cd]} color={PALETTE.core} />
      )}
    </group>
  );
}
