"use client";

import { useFrame } from "@react-three/fiber";
import { type ReactNode, useMemo, useRef } from "react";
import { type Group, MathUtils, type Mesh, type MeshStandardMaterial, Vector3 } from "three";
import { FADE, facadeOpacity } from "@/scene/layout";

function applyOpacity(group: Group, k: number) {
  group.traverse((obj) => {
    const mesh = obj as Mesh;
    if (!mesh.isMesh) return;
    const mat = mesh.material as MeshStandardMaterial;
    if (mat.userData.baseOpacity === undefined) mat.userData.baseOpacity = mat.opacity;
    if (mesh.userData.baseCast === undefined) mesh.userData.baseCast = mesh.castShadow;
    const opacity = mat.userData.baseOpacity * k;
    const transparent = opacity < 0.999;
    if (mat.transparent !== transparent) {
      mat.transparent = transparent;
      mat.needsUpdate = true;
    }
    mat.opacity = opacity;
    mat.depthWrite = !transparent;
    mesh.castShadow = mesh.userData.baseCast && k > 0.5;
  });
}

/**
 * Fades its children when their outward normal points at the camera (they would hide the interior).
 * Opacity follows a smooth function of the view angle and is damped over time, so there is no flicker.
 */
export function Fade({ normal, children }: { normal: [number, number]; children: ReactNode }) {
  const group = useRef<Group>(null);
  const current = useRef<number | null>(null);
  const dir = useMemo(() => new Vector3(), []);

  useFrame((state, delta) => {
    const g = group.current;
    if (!g) return;
    state.camera.getWorldDirection(dir);
    const len = Math.hypot(dir.x, dir.z) || 1;
    const target = facadeOpacity(normal, [-dir.x / len, -dir.z / len]);
    const next = current.current === null ? target : MathUtils.damp(current.current, target, FADE.lambda, delta);
    current.current = next;
    applyOpacity(g, next);
  });

  return <group ref={group}>{children}</group>;
}
