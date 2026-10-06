import { DIM, type ParkingSpot, type SiteLayout, rectCenter, rectSize } from "@/scene/layout";
import { PALETTE } from "@/scene/palette";
import { Car } from "./Car";
import { Block } from "./parts/Block";
import { Label } from "./parts/Label";

const LINE = 0.09;
const DASH = 2;
const BARRIER_STRIPES = 7;

export type ParkedCar = { spot: number; color: string; key: number };

function SpotMarking({ spot }: { spot: ParkingSpot }) {
  const { spotW, spotD } = DIM.parking;
  const [x, , z] = spot.center;
  const color = spot.kind === "director" ? PALETTE.accent : PALETTE.roadLine;
  const label = spot.kind === "director" ? "DIRECTOR" : spot.kind === "guest" ? "GUEST" : null;
  const toAisle = spot.yaw === 0 ? 1 : -1;
  return (
    <group>
      {[-1, 1].map((side) => (
        <Block key={side} position={[x + (side * spotW) / 2, 0.035, z]} size={[LINE, 0.01, spotD]} color={color} castShadow={false} />
      ))}
      {label && (
        <Label
          text={label}
          position={[x, 0.045, z + toAisle * (spotD / 2 - 0.8)]}
          rotation={[-Math.PI / 2, 0, 0]}
          size={0.4}
          color={spot.kind === "director" ? PALETTE.accent : PALETTE.dark}
        />
      )}
    </group>
  );
}

export function Parking({ site, cars }: { site: SiteLayout; cars: ParkedCar[] }) {
  const [rx, rz] = rectCenter(site.road);
  const [rw, rd] = rectSize(site.road);
  const [lx, lz] = rectCenter(site.lot);
  const [lw, ld] = rectSize(site.lot);
  const [ix, iz] = rectCenter(site.island);
  const [iw, id] = rectSize(site.island);
  const dashes = Math.floor(rw / (DASH * 2));

  return (
    <group>
      <Block position={[rx, 0.01, rz]} size={[rw, 0.02, rd]} color={PALETTE.road} castShadow={false} />
      {Array.from({ length: dashes }, (_, i) => (
        <Block
          key={i}
          position={[site.road.x0 + DASH * (2 * i + 1), 0.025, rz]}
          size={[DASH, 0.01, 0.16]}
          color={PALETTE.roadLine}
          castShadow={false}
        />
      ))}

      <Block position={[lx, 0.015, lz]} size={[lw, 0.03, ld]} color={PALETTE.asphalt} castShadow={false} />
      <Block position={[lx, 0.07, site.lot.z0]} size={[lw, 0.14, 0.25]} color={PALETTE.curb} />
      <Block position={[site.lot.x1, 0.07, lz]} size={[0.25, 0.14, ld]} color={PALETTE.curb} />
      <Block position={[ix, 0.08, iz]} size={[iw, 0.16, id]} color={PALETTE.curb} />

      {site.spots.map((spot) => (
        <SpotMarking key={spot.index} spot={spot} />
      ))}

      {site.arrows.map((a, i) => (
        <group key={i} position={a.position} rotation-y={a.yaw}>
          <Block position={[0, 0, 0.6]} size={[0.28, 0.01, 1.6]} color={PALETTE.roadLine} castShadow={false} />
          <mesh position={[0, 0.005, -0.45]} rotation-x={-Math.PI / 2} rotation-z={Math.PI / 2}>
            <circleGeometry args={[0.6, 3]} />
            <meshStandardMaterial color={PALETTE.roadLine} roughness={0.9} />
          </mesh>
        </group>
      ))}

      {site.barriers.map((b, bi) => {
        const stripe = b.length / BARRIER_STRIPES;
        return (
          <group key={bi} position={b.post}>
            <Block position={[0, 0.55, 0]} size={[0.36, 1.1, 0.36]} color={PALETTE.dark} />
            {Array.from({ length: BARRIER_STRIPES }, (_, i) => (
              <Block
                key={i}
                position={[b.direction * (0.18 + stripe * (i + 0.5)), 0.98, 0]}
                size={[stripe, 0.1, 0.1]}
                color={i % 2 === 0 ? PALETTE.accent : "#ffffff"}
              />
            ))}
          </group>
        );
      })}

      {cars.map((c) => {
        const spot = site.spots[c.spot];
        return spot ? <Car key={c.key} at={{ position: spot.center, yaw: spot.yaw }} color={c.color} /> : null;
      })}
    </group>
  );
}
