import { PALETTE } from "@/scene/palette";
import type { Placement } from "@/scene/layout";
import { Block } from "./parts/Block";

/** Low-poly car; local nose points to −z. Origin on the ground at the car's centre. */
export function Car({ at, color }: { at: Placement; color: string }) {
  return (
    <group position={at.position} rotation-y={at.yaw}>
      <Block position={[0, 0.5, 0]} size={[1.8, 0.5, 4]} color={color} />
      <Block position={[0, 0.95, 0.25]} size={[1.6, 0.42, 2.1]} color={color} />
      <Block position={[0, 0.95, 0.25]} size={[1.64, 0.3, 1.8]} color={PALETTE.dark} castShadow={false} />
      {[-1, 1].flatMap((sx) =>
        [-1, 1].map((sz) => (
          <mesh key={`${sx}${sz}`} position={[sx * 0.86, 0.32, sz * 1.25]} rotation-z={Math.PI / 2} castShadow>
            <cylinderGeometry args={[0.32, 0.32, 0.24, 10]} />
            <meshStandardMaterial color={PALETTE.dark} roughness={0.9} />
          </mesh>
        )),
      )}
    </group>
  );
}
