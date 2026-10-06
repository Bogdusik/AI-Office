import { PALETTE } from "@/scene/palette";
import type { Vec3 } from "@/scene/layout";

export function Plant({ position, scale = 1 }: { position: Vec3; scale?: number }) {
  return (
    <group position={position} scale={scale}>
      <mesh position={[0, 0.2, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.22, 0.17, 0.4, 8]} />
        <meshStandardMaterial color={PALETTE.pot} roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.75, 0]} castShadow>
        <icosahedronGeometry args={[0.4, 0]} />
        <meshStandardMaterial color={PALETTE.plant} roughness={0.9} flatShading />
      </mesh>
    </group>
  );
}

export function Tree({ position }: { position: Vec3 }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.6, 0]} castShadow>
        <cylinderGeometry args={[0.12, 0.16, 1.2, 6]} />
        <meshStandardMaterial color={PALETTE.wood} roughness={0.9} />
      </mesh>
      <mesh position={[0, 2, 0]} castShadow>
        <coneGeometry args={[1, 2.4, 7]} />
        <meshStandardMaterial color={PALETTE.plant} roughness={0.9} flatShading />
      </mesh>
    </group>
  );
}
