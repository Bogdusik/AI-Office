"use client";

import { addAfterEffect, addEffect, useThree } from "@react-three/fiber";
import { useEffect } from "react";
import { Vector3 } from "three";
import type { Pick } from "@/scene/layout";

declare global {
  interface Window {
    __aiOffice?: {
      screenOf: (key: string) => { x: number; y: number } | null;
      keys: () => string[];
      /** Frame work (update + render submit, ms) and frame-to-frame intervals collected since the last call. */
      frames: () => { work: number[]; interval: number[] };
      /** Points the camera at a world position with a zoom factor relative to the current one (for screenshots). */
      view: (target: [number, number, number], zoom: number) => void;
    };
  }
}

/** Dev-only hook for browser tests: page coordinates of a pickable object, so tests click it with a real mouse. */
export function DevProbe({ picks }: { picks: Pick[] }) {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const controls = useThree((s) => s.controls) as unknown as { getPosition: (v: Vector3) => Vector3; getTarget: (v: Vector3) => Vector3; setLookAt: (...a: (number | boolean)[]) => Promise<void>; zoomTo: (z: number, smooth: boolean) => Promise<void> } | null;

  useEffect(() => {
    let start = 0;
    let last = 0;
    let work: number[] = [];
    let interval: number[] = [];
    const before = addEffect((t) => {
      if (last) interval.push(t - last);
      last = t;
      start = performance.now();
    });
    const after = addAfterEffect(() => {
      work.push(performance.now() - start);
      if (work.length > 2000) [work, interval] = [work.slice(-1000), interval.slice(-1000)];
    });
    window.__aiOffice = {
      view: ([x, y, z], zoom) => {
        if (!controls) return;
        const offset = controls.getPosition(new Vector3()).sub(controls.getTarget(new Vector3()));
        void controls.setLookAt(x + offset.x, y + offset.y, z + offset.z, x, y, z, false);
        void controls.zoomTo(camera.zoom * zoom, false);
      },
      frames: () => {
        const out = { work, interval };
        [work, interval] = [[], []];
        return out;
      },
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
      before();
      after();
      delete window.__aiOffice;
    };
  }, [picks, camera, gl, controls]);

  return null;
}
