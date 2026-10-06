import { DIM, type LabelSpec } from "@/scene/layout";
import { PALETTE } from "@/scene/palette";
import { FaceCamera } from "./FaceCamera";
import { Label } from "./Label";

function Board({ w, h, color, z = -0.03 }: { w: number; h: number; color: string; z?: number }) {
  return (
    <mesh position={[0, 0, z]} castShadow>
      <boxGeometry args={[w, h, 0.05]} />
      <meshStandardMaterial color={color} roughness={0.8} />
    </mesh>
  );
}

function Plaque({ text }: { text: string }) {
  const { w, h, font } = DIM.plaque;
  return (
    <>
      <mesh position={[0, h / 2 + 0.35, 0]}>
        <boxGeometry args={[0.03, 0.7, 0.03]} />
        <meshStandardMaterial color={PALETTE.metal} />
      </mesh>
      <FaceCamera>
        <Board w={w} h={h} color={PALETTE.plaque} z={0} />
        <mesh position={[-w / 2 + 0.05, 0, 0.027]}>
          <boxGeometry args={[0.1, h, 0.005]} />
          <meshStandardMaterial color={PALETTE.dark} />
        </mesh>
        <Label text={text} position={[0.05, 0, 0.03]} size={font} maxWidth={w - 0.35} color={PALETTE.plaqueText} />
      </FaceCamera>
    </>
  );
}

export function SceneLabels({ labels }: { labels: LabelSpec[] }) {
  return (
    <>
      {labels.map((l) => {
        switch (l.kind) {
          case "plaque":
            return (
              <group key={l.key} position={l.position}>
                <Plaque text={l.text} />
              </group>
            );
          case "floorSign":
            return (
              <group key={l.key} position={l.position}>
                <FaceCamera>
                  <Board w={0.95} h={0.95} color={PALETTE.dark} />
                  <Label text={String(l.number)} position={[0, 0.03, 0]} size={0.56} color="#ffffff" />
                  <Label text={l.name} position={[-0.65, 0, 0]} size={0.3} color={PALETTE.dark} anchorX="right" />
                </FaceCamera>
              </group>
            );
          case "sign": {
            const body = (
              <>
                {l.board && <Board w={l.text.length * l.size * 0.75 + 0.6} h={l.size * 1.8} color={l.board} />}
                <Label text={l.text} position={[0, 0, 0.005]} size={l.size} color={l.color} />
              </>
            );
            return (
              <group key={l.key} position={l.position}>
                {l.faceCamera ? <FaceCamera>{body}</FaceCamera> : body}
              </group>
            );
          }
          case "ground":
            return <Label key={l.key} text={l.text} position={l.position} rotation={[-Math.PI / 2, 0, 0]} size={l.size} color={l.color} />;
        }
      })}
    </>
  );
}
