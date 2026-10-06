"use client";

import type { ThreeEvent } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { BoxGeometry, type InstancedMesh, Matrix4, MeshBasicMaterial, Quaternion, Vector3 } from "three";
import type { Pick } from "@/scene/layout";
import { useUiStore } from "@/store/useUiStore";
import { nextCapacity } from "./Batches";

/** A press that moved further than this (px) was a camera drag, not a click. */
const CLICK_SLOP = 4;

/** Invisible hit volumes over selectable objects: one instanced mesh, instanceId → pick. */
export function Picking({ picks }: { picks: Pick[] }) {
  const ref = useRef<InstancedMesh>(null);
  const geometry = useMemo(() => new BoxGeometry(1, 1, 1), []);
  const material = useMemo(() => new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false }), []);
  const capacity = nextCapacity(picks.length);
  const hovered = useUiStore((s) => s.hovered);
  const hover = useUiStore((s) => s.hover);
  const select = useUiStore((s) => s.select);
  const setDirectorOpen = useUiStore((s) => s.setDirectorOpen);

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
    const p = new Vector3();
    const s = new Vector3();
    picks.forEach((pick, i) => mesh.setMatrixAt(i, m.compose(p.set(...pick.box.position), q, s.set(...pick.box.size))));
    mesh.count = picks.length;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [picks, capacity]);

  useEffect(() => {
    if (hovered && !picks.some((p) => p.key === hovered)) hover(null);
  }, [picks, hovered, hover]);

  useEffect(() => {
    document.body.style.cursor = hovered ? "pointer" : "";
    return () => {
      document.body.style.cursor = "";
    };
  }, [hovered]);

  const at = (e: ThreeEvent<PointerEvent | MouseEvent>) => (e.instanceId === undefined ? undefined : picks[e.instanceId]);

  return (
    <instancedMesh
      key={capacity}
      ref={ref}
      args={[geometry, material, capacity]}
      onPointerMove={(e) => {
        e.stopPropagation();
        hover(at(e)?.key ?? null);
      }}
      onPointerOut={() => hover(null)}
      onClick={(e) => {
        const pick = at(e);
        if (!pick || e.delta > CLICK_SLOP) return;
        e.stopPropagation();
        select(pick.target);
        if (pick.target.kind === "director") setDirectorOpen(true);
      }}
    />
  );
}
