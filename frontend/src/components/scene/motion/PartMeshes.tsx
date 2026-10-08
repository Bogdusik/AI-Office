"use client";

import { useMemo } from "react";
import {
  type BufferGeometry,
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  Euler,
  IcosahedronGeometry,
  type Material,
  MeshBasicMaterial,
  MeshStandardMaterial,
  SphereGeometry,
} from "three";
import type { Finish, Part, Shape } from "@/scene/layout";

const GEOMETRY: Partial<Record<Shape, BufferGeometry>> = {};
const MATERIAL = new Map<string, Material>();

function geometry(shape: Shape): BufferGeometry {
  return (GEOMETRY[shape] ??= {
    box: () => new BoxGeometry(1, 1, 1),
    cylinder: () => new CylinderGeometry(0.5, 0.5, 1, 12),
    sphere: () => new SphereGeometry(0.5, 14, 10),
    ico: () => new IcosahedronGeometry(0.5, 0),
    cone: () => new ConeGeometry(0.5, 1, 7),
    prism: () => new CylinderGeometry(0.5, 0.5, 1, 3),
  }[shape]());
}

function material(color: string, finish: Finish): Material {
  const key = `${color}:${finish}`;
  let m = MATERIAL.get(key);
  if (!m) {
    if (finish === "screen") m = new MeshBasicMaterial({ color, toneMapped: false });
    else if (finish === "glass") m = new MeshStandardMaterial({ color, roughness: 0.2, transparent: true, opacity: 0.35, depthWrite: false });
    else m = new MeshStandardMaterial({ color, roughness: finish === "foliage" ? 0.9 : 0.85 });
    MATERIAL.set(key, m);
  }
  return m;
}

/** A handful of parts as plain meshes (shared geometries and materials) for objects that move every frame. */
export function PartMeshes({ parts }: { parts: Part[] }) {
  const meshes = useMemo(
    () =>
      parts.map((p) => {
        const r = p.rotation ?? [0, 0, 0];
        const finish = p.finish ?? "matte";
        return { p, rotation: new Euler(r[0], r[1], r[2], "YXZ"), finish };
      }),
    [parts],
  );
  return (
    <>
      {meshes.map(({ p, rotation, finish }, i) => (
        <mesh
          key={i}
          geometry={geometry(p.shape)}
          material={material(p.color, finish)}
          position={p.position}
          rotation={rotation}
          scale={p.scale}
          castShadow={finish === "matte" || finish === "foliage"}
          receiveShadow={finish !== "screen"}
        />
      ))}
    </>
  );
}
