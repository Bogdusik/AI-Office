import type { Vec3 } from "@/scene/layout";

type BlockProps = {
  position: Vec3;
  size: Vec3;
  color: string;
  opacity?: number;
  emissive?: string;
  rotationY?: number;
  castShadow?: boolean;
  receiveShadow?: boolean;
};

export function Block({
  position,
  size,
  color,
  opacity = 1,
  emissive,
  rotationY = 0,
  castShadow = true,
  receiveShadow = true,
}: BlockProps) {
  const transparent = opacity < 1;
  return (
    <mesh
      position={position}
      rotation-y={rotationY}
      castShadow={castShadow && !transparent}
      receiveShadow={receiveShadow}
    >
      <boxGeometry args={size} />
      <meshStandardMaterial
        color={color}
        roughness={0.85}
        metalness={0}
        transparent={transparent}
        opacity={opacity}
        depthWrite={!transparent}
        emissive={emissive ?? "#000000"}
        emissiveIntensity={emissive ? 0.9 : 0}
      />
    </mesh>
  );
}
