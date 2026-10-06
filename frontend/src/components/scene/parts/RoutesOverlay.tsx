"use client";

import { Line } from "@react-three/drei";
import type { Routes, Vec3 } from "@/scene/layout";

const COLORS = { arrive: "#2f7fd8", toSpot: "#2fbf83", fromSpot: "#e0a43a", depart: "#d8452f" } as const;
const lifted = (points: Vec3[], y: number) => points.map(([x, , z]) => [x, y, z] as Vec3);

/** Debug view of the car route graph (`?routes=1`). */
export function RoutesOverlay({ routes }: { routes: Routes }) {
  const lines: { key: string; points: Vec3[]; color: string; y: number }[] = [
    ...Object.entries(routes.arrive).map(([k, p]) => ({ key: `a-${k}`, points: p, color: COLORS.arrive, y: 0.3 })),
    ...routes.toSpot.map((p, i) => ({ key: `t-${i}`, points: p, color: COLORS.toSpot, y: 0.4 })),
    ...routes.fromSpot.map((p, i) => ({ key: `f-${i}`, points: p, color: COLORS.fromSpot, y: 0.5 })),
    ...Object.entries(routes.depart).map(([k, p]) => ({ key: `d-${k}`, points: p, color: COLORS.depart, y: 0.6 })),
  ];
  return (
    <>
      {lines.map((l) => (
        <Line key={l.key} points={lifted(l.points, l.y)} color={l.color} lineWidth={2.5} />
      ))}
    </>
  );
}
