"use client";

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import {
  type BufferGeometry,
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Euler,
  IcosahedronGeometry,
  type InstancedMesh,
  type Material,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
} from "three";
import type { Finish, Part, Shape } from "@/scene/layout";

const GEOMETRY: Record<Shape, () => BufferGeometry> = {
  box: () => new BoxGeometry(1, 1, 1),
  cylinder: () => new CylinderGeometry(0.5, 0.5, 1, 12),
  sphere: () => new SphereGeometry(0.5, 14, 10),
  ico: () => new IcosahedronGeometry(0.5, 0),
  cone: () => new ConeGeometry(0.5, 1, 7),
  prism: () => new CylinderGeometry(0.5, 0.5, 1, 3),
};

type FinishSpec = { cast: boolean; receive: boolean; material: () => Material };

const FINISH: Record<Finish, FinishSpec> = {
  matte: { cast: true, receive: true, material: () => new MeshStandardMaterial({ roughness: 0.85 }) },
  foliage: { cast: true, receive: true, material: () => new MeshStandardMaterial({ roughness: 0.9, flatShading: true }) },
  decal: { cast: false, receive: true, material: () => new MeshStandardMaterial({ roughness: 1 }) },
  glass: {
    cast: false,
    receive: false,
    material: () => new MeshStandardMaterial({ roughness: 0.2, transparent: true, opacity: 0.35, depthWrite: false }),
  },
  ghost: {
    cast: false,
    receive: true,
    material: () => new MeshStandardMaterial({ roughness: 0.85, transparent: true, opacity: 0.45, depthWrite: false }),
  },
  screen: { cast: false, receive: false, material: () => new MeshBasicMaterial({ toneMapped: false }) },
};

export const nextCapacity = (n: number) => 2 ** Math.ceil(Math.log2(Math.max(16, n)));

function InstancedBatch({ shape, finish, parts }: { shape: Shape; finish: Finish; parts: Part[] }) {
  const ref = useRef<InstancedMesh>(null);
  const geometry = useMemo(() => GEOMETRY[shape](), [shape]);
  const material = useMemo(() => FINISH[finish].material(), [finish]);
  const capacity = nextCapacity(parts.length);

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new Matrix4();
    const q = new Quaternion();
    const e = new Euler(0, 0, 0, "YXZ");
    const p = new Vector3();
    const s = new Vector3();
    const c = new Color();
    parts.forEach((part, i) => {
      const r = part.rotation ?? [0, 0, 0];
      e.set(r[0], r[1], r[2], "YXZ");
      q.setFromEuler(e);
      m.compose(p.set(...part.position), q, s.set(...part.scale));
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, c.set(part.color));
    });
    mesh.count = parts.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [parts, capacity]);

  const spec = FINISH[finish];
  return <instancedMesh key={capacity} ref={ref} args={[geometry, material, capacity]} castShadow={spec.cast} receiveShadow={spec.receive} />;
}

/** Draws all parts with one instanced mesh per (shape, finish) pair. */
export function Batches({ parts }: { parts: Part[] }) {
  const groups = useMemo(() => {
    const map = new Map<string, { shape: Shape; finish: Finish; parts: Part[] }>();
    for (const part of parts) {
      const finish = part.finish ?? "matte";
      const key = `${part.shape}:${finish}`;
      let g = map.get(key);
      if (!g) map.set(key, (g = { shape: part.shape, finish, parts: [] }));
      g.parts.push(part);
    }
    return [...map.entries()];
  }, [parts]);

  return (
    <>
      {groups.map(([key, g]) => (
        <InstancedBatch key={key} shape={g.shape} finish={g.finish} parts={g.parts} />
      ))}
    </>
  );
}
