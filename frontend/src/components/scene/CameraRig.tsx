"use client";

import { CameraControls, CameraControlsImpl, OrthographicCamera } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { Box3, type Camera, Vector3 } from "three";
import { CAMERA, type CameraHome } from "@/scene/layout";
import { useUiStore } from "@/store/useUiStore";

const { ACTION } = CameraControlsImpl;

/**
 * Left drag rotates (full 360°, polar clamped), right drag pans inside a boundary box,
 * wheel zooms smoothly towards the cursor. The camera is placed imperatively on mount and on "home",
 * never from props, so polling and data changes can't move it.
 */
export function CameraRig({ home }: { home: CameraHome }) {
  const controls = useRef<CameraControlsImpl>(null);
  const camera = useThree((s) => s.camera);
  const homeRequest = useUiStore((s) => s.homeRequest);
  const homeRef = useRef(home);
  const placed = useRef<{ camera: Camera | null; request: number }>({ camera: null, request: -1 });

  const boundary = useMemo(
    () => new Box3(new Vector3(...home.boundary.min), new Vector3(...home.boundary.max)),
    [home.boundary],
  );

  useEffect(() => {
    homeRef.current = home;
  }, [home]);

  useEffect(() => {
    controls.current?.setBoundary(boundary);
  }, [boundary, camera]);

  useEffect(() => {
    const ctl = controls.current;
    if (!ctl) return;
    const last = placed.current;
    const sameCamera = last.camera === ctl.camera;
    if (sameCamera && last.request === homeRequest) return;
    const animate = sameCamera;
    const h = homeRef.current;
    void ctl.setLookAt(...h.position, ...h.target, animate);
    void ctl.zoomTo(h.zoom, animate);
    placed.current = { camera: ctl.camera, request: homeRequest };
  }, [camera, homeRequest]);

  return (
    <>
      <OrthographicCamera makeDefault near={-500} far={2000} />
      <CameraControls
        ref={controls}
        makeDefault
        minPolarAngle={CAMERA.minPolar}
        maxPolarAngle={CAMERA.maxPolar}
        minZoom={home.minZoom}
        maxZoom={home.maxZoom}
        dollyToCursor
        smoothTime={CAMERA.smoothTime}
        draggingSmoothTime={CAMERA.draggingSmoothTime}
        boundaryFriction={0.2}
        mouseButtons={{ left: ACTION.ROTATE, right: ACTION.TRUCK, middle: ACTION.NONE, wheel: ACTION.ZOOM }}
        touches={{ one: ACTION.TOUCH_ROTATE, two: ACTION.TOUCH_ZOOM_TRUCK, three: ACTION.TOUCH_TRUCK }}
      />
    </>
  );
}
