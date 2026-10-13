"use client";

import { useThree } from "@react-three/fiber";
import { useEffect } from "react";
import { nextFrame } from "@/lib/frameRate";
import { useUiStore } from "@/store/useUiStore";

/**
 * The canvas draws on demand (`frameloop="demand"`); this asks for frames at the chosen rate and stops while the
 * page is hidden, so the scene leaves the graphics card to the model. Motion is a function of time, so a lower
 * rate only makes it less smooth, never slower.
 */
export function FrameDriver() {
  const invalidate = useThree((s) => s.invalidate);
  const fps = useUiStore((s) => s.fps);

  useEffect(() => {
    let last = -Infinity;
    let raf = requestAnimationFrame(function loop(now) {
      raf = requestAnimationFrame(loop);
      const frame = nextFrame(now, last, fps, document.hidden);
      if (frame !== null) {
        last = frame;
        invalidate();
      }
    });
    const wake = () => {
      if (!document.hidden) invalidate();
    };
    document.addEventListener("visibilitychange", wake);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [fps, invalidate]);

  return null;
}
