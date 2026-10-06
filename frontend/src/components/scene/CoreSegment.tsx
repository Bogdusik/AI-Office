import {
  DIM,
  type BuildingLayout,
  type CoreLayout,
  boxIn,
  rectCenter,
  rectSize,
  stairStorey,
  storeyHeight,
} from "@/scene/layout";
import { PALETTE } from "@/scene/palette";
import { FaceCamera } from "./parts/FaceCamera";
import { Block, Boxes } from "./parts/Block";
import { Fade } from "./parts/Fade";
import { Label } from "./parts/Label";

type Props = {
  building: BuildingLayout;
  core: CoreLayout;
  floorIndex: number;
  floorNumber: number;
  floorName: string;
  isTop: boolean;
};

/** One storey of the core, floor-local (y = 0 is the slab top): glass elevator shaft in front, stairs behind. */
export function CoreSegment({ building, core, floorIndex, floorNumber, floorName, isTop }: Props) {
  const h = storeyHeight(building, isTop);
  const { shaft, stairwell } = core;
  const [sx, sz] = rectCenter(shaft);
  const [sw, sd] = rectSize(shaft);
  const shaftH = h - DIM.slab;
  const stairs = isTop ? null : stairStorey(stairwell, building.pitch);
  const topLanding = boxIn({ ...stairwell, z0: stairwell.z1 - DIM.core.landing }, -DIM.slab, 0);

  return (
    <group>
      <Block position={[sx, -DIM.slab / 2, sz]} size={[sw + 0.3, DIM.slab, sd + 0.3]} color={PALETTE.core} />

      <Block position={[sx, shaftH / 2, sz]} size={[sw, shaftH, sd]} color={PALETTE.shaftGlass} opacity={0.3} />
      {[shaft.x0, shaft.x1].flatMap((x) =>
        [shaft.z0, shaft.z1].map((z) => (
          <Block key={`${x}:${z}`} position={[x, shaftH / 2, z]} size={[0.1, shaftH, 0.1]} color={PALETTE.steel} />
        )),
      )}
      <Block position={[sx, 0.05, sz]} size={[sw, 0.1, sd]} color={PALETTE.steel} />
      {floorIndex === 0 && (
        <group>
          <Block position={[sx, 1.2, sz]} size={[sw - 0.3, 2.4, sd - 0.3]} color={PALETTE.metal} opacity={0.85} />
          <Block position={[sx, 2.45, sz]} size={[sw - 0.25, 0.1, sd - 0.25]} color={PALETTE.steel} />
        </group>
      )}

      {stairs ? (
        <group>
          <Boxes boxes={stairs.steps} color={PALETTE.slabEdge} />
          <Boxes boxes={stairs.landings} color={PALETTE.core} />
          <Boxes boxes={stairs.rails} color={PALETTE.steel} castShadow={false} />
          <Boxes boxes={stairs.posts} color={PALETTE.steel} castShadow={false} />
        </group>
      ) : (
        <Block position={topLanding.position} size={topLanding.size} color={PALETTE.core} />
      )}

      {core.walls.map((wall) => {
        const b = boxIn(wall.box, -DIM.slab, h - DIM.slab);
        return (
          <Fade key={wall.key} normal={wall.normal}>
            <Block position={b.position} size={b.size} color={PALETTE.core} />
          </Fade>
        );
      })}

      <group position={core.sign}>
        <FaceCamera>
          <Block position={[0, 0, -0.03]} size={[0.95, 0.95, 0.05]} color={PALETTE.dark} castShadow={false} />
          <Label text={String(floorNumber)} position={[0, 0.03, 0]} size={0.56} color="#ffffff" />
          <Label text={floorName} position={[-0.65, 0, 0]} size={0.3} color={PALETTE.dark} anchorX="right" />
        </FaceCamera>
      </group>
    </group>
  );
}
