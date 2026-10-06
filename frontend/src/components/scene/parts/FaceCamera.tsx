"use client";

import { useFrame } from "@react-three/fiber";
import { type ReactNode, useMemo, useRef } from "react";
import { type Group, Vector3 } from "three";

/**
 * Turns its children around the vertical axis to face the camera (yaw only, so text stays upright).
 * Unlike drei's Billboard with locked axes, it doesn't flip when the camera is behind.
 */
export function FaceCamera({ children }: { children: ReactNode }) {
  const group = useRef<Group>(null);
  const dir = useMemo(() => new Vector3(), []);

  useFrame(({ camera }) => {
    if (!group.current) return;
    camera.getWorldDirection(dir);
    group.current.rotation.y = Math.atan2(-dir.x, -dir.z);
  });

  return <group ref={group}>{children}</group>;
}
