"use client";

import { useThree } from "@react-three/fiber";
import { useEffect } from "react";
import { Vector3 } from "three";
import type { Pick } from "@/scene/layout";

declare global {
  interface Window {
    __aiOffice?: { screenOf: (key: string) => { x: number; y: number } | null; keys: () => string[] };
  }
}

/** Dev-only hook for browser tests: page coordinates of a pickable object, so tests click it with a real mouse. */
export function DevProbe({ picks }: { picks: Pick[] }) {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);

  useEffect(() => {
    window.__aiOffice = {
      keys: () => picks.map((p) => p.key),
      screenOf: (key) => {
        const pick = picks.find((p) => p.key === key);
        if (!pick) return null;
        const v = new Vector3(...pick.box.position).project(camera);
        const r = gl.domElement.getBoundingClientRect();
        return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
      },
    };
    return () => {
      delete window.__aiOffice;
    };
  }, [picks, camera, gl]);

  return null;
}
