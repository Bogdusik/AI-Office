import { Text } from "@react-three/drei";
import { Suspense } from "react";
import type { Vec3 } from "@/scene/layout";

export const LABEL_FONT = "/fonts/Inter-SemiBold.woff";

type LabelProps = {
  text: string;
  position: Vec3;
  size: number;
  color: string;
  maxWidth?: number;
  rotation?: Vec3;
  anchorX?: "left" | "center" | "right";
};

/** Each label suspends on its own, so font loading never blocks the building from rendering. */
export function Label({ text, position, size, color, maxWidth, rotation, anchorX = "center" }: LabelProps) {
  return (
    <Suspense fallback={null}>
      <Text
        font={LABEL_FONT}
        position={position}
        rotation={rotation}
        fontSize={size}
        color={color}
        maxWidth={maxWidth}
        anchorX={anchorX}
        anchorY="middle"
        textAlign="center"
        lineHeight={1.1}
      >
        {text}
      </Text>
    </Suspense>
  );
}
