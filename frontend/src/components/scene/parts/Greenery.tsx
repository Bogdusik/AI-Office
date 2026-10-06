import type { GreeneryItem, Vec3 } from "@/scene/layout";
import { PALETTE } from "@/scene/palette";

function Conifer({ variant }: { variant: number }) {
  return (
    <>
      <mesh position={[0, 0.6, 0]} castShadow>
        <cylinderGeometry args={[0.13, 0.17, 1.2, 6]} />
        <meshStandardMaterial color={PALETTE.trunk} roughness={0.9} />
      </mesh>
      <mesh position={[0, 2.1, 0]} castShadow>
        <coneGeometry args={[1.05, 2.4, 7]} />
        <meshStandardMaterial color={PALETTE.conifer} roughness={0.9} flatShading />
      </mesh>
      {variant !== 1 && (
        <mesh position={[0, 3.2, 0]} castShadow>
          <coneGeometry args={[0.7, 1.6, 7]} />
          <meshStandardMaterial color={PALETTE.conifer} roughness={0.9} flatShading />
        </mesh>
      )}
    </>
  );
}

function Deciduous({ variant }: { variant: number }) {
  const leaf = PALETTE.leaf[variant % PALETTE.leaf.length];
  const blobs: { p: Vec3; r: number }[] = [
    { p: [0, 2.5, 0], r: 1.25 },
    { p: [0.7, 2.1, 0.3], r: 0.85 },
    { p: [-0.6, 2.2, -0.4], r: 0.8 },
  ];
  return (
    <>
      <mesh position={[0, 0.9, 0]} castShadow>
        <cylinderGeometry args={[0.14, 0.2, 1.8, 6]} />
        <meshStandardMaterial color={PALETTE.trunk} roughness={0.9} />
      </mesh>
      {blobs.slice(0, variant === 2 ? 2 : 3).map((b, i) => (
        <mesh key={i} position={b.p} castShadow>
          <icosahedronGeometry args={[b.r, 0]} />
          <meshStandardMaterial color={leaf} roughness={0.9} flatShading />
        </mesh>
      ))}
    </>
  );
}

function Bush({ variant }: { variant: number }) {
  const parts: { p: Vec3; r: number }[] = [
    { p: [0, 0.38, 0], r: 0.5 },
    { p: [0.45, 0.3, 0.15], r: 0.36 },
    { p: [-0.4, 0.28, -0.1], r: 0.34 },
  ];
  return (
    <>
      {parts.slice(0, variant === 0 ? 3 : 2).map((b, i) => (
        <mesh key={i} position={b.p} castShadow>
          <icosahedronGeometry args={[b.r, 0]} />
          <meshStandardMaterial color={PALETTE.bush} roughness={0.95} flatShading />
        </mesh>
      ))}
    </>
  );
}

function FlowerBed({ variant }: { variant: number }) {
  const flowers = Array.from({ length: 12 }, (_, i) => {
    const col = i % 4;
    const row = Math.floor(i / 4);
    return {
      p: [-1.05 + col * 0.7, 0.42, -0.45 + row * 0.45] as Vec3,
      c: PALETTE.flowers[(i + variant) % PALETTE.flowers.length],
    };
  });
  return (
    <>
      <mesh position={[0, 0.15, 0]} castShadow receiveShadow>
        <boxGeometry args={[3, 0.3, 1.4]} />
        <meshStandardMaterial color={PALETTE.curb} roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.31, 0]} receiveShadow>
        <boxGeometry args={[2.8, 0.04, 1.2]} />
        <meshStandardMaterial color={PALETTE.soil} roughness={1} />
      </mesh>
      {flowers.map((f, i) => (
        <mesh key={i} position={f.p}>
          <icosahedronGeometry args={[0.14, 0]} />
          <meshStandardMaterial color={i % 3 === 0 ? PALETTE.bush : f.c} roughness={0.9} flatShading />
        </mesh>
      ))}
    </>
  );
}

export function GreeneryPiece({ item }: { item: GreeneryItem }) {
  return (
    <group position={item.position} scale={item.scale}>
      {item.kind === "conifer" && <Conifer variant={item.variant} />}
      {item.kind === "deciduous" && <Deciduous variant={item.variant} />}
      {item.kind === "bush" && <Bush variant={item.variant} />}
      {item.kind === "flowerbed" && <FlowerBed variant={item.variant} />}
    </group>
  );
}

export function PottedPlant({ position, scale = 1 }: { position: Vec3; scale?: number }) {
  return (
    <group position={position} scale={scale}>
      <mesh position={[0, 0.22, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.26, 0.2, 0.44, 8]} />
        <meshStandardMaterial color={PALETTE.pot} roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.85, 0]} castShadow>
        <icosahedronGeometry args={[0.45, 0]} />
        <meshStandardMaterial color={PALETTE.plant} roughness={0.9} flatShading />
      </mesh>
      <mesh position={[0.12, 1.25, 0.05]} castShadow>
        <icosahedronGeometry args={[0.28, 0]} />
        <meshStandardMaterial color={PALETTE.plant} roughness={0.9} flatShading />
      </mesh>
    </group>
  );
}
