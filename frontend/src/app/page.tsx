import { Suspense } from "react";
import { ApiStatus } from "@/components/hud/ApiStatus";
import { Controls, PreviewBadge, WorldError } from "@/components/hud/Controls";
import { Hotkeys } from "@/components/hud/Hotkeys";
import { WorldSync } from "@/components/hud/WorldSync";
import { DirectorPanel } from "@/components/panels/DirectorPanel";
import { RightPanel } from "@/components/panels/RightPanel";
import { SceneLoader } from "@/components/scene/SceneLoader";

export default function Home() {
  return (
    <main className="relative h-dvh w-screen">
      <Suspense fallback={null}>
        <WorldSync />
      </Suspense>
      <Hotkeys />
      <SceneLoader />
      <div className="pointer-events-none absolute top-4 left-4 select-none">
        <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-ink/45">Local HQ</p>
        <h1 className="text-lg font-semibold tracking-tight text-ink">AI Office</h1>
      </div>
      <PreviewBadge />
      <ApiStatus />
      <Controls />
      <WorldError />
      <RightPanel />
      <DirectorPanel />
    </main>
  );
}
