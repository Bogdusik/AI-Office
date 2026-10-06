"use client";

import { Canvas } from "@react-three/fiber";
import { OrbitControls, OrthographicCamera } from "@react-three/drei";

const ISO_DISTANCE = 20;

export function OfficeScene() {
  return (
    <Canvas shadows="percentage" className="absolute inset-0" gl={{ antialias: true }}>
      <color attach="background" args={["#14161f"]} />
      <OrthographicCamera
        makeDefault
        position={[ISO_DISTANCE, ISO_DISTANCE, ISO_DISTANCE]}
        zoom={60}
        near={0.1}
        far={200}
      />
      <hemisphereLight args={["#fff4e0", "#2a2f45", 0.9]} />
      <directionalLight
        position={[8, 14, 6]}
        intensity={1.4}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-10}
        shadow-camera-right={10}
        shadow-camera-top={10}
        shadow-camera-bottom={-10}
      />
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[20, 20]} />
        <meshStandardMaterial color="#d9d2c3" />
      </mesh>
      <mesh position={[0, 0.5, 0]} castShadow>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#ff8a3d" />
      </mesh>
      <OrbitControls
        makeDefault
        target={[0, 0, 0]}
        enableDamping
        minZoom={20}
        maxZoom={200}
        maxPolarAngle={Math.PI / 2.2}
      />
    </Canvas>
  );
}
