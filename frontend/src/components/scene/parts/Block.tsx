import type { Box, Vec3 } from "@/scene/layout";

type BlockProps = {
  position: Vec3;
  size: Vec3;
  color: string;
  opacity?: number;
  emissive?: string;
  rotation?: Vec3;
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
  rotation,
  rotationY = 0,
  castShadow = true,
  receiveShadow = true,
}: BlockProps) {
  const transparent = opacity < 1;
  return (
    <mesh
      position={position}
      rotation={rotation ?? [0, rotationY, 0]}
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

type BoxesProps = { boxes: Box[]; color: string; opacity?: number; castShadow?: boolean };

export function Boxes({ boxes, color, opacity, castShadow }: BoxesProps) {
  return (
    <>
      {boxes.map((b, i) => (
        <Block
          key={i}
          position={b.position}
          size={b.size}
          rotation={b.rotation}
          color={color}
          opacity={opacity}
          castShadow={castShadow}
        />
      ))}
    </>
  );
}
