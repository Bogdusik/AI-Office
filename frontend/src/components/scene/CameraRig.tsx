"use client";

import { CameraControls, CameraControlsImpl, OrthographicCamera } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { Box3, type Camera, Vector3 } from "three";
import { CAMERA, type CameraHome, type Pick } from "@/scene/layout";
import { useUiStore } from "@/store/useUiStore";
import { followPoint } from "./motion/Motion";

const { ACTION } = CameraControlsImpl;

/**
 * Left drag rotates (full 360°, polar clamped), right drag pans inside a boundary box,
 * wheel zooms smoothly towards the cursor. The camera is placed imperatively on mount and on "home",
 * never from props, so polling and data changes can't move it. A focus request keeps the viewing angle and
 * glides the orbit target to the picked object once it is on screen (its floor may only just have been shown).
 */
export function CameraRig({ home, picks }: { home: CameraHome; picks: Pick[] }) {
  const controls = useRef<CameraControlsImpl>(null);
  const camera = useThree((s) => s.camera);
  const homeRequest = useUiStore((s) => s.homeRequest);
  const focus = useUiStore((s) => s.focus);
  const focused = useRef(0);
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

  useEffect(() => {
    const ctl = controls.current;
    if (!ctl || !focus || focus.nonce === focused.current) return;
    const pick = picks.find((p) => p.key === focus.key);
    if (!pick) return;
    focused.current = focus.nonce;
    const target = ctl.getTarget(new Vector3());
    const offset = ctl.getPosition(new Vector3()).sub(target);
    const [x, y, z] = pick.focus;
    void ctl.setLookAt(x + offset.x, y + offset.y, z + offset.z, x, y, z, true);
    void ctl.zoomTo(Math.max(ctl.camera.zoom, homeRef.current.zoom * CAMERA.focusZoom), true);
  }, [focus, picks]);

  const follow = useUiStore((s) => s.follow);
  useEffect(() => {
    const ctl = controls.current;
    if (ctl && follow !== null) void ctl.zoomTo(Math.max(ctl.camera.zoom, homeRef.current.zoom * CAMERA.focusZoom), true);
  }, [follow]);

  // «Follow»: the orbit target glides after the agent (or their car); at the desk it rests on the desk.
  useFrame(() => {
    const ctl = controls.current;
    const id = useUiStore.getState().follow;
    if (!ctl || id === null) return;
    if (followPoint.valid) {
      void ctl.moveTo(followPoint.position.x, followPoint.position.y, followPoint.position.z, true);
      return;
    }
    const pick = picks.find((p) => p.key === `agent:${id}`);
    if (pick) void ctl.moveTo(...pick.focus, true);
  });

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
