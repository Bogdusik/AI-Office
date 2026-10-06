"use client";

import { useEffect, useMemo } from "react";
import { BoxGeometry, type BufferGeometry } from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { Box, Wall } from "@/scene/layout";
import { PALETTE } from "@/scene/palette";
import { Fade } from "./Fade";

function mergeBoxes(boxes: Box[]): BufferGeometry | null {
  if (boxes.length === 0) return null;
  const pieces = boxes.map((b) => {
    const g = new BoxGeometry(...b.size);
    if (b.rotation) g.rotateX(b.rotation[0]).rotateY(b.rotation[1]).rotateZ(b.rotation[2]);
    return g.translate(...b.position);
  });
  const merged = mergeGeometries(pieces);
  for (const p of pieces) p.dispose();
  return merged;
}

/** One wall = one opaque mesh + one glass mesh, faded together when the wall faces the camera. */
function WallView({ wall }: { wall: Wall }) {
  const solid = useMemo(() => mergeBoxes(wall.solid), [wall.solid]);
  const glass = useMemo(() => mergeBoxes(wall.glass), [wall.glass]);
  useEffect(
    () => () => {
      solid?.dispose();
      glass?.dispose();
    },
    [solid, glass],
  );

  return (
    <Fade normal={wall.normal}>
      {solid && (
        <mesh geometry={solid} castShadow receiveShadow>
          <meshStandardMaterial color={wall.solidColor} roughness={0.85} />
        </mesh>
      )}
      {glass && (
        <mesh geometry={glass}>
          <meshStandardMaterial color={PALETTE.glass} roughness={0.2} transparent opacity={0.35} depthWrite={false} />
        </mesh>
      )}
    </Fade>
  );
}

export function Walls({ walls }: { walls: Wall[] }) {
  return (
    <>
      {walls.map((w) => (
        <WallView key={w.key} wall={w} />
      ))}
    </>
  );
}
