import { DIM, type EntranceLayout, rectCenter, rectSize } from "@/scene/layout";
import { PALETTE } from "@/scene/palette";
import { Block } from "./parts/Block";

export function Entrance({ layout }: { layout: EntranceLayout }) {
  const [x, y, z] = layout.door;
  const { w, h } = DIM.door;
  const [rx, , rz] = layout.reader;
  const [wx, wz] = rectCenter(layout.walkway);
  const [ww, wd] = rectSize(layout.walkway);

  return (
    <group>
      <Block position={[wx, 0.02, wz]} size={[ww, 0.04, wd]} color={PALETTE.curb} castShadow={false} />

      {[-1, 1].map((side) => (
        <Block key={side} position={[x + side * (w / 2 + 0.08), y + h / 2, z]} size={[0.16, h, 0.24]} color={PALETTE.dark} />
      ))}
      <Block position={[x, y + h + 0.1, z]} size={[w + 0.32, 0.2, 0.24]} color={PALETTE.dark} />
      <Block position={[x, y + h / 2, z]} size={[w, h, 0.05]} color={PALETTE.glass} opacity={0.5} />
      <Block position={[x, y + h + 0.4, z + 0.6]} size={[w + 1.2, 0.08, 1.3]} color={PALETTE.slab} />

      <Block position={[rx, 0.6, rz]} size={[0.14, 1.2, 0.14]} color={PALETTE.dark} />
      <Block position={[rx, 1.08, rz + 0.075]} size={[0.13, 0.2, 0.02]} color={PALETTE.metal} castShadow={false} />
      <Block position={[rx, 1.15, rz + 0.088]} size={[0.07, 0.03, 0.01]} color={PALETTE.accent} emissive={PALETTE.accent} castShadow={false} />
    </group>
  );
}
