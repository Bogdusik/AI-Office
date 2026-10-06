import type { AgentState } from "@/lib/api";
import { DIM, deskTransform } from "@/scene/layout";
import { PALETTE, outfitColor } from "@/scene/palette";
import { AgentFigure } from "./AgentFigure";
import { FaceCamera } from "./parts/FaceCamera";
import { Block } from "./parts/Block";
import { Label } from "./parts/Label";

type Props = { deskIndex: number; agent: AgentState | undefined; present: boolean };

export function Workstation({ deskIndex, agent, present }: Props) {
  const t = deskTransform(deskIndex);
  const { w, d, h } = DIM.desk;
  const { w: pw, h: ph } = DIM.plaque;
  const occupied = agent !== undefined;
  const fade = occupied ? 1 : 0.45;
  const top = occupied ? PALETTE.deskTop : PALETTE.free;
  const frame = occupied ? PALETTE.wood : PALETTE.free;
  const seatColor = occupied ? PALETTE.chair : PALETTE.free;
  const [dx, , dz] = t.desk;
  const [mx, my, mz] = t.monitor;
  const [cx, cy, cz] = t.chair;

  return (
    <group>
      <Block position={[dx, h - 0.03, dz]} size={[w, 0.06, d]} color={top} opacity={fade} />
      {[-1, 1].map((side) => (
        <Block
          key={side}
          position={[dx + side * (w / 2 - 0.05), (h - 0.06) / 2, dz]}
          size={[0.06, h - 0.06, d * 0.9]}
          color={frame}
          opacity={fade}
        />
      ))}

      <Block position={[mx, my + 0.09, mz]} size={[0.07, 0.18, 0.07]} color={PALETTE.metal} opacity={fade} />
      <Block position={[mx, my + 0.36, mz]} size={[0.66, 0.4, 0.04]} color={PALETTE.dark} opacity={fade} />
      {occupied && (
        <Block
          position={[mx, my + 0.36, mz + 0.022]}
          size={[0.6, 0.34, 0.005]}
          color={present ? PALETTE.screenOn : PALETTE.screen}
          emissive={present ? PALETTE.screenOn : undefined}
          castShadow={false}
        />
      )}

      <Block position={[cx, cy + 0.22, cz]} size={[0.06, 0.44, 0.06]} color={PALETTE.metal} opacity={fade} />
      <Block position={[cx, cy + DIM.chair.seat - 0.04, cz]} size={[0.5, 0.08, 0.48]} color={seatColor} opacity={fade} />
      <Block position={[cx, cy + DIM.chair.seat + 0.3, cz + 0.22]} size={[0.5, 0.52, 0.06]} color={seatColor} opacity={fade} />

      {occupied && (
        <group position={t.plaque}>
          <Block position={[0, ph / 2 + 0.35, 0]} size={[0.03, 0.7, 0.03]} color={PALETTE.metal} castShadow={false} />
          <FaceCamera>
            <Block position={[0, 0, 0]} size={[pw, ph, 0.05]} color={PALETTE.plaque} />
            <Block position={[-pw / 2 + 0.05, 0, 0.027]} size={[0.1, ph, 0.005]} color={PALETTE.dark} castShadow={false} />
            <Label text={agent.title} position={[0.05, 0, 0.03]} size={DIM.plaque.font} maxWidth={pw - 0.35} color={PALETTE.plaqueText} />
          </FaceCamera>
        </group>
      )}

      {occupied && present && <AgentFigure position={t.seat} outfit={outfitColor(agent.role_key)} />}
    </group>
  );
}
