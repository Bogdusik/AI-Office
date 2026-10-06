import { ApiStatus } from "@/components/hud/ApiStatus";
import { SceneLoader } from "@/components/scene/SceneLoader";

export default function Home() {
  return (
    <main className="relative h-dvh w-screen">
      <SceneLoader />
      <ApiStatus />
    </main>
  );
}
