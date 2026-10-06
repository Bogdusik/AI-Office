import { PALETTE } from "@/scene/palette";
import type { Vec3 } from "@/scene/layout";

const TROUSERS = "#4a505b";

/** Seated figure facing -z (towards the desk). Origin is the chair seat. */
export function AgentFigure({ position, outfit }: { position: Vec3; outfit: string }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.1, -0.12]} castShadow>
        <boxGeometry args={[0.36, 0.14, 0.44]} />
        <meshStandardMaterial color={TROUSERS} roughness={0.9} />
      </mesh>
      <mesh position={[0, -0.18, -0.36]} castShadow>
        <boxGeometry args={[0.32, 0.4, 0.13]} />
        <meshStandardMaterial color={TROUSERS} roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.48, 0.04]} castShadow>
        <capsuleGeometry args={[0.18, 0.34, 4, 10]} />
        <meshStandardMaterial color={outfit} roughness={0.85} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * 0.24, 0.44, -0.14]} rotation-x={-1.05} castShadow>
          <capsuleGeometry args={[0.06, 0.3, 3, 6]} />
          <meshStandardMaterial color={outfit} roughness={0.85} />
        </mesh>
      ))}
      <mesh position={[0, 0.9, 0.02]} castShadow>
        <sphereGeometry args={[0.15, 14, 10]} />
        <meshStandardMaterial color={PALETTE.skin} roughness={0.8} />
      </mesh>
      <mesh position={[0, 0.96, 0.05]} castShadow>
        <sphereGeometry args={[0.155, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color={PALETTE.dark} roughness={0.9} />
      </mesh>
    </group>
  );
}
