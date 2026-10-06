import type { AgentState } from "@/lib/api";
import { DIM, type SiteLayout, rectCenter, rectSize } from "@/scene/layout";
import { PALETTE, carColor } from "@/scene/palette";
import { isPresent } from "@/store/useWorldStore";
import { Car } from "./Car";
import { Block } from "./parts/Block";
import { Label } from "./parts/Label";

const LINE = 0.08;
const DASH = 2;
const BARRIER_STRIPES = 6;

type Props = { site: SiteLayout; agents: AgentState[]; preview: boolean };

export function Parking({ site, agents, preview }: Props) {
  const [rx, rz] = rectCenter(site.road);
  const [rw, rd] = rectSize(site.road);
  const [lx, lz] = rectCenter(site.lot);
  const [lw, ld] = rectSize(site.lot);
  const { spotW, spotD } = DIM.parking;
  const dashes = Math.floor(rw / (DASH * 2));
  const [bx, , bz] = site.barrier.post;
  const stripe = site.barrier.length / BARRIER_STRIPES;

  return (
    <group>
      <Block position={[rx, 0.01, rz]} size={[rw, 0.02, rd]} color={PALETTE.road} castShadow={false} />
      {Array.from({ length: dashes }, (_, i) => (
        <Block
          key={i}
          position={[site.road.x0 + DASH * (2 * i + 1), 0.025, rz]}
          size={[DASH, 0.01, 0.14]}
          color={PALETTE.roadLine}
          castShadow={false}
        />
      ))}

      <Block position={[lx, 0.015, lz]} size={[lw, 0.03, ld]} color={PALETTE.asphalt} castShadow={false} />
      <Block position={[lx, 0.06, site.lot.z0]} size={[lw, 0.12, 0.2]} color={PALETTE.curb} />
      <Block position={[site.lot.x1, 0.06, lz]} size={[0.2, 0.12, ld]} color={PALETTE.curb} />

      {site.spots.map((spot) => {
        const [x, , z] = spot.center;
        const color = spot.director ? PALETTE.accent : PALETTE.roadLine;
        return (
          <group key={spot.index}>
            {[-1, 1].map((side) => (
              <Block
                key={side}
                position={[x + (side * spotW) / 2, 0.035, z]}
                size={[LINE, 0.01, spotD]}
                color={color}
                castShadow={false}
              />
            ))}
            {spot.director && (
              <Label
                text="DIRECTOR"
                position={[x, 0.045, z + spotD / 2 - 0.7]}
                rotation={[-Math.PI / 2, 0, 0]}
                size={0.36}
                color={PALETTE.accent}
              />
            )}
          </group>
        );
      })}

      <Block position={[bx, 0.5, bz]} size={[0.32, 1, 0.32]} color={PALETTE.dark} />
      {Array.from({ length: BARRIER_STRIPES }, (_, i) => (
        <Block
          key={i}
          position={[bx + 0.16 + stripe * (i + 0.5), 0.92, bz]}
          size={[stripe, 0.09, 0.09]}
          color={i % 2 === 0 ? PALETTE.accent : "#ffffff"}
        />
      ))}

      {agents.map((agent, i) => {
        const spot = site.spots[i + 1];
        if (!spot || !isPresent(agent, preview)) return null;
        return <Car key={agent.id} position={spot.center} color={carColor(agent.role_key)} />;
      })}
    </group>
  );
}
