"use client";

import { Canvas, useThree } from "@react-three/fiber";
import { Suspense, useMemo } from "react";
import type { WorldState } from "@/lib/api";
import { cameraHome, rectCenter, rectSize } from "@/scene/layout";
import { PALETTE } from "@/scene/palette";
import { useWorldStore } from "@/store/useWorldStore";
import { Building, useSiteLayout } from "./Building";
import { CameraRig } from "./CameraRig";

const SUN_DIRECTION: [number, number, number] = [-0.45, 1, 0.65];
const SUN_DISTANCE = 120;
const GROUND_SIZE = 4000;

function World({ world }: { world: WorldState }) {
  const { building, site } = useSiteLayout(world);
  const viewport = useThree((s) => s.size);
  const home = useMemo(() => cameraHome(building, site, viewport), [building, site, viewport]);
  const [cx, cz] = rectCenter(site.focus);
  const [w, d] = rectSize(site.focus);
  const half = Math.max(w, d) * 0.7;

  return (
    <>
      <CameraRig home={home} />
      <hemisphereLight args={["#fffdf8", "#e9e2d6", 2.2]} />
      <directionalLight
        position={[cx + SUN_DIRECTION[0] * SUN_DISTANCE, SUN_DIRECTION[1] * SUN_DISTANCE, cz + SUN_DIRECTION[2] * SUN_DISTANCE]}
        target-position={[cx, 0, cz]}
        intensity={1.2}
        castShadow
        shadow-mapSize={[4096, 4096]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.04}
        shadow-radius={6}
        shadow-camera-left={-half}
        shadow-camera-right={half}
        shadow-camera-top={half}
        shadow-camera-bottom={-half}
        shadow-camera-near={1}
        shadow-camera-far={SUN_DISTANCE * 2.5}
      />
      <mesh rotation-x={-Math.PI / 2} position={[cx, 0, cz]} receiveShadow>
        <planeGeometry args={[GROUND_SIZE, GROUND_SIZE]} />
        <meshStandardMaterial color={PALETTE.ground} roughness={1} />
      </mesh>
      <Suspense fallback={null}>
        <Building world={world} />
      </Suspense>
    </>
  );
}

export function OfficeScene() {
  const world = useWorldStore((s) => s.world);

  return (
    <Canvas
      flat
      shadows="percentage"
      className="absolute inset-0"
      gl={{ antialias: true }}
      dpr={[1, 2]}
      onContextMenu={(e) => e.preventDefault()}
    >
      <color attach="background" args={[PALETTE.sky]} />
      {world && <World world={world} />}
    </Canvas>
  );
}
