import { DIM, type EntranceLayout, rectCenter, rectSize } from "@/scene/layout";
import { PALETTE } from "@/scene/palette";
import { Block } from "./parts/Block";

/** Full-height glass double doors with a canopy and a card reader outside. Never faded with the facade. */
export function Entrance({ layout }: { layout: EntranceLayout }) {
  const [x, y, z] = layout.door;
  const { w, leaf } = DIM.door;
  const h = DIM.floorHeight - DIM.slab;
  const [rx, , rz] = layout.reader;
  const [wx, wz] = rectCenter(layout.walkway);
  const [ww, wd] = rectSize(layout.walkway);
  const frame = 0.12;

  return (
    <group>
      <Block position={[wx, 0.02, wz]} size={[ww, 0.04, wd]} color={PALETTE.curb} castShadow={false} />

      <group position={[x, y, z]}>
        {[-1, 1].map((s) => (
          <Block key={`post${s}`} position={[(s * (w - frame)) / 2, h / 2, 0]} size={[frame, h, 0.22]} color={PALETTE.dark} />
        ))}
        <Block position={[0, h - frame / 2, 0]} size={[w, frame, 0.22]} color={PALETTE.dark} />
        <Block position={[0, h / 2, 0]} size={[0.06, h, 0.2]} color={PALETTE.dark} />
        {[-1, 1].map((s) => (
          <group key={`leaf${s}`}>
            <Block position={[(s * leaf) / 2, (h - frame) / 2, 0]} size={[leaf - 0.06, h - frame, 0.04]} color={PALETTE.glass} opacity={0.45} />
            <Block position={[s * 0.18, 1.1, 0.06]} size={[0.04, 0.9, 0.04]} color={PALETTE.metal} castShadow={false} />
          </group>
        ))}
      </group>

      <Block position={layout.canopy.position} size={layout.canopy.size} color={PALETTE.slab} />
      <Block
        position={[layout.canopy.position[0], layout.canopy.position[1] - 0.1, z + DIM.canopy.d]}
        size={[DIM.canopy.w, 0.06, 0.06]}
        color={PALETTE.dark}
      />

      <Block position={[rx, 0.6, rz]} size={[0.16, 1.2, 0.16]} color={PALETTE.dark} />
      <Block position={[rx, 1.1, rz + 0.085]} size={[0.14, 0.22, 0.02]} color={PALETTE.metal} castShadow={false} />
      <Block position={[rx, 1.17, rz + 0.098]} size={[0.08, 0.03, 0.01]} color={PALETTE.accent} emissive={PALETTE.accent} castShadow={false} />
    </group>
  );
}
