"use client";

import { OrbitControls, OrthographicCamera } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { type ComponentRef, useEffect, useRef } from "react";
import type { Camera } from "three";
import { CAMERA, type CameraHome } from "@/scene/layout";
import { useUiStore } from "@/store/useUiStore";

/** Places the camera imperatively on mount and on "home" — never from props, so polling can't move it. */
export function CameraRig({ home }: { home: CameraHome }) {
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const camera = useThree((s) => s.camera);
  const homeRequest = useUiStore((s) => s.homeRequest);
  const homeRef = useRef(home);
  const placedFor = useRef<{ camera: Camera | null; request: number }>({ camera: null, request: -1 });

  useEffect(() => {
    homeRef.current = home;
  }, [home]);

  useEffect(() => {
    const ctl = controls.current;
    if (!ctl) return;
    const placed = placedFor.current;
    if (placed.camera === ctl.object && placed.request === homeRequest) return;

    const h = homeRef.current;
    const cam = ctl.object;
    cam.position.set(...h.position);
    if ("zoom" in cam) {
      cam.zoom = h.zoom;
      cam.updateProjectionMatrix();
    }
    ctl.target.set(...h.target);
    ctl.update();
    placedFor.current = { camera: cam, request: homeRequest };
  }, [camera, homeRequest]);

  return (
    <>
      <OrthographicCamera makeDefault near={-200} far={400} />
      <OrbitControls
        ref={controls}
        makeDefault
        enableDamping
        enablePan={false}
        zoomToCursor
        minZoom={home.minZoom}
        maxZoom={home.maxZoom}
        minPolarAngle={CAMERA.minPolar}
        maxPolarAngle={CAMERA.maxPolar}
        minAzimuthAngle={CAMERA.azimuth - CAMERA.azimuthRange}
        maxAzimuthAngle={CAMERA.azimuth + CAMERA.azimuthRange}
      />
    </>
  );
}
