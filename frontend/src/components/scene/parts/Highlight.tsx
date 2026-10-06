"use client";

import { Line } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import type { Mesh, MeshBasicMaterial } from "three";
import { type Pick, type Vec3, selectionKey } from "@/scene/layout";
import { PALETTE } from "@/scene/palette";
import { useUiStore } from "@/store/useUiStore";

function boxEdges([w, h, d]: Vec3): Vec3[] {
  const c = (sx: number, sy: number, sz: number): Vec3 => [(sx * w) / 2, (sy * h) / 2, (sz * d) / 2];
  const out: Vec3[] = [];
  for (const sy of [-1, 1]) {
    out.push(c(-1, sy, -1), c(1, sy, -1), c(1, sy, -1), c(1, sy, 1), c(1, sy, 1), c(-1, sy, 1), c(-1, sy, 1), c(-1, sy, -1));
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) out.push(c(sx, -1, sz), c(sx, 1, sz));
  return out;
}

function Pulse({ radius, y }: { radius: number; y: number }) {
  const ring = useRef<Mesh>(null);
  useFrame(({ clock }) => {
    const m = ring.current;
    if (!m) return;
    const t = (clock.elapsedTime % 1.6) / 1.6;
    m.scale.setScalar(1 + t * 0.35);
    (m.material as MeshBasicMaterial).opacity = 0.75 * (1 - t);
  });
  return (
    <mesh ref={ring} position={[0, y, 0]} rotation-x={-Math.PI / 2} renderOrder={10}>
      <ringGeometry args={[radius, radius + 0.14, 48]} />
      <meshBasicMaterial color={PALETTE.accent} transparent depthWrite={false} toneMapped={false} />
    </mesh>
  );
}

function Outline({ pick, color, selected }: { pick: Pick; color: string; selected: boolean }) {
  const edges = useMemo(() => boxEdges(pick.box.size), [pick.box.size]);
  const [w, h, d] = pick.box.size;
  return (
    <group position={pick.box.position}>
      <Line points={edges} segments color={color} lineWidth={selected ? 3 : 2} transparent opacity={selected ? 1 : 0.7} depthTest={false} renderOrder={11} />
      <mesh renderOrder={9}>
        <boxGeometry args={[w, h, d]} />
        <meshBasicMaterial color={color} transparent opacity={selected ? 0.12 : 0.07} depthWrite={false} toneMapped={false} />
      </mesh>
      {selected && <Pulse radius={Math.max(w, d) * 0.62} y={-h / 2 + 0.04} />}
    </group>
  );
}

/** Hover and selection frames; reads the UI store, never writes it. */
export function Highlight({ picks }: { picks: Pick[] }) {
  const hovered = useUiStore((s) => s.hovered);
  const selection = useUiStore((s) => s.selection);
  const byKey = useMemo(() => new Map(picks.map((p) => [p.key, p])), [picks]);
  const selected = selection ? byKey.get(selectionKey(selection)) : undefined;
  const hover = hovered && hovered !== selected?.key ? byKey.get(hovered) : undefined;

  return (
    <>
      {hover && <Outline pick={hover} color={PALETTE.dark} selected={false} />}
      {selected && <Outline pick={selected} color={PALETTE.accent} selected />}
    </>
  );
}
