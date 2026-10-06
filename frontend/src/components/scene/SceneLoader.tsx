"use client";

import dynamic from "next/dynamic";

const OfficeScene = dynamic(
  () => import("./OfficeScene").then((m) => m.OfficeScene),
  { ssr: false },
);

export function SceneLoader() {
  return <OfficeScene />;
}
