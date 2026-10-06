"use client";

import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { type Group, MathUtils, type Mesh, type MeshStandardMaterial } from "three";
import { FADE, type Part, roofOpacity } from "@/scene/layout";
import { Batches } from "./Batches";

/** Roof parts fade in only when the camera is zoomed well out; at the home zoom the roof is invisible. */
export function Roof({ parts, homeZoom }: { parts: Part[]; homeZoom: number }) {
  const group = useRef<Group>(null);
  const current = useRef<number | null>(null);

  useFrame((state, delta) => {
    const g = group.current;
    if (!g) return;
    const target = roofOpacity(state.camera.zoom, homeZoom);
    const next = current.current === null ? target : MathUtils.damp(current.current, target, FADE.lambda, delta);
    current.current = next;
    g.visible = next > 0.01;
    if (!g.visible) return;
    g.traverse((obj) => {
      const mesh = obj as Mesh;
      if (!mesh.isMesh) return;
      const mat = mesh.material as MeshStandardMaterial;
      const transparent = next < 0.999;
      if (mat.transparent !== transparent) {
        mat.transparent = transparent;
        mat.needsUpdate = true;
      }
      mat.opacity = next;
      mat.depthWrite = !transparent;
      mesh.castShadow = next > 0.5;
    });
  });

  return (
    <group ref={group} visible={false}>
      <Batches parts={parts} />
    </group>
  );
}
