import { type BuildingLayout, lobbyLayout, rectCenter, rectSize } from "@/scene/layout";
import { PALETTE } from "@/scene/palette";
import { Block } from "./parts/Block";
import { FaceCamera } from "./parts/FaceCamera";
import { Armchair, LowTable, OfficeChair, ReceptionDesk, Sofa } from "./parts/Furniture";
import { PottedPlant } from "./parts/Greenery";
import { Label } from "./parts/Label";

/** Ground-floor entrance hall: reception, waiting area, plants. Floor-local. */
export function Lobby({ building }: { building: BuildingLayout }) {
  const l = lobbyLayout(building);
  const [rx, rz] = rectCenter(l.rug);
  const [rw, rd] = rectSize(l.rug);

  return (
    <group>
      <ReceptionDesk at={l.reception} />
      <OfficeChair at={l.receptionChair} />
      <group position={l.sign}>
        <FaceCamera>
          <Label text="RECEPTION" position={[0, 0, 0]} size={0.22} color={PALETTE.dark} />
        </FaceCamera>
      </group>

      <Block position={[rx, 0.01, rz]} size={[rw, 0.02, rd]} color={PALETTE.rug} castShadow={false} />
      {l.sofas.map((s, i) => (
        <Sofa key={i} at={s} />
      ))}
      {l.armchairs.map((a, i) => (
        <Armchair key={i} at={a} />
      ))}
      <LowTable position={l.coffeeTable} />
      {l.plants.map((p, i) => (
        <PottedPlant key={i} position={p} scale={1.15} />
      ))}
    </group>
  );
}
