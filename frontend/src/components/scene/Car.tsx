import { PALETTE } from "@/scene/palette";
import type { Vec3 } from "@/scene/layout";
import { Block } from "./parts/Block";

/** Low-poly car parked nose-in (towards -z). Origin on the ground at the car's centre. */
export function Car({ position, color }: { position: Vec3; color: string }) {
  return (
    <group position={position}>
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
