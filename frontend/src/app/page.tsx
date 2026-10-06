import { Suspense } from "react";
import { WorldError } from "@/components/hud/Controls";
import { Hotkeys } from "@/components/hud/Hotkeys";
import { Hud } from "@/components/hud/Hud";
import { WorldSync } from "@/components/hud/WorldSync";
import { DirectorPanel } from "@/components/panels/DirectorPanel";
import { RightPanel } from "@/components/panels/RightPanel";
import { SceneLoader } from "@/components/scene/SceneLoader";

export default function Home() {
  return (
    <main className="relative h-dvh w-screen overflow-hidden">
      <Suspense fallback={null}>
        <WorldSync />
      </Suspense>
      <Hotkeys />
      <SceneLoader />
      <Hud />
      <WorldError />
      <RightPanel />
      <DirectorPanel />
    </main>
  );
}
