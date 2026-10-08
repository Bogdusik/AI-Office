"use client";

import { Text } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { Suspense, useMemo, useRef, useState } from "react";
import { type Group, type Mesh, type MeshBasicMaterial, Vector3 } from "three";
import type { AgentState, WorldState } from "@/lib/api";
import { activityCaption } from "@/lib/labels";
import {
  ARM_RAISED,
  DIM,
  type FigurePose,
  type LeaveFrom,
  type LifeInput,
  type LifePlan,
  MUG_IN_HAND,
  type Pose,
  type SceneSpec,
  type TripInput,
  car as carModel,
  cupPosition,
  figure,
  figurePose,
  liftDoors,
  liftHeights,
  liftY,
  mug,
  planLife,
  planTrips,
  receptionLayout,
  receptionistPose,
  relevantTrips,
  routes as carRoutes,
  sample,
  separate,
  speechBubble,
  tripWorld,
  walkGraph,
  windowOpen,
} from "@/scene/layout";
import { PALETTE, carColor, outfitColor } from "@/scene/palette";
import { isFloorVisible, useUiStore } from "@/store/useUiStore";
import { useWorldStore } from "@/store/useWorldStore";
import { FaceCamera } from "../parts/FaceCamera";
import { LABEL_FONT } from "../parts/Label";
import { PartMeshes } from "./PartMeshes";

/** Seconds on the server clock (trips and office life are timed by the backend). */
export const serverNow = () => (Date.now() + useWorldStore.getState().clockOffset) / 1000;

/** Arriving, leaving or returning with a trip that matches: drawn by the animation instead of the static scene. */
export const onTrip = (a: Pick<AgentState, "status" | "trip">) =>
  (a.status === "arriving" && a.trip?.kind === "arrive") ||
  (a.status === "leaving" && a.trip?.kind === "depart") ||
  (a.status === "returning" && a.trip?.kind === "return");

/** In the office (at work, waiting, free) with an activity log: office life draws them. */
export const inOffice = (a: Pick<AgentState, "status" | "activity_log">) =>
  (a.status === "idle" || a.status === "working" || a.status === "waiting_review") && a.activity_log.length > 0;

/** Where the followed agent is right now (written every frame by the movers, read by the camera). */
export const followPoint = { valid: false, position: new Vector3() };

/** Dev builds: latest poses for browser checks (`window.__aiOfficeMotion`). */
const devPoses: Record<number, { t: number; person: number[]; car: number[]; visible: boolean; act?: string; sit?: number }> = {};
if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") (window as unknown as Record<string, unknown>).__aiOfficeMotion = devPoses;

/** Office life is planned up to a horizon on a 2-minute grid (the same in every tab), extended as time goes on. */
const horizonFor = (t: number) => Math.ceil(t / 120) * 120 + 300;

function floorIndexOf(scene: SceneSpec) {
  return new Map(scene.building.floors.map((f) => [f.number, f.index]));
}

function lifeInputsOf(world: WorldState, scene: SceneSpec): LifeInput[] {
  const indexOf = floorIndexOf(scene);
  return world.floors.flatMap((f) =>
    f.agents.map((a) => ({
      agentId: a.id,
      floorIndex: indexOf.get(f.number) ?? 0,
      deskIndex: a.desk_index,
      log: a.activity_log.map((e) => ({ kind: e.kind, since: Date.parse(e.since) / 1000 })),
    })),
  );
}

/**
 * Trips from `/state`: each agent's latest trip and, when it continues a departure (a return, or an arrival
 * straight back from the map edge), that departure too — the planner needs it to know where the agent was.
 */
function tripsOf(world: WorldState, scene: SceneSpec, leaveOf: (agentId: number, start: number) => LeaveFrom | null): TripInput[] {
  const indexOf = floorIndexOf(scene);
  return world.floors.flatMap((f) =>
    f.agents.flatMap((a) => {
      const floorIndex = indexOf.get(f.number);
      if (!a.trip || floorIndex === undefined) return [];
      const base = { agentId: a.id, floorIndex, deskIndex: a.desk_index, spot: scene.site.deskSpot(floorIndex, a.desk_index) };
      const start = Date.parse(a.trip.started_at) / 1000;
      const origin = a.trip.origin_at ? Date.parse(a.trip.origin_at) / 1000 : null;
      const trip: TripInput = { ...base, kind: a.trip.kind, start, origin, from: a.trip.kind === "depart" ? leaveOf(a.id, start) : null };
      return origin === null ? [trip] : [{ ...base, kind: "depart" as const, start: origin, from: leaveOf(a.id, origin) }, trip];
    }),
  );
}

type Rig = {
  root: Group | null;
  hips: Group | null;
  torso: Group | null;
  thighs: (Group | null)[];
  shins: (Group | null)[];
  arms: (Group | null)[];
  mug: Group | null;
  car: Group | null;
  cup: Group | null;
  caption: Group | null;
  bubble: Group | null;
};
const newRig = (): Rig => ({ root: null, hips: null, torso: null, thighs: [], shins: [], arms: [], mug: null, car: null, cup: null, caption: null, bubble: null });

function Person({ outfit, rig }: { outfit: string; rig: Rig }) {
  const f = useMemo(() => figure(outfit), [outfit]);
  const cupParts = useMemo(() => mug(), []);
  return (
    <group ref={(g) => void (rig.root = g)}>
      <group ref={(g) => void (rig.hips = g)} position-y={f.hipY}>
        <group ref={(g) => void (rig.torso = g)}>
          <PartMeshes parts={f.body} />
          {[-1, 1].map((side, i) => (
            <group key={side} ref={(g) => void (rig.arms[i] = g)} position={[side * f.arm.pivot[0], f.arm.pivot[1], f.arm.pivot[2]]}>
              <PartMeshes parts={f.arm.parts} />
              {side === 1 && (
                <group ref={(g) => void (rig.mug = g)} position={MUG_IN_HAND} visible={false}>
                  <PartMeshes parts={cupParts} />
                </group>
              )}
            </group>
          ))}
        </group>
        {[-1, 1].map((side, i) => (
          <group key={side} ref={(g) => void (rig.thighs[i] = g)} position={[side * f.thigh.pivot[0], f.thigh.pivot[1], f.thigh.pivot[2]]}>
            <PartMeshes parts={f.thigh.parts} />
            <group ref={(g) => void (rig.shins[i] = g)} position={f.shin.pivot}>
              <PartMeshes parts={f.shin.parts} />
            </group>
          </group>
        ))}
      </group>
    </group>
  );
}

function Caption({ text }: { text: string }) {
  return (
    <FaceCamera>
      <Suspense fallback={null}>
        <Text font={LABEL_FONT} fontSize={0.17} color={PALETTE.dark} outlineWidth={0.025} outlineColor="#ffffff" anchorX="center" anchorY="bottom">
          {text}
        </Text>
      </Suspense>
    </FaceCamera>
  );
}

const hipsOf = (fig: ReturnType<typeof figure>) => (sit: number, bob: number) => fig.hipY + (fig.seatedHipY - fig.hipY) * sit + bob;

function applyPose(rig: Rig, pose: FigurePose, hipY: number) {
  if (rig.hips) rig.hips.position.y = hipY;
  if (rig.torso) {
    rig.torso.rotation.x = pose.lean;
    rig.torso.rotation.y = pose.turn;
  }
  pose.legs.forEach((leg, k) => {
    if (rig.thighs[k]) rig.thighs[k]!.rotation.x = leg.thigh;
    if (rig.shins[k]) rig.shins[k]!.rotation.x = leg.shin;
  });
  pose.arms.forEach((angle, k) => {
    if (rig.arms[k]) rig.arms[k]!.rotation.x = angle;
  });
}

/**
 * Everything that moves: cars and people on their trips, office life (desk work, coffee, lounge, strolls,
 * conversations), the receptionists, the lift, lift and entrance doors, barrier arms and the reader light.
 * All of it is placed in one frame loop from pure schedules of the server clock: no React renders per frame.
 */
export function Motion({ world, scene, enabled, life }: { world: WorldState; scene: SceneSpec; enabled: boolean; life: boolean }) {
  const { building, site, moving } = scene;
  const tw = useMemo(() => tripWorld(building, site, carRoutes(site), walkGraph(building, site)), [building, site]);
  const ys = useMemo(() => liftHeights(building), [building]);
  const { arrive_seconds, depart_seconds, turn_back_seconds, return_extra_seconds } = world.motion;
  const durations = useMemo(
    () => ({ arrive: arrive_seconds, depart: depart_seconds, turnBack: turn_back_seconds, returnExtra: return_extra_seconds }),
    [arrive_seconds, depart_seconds, turn_back_seconds, return_extra_seconds],
  );
  const [horizon, setHorizon] = useState(() => horizonFor(serverNow()));
  const living = enabled && life;

  const lifeSchedule = useMemo(() => (living ? planLife(lifeInputsOf(world, scene), { building, walk: tw.walk }, horizon) : null), [living, world, scene, building, tw, horizon]);
  const travellers = useMemo(() => (enabled ? world.floors.flatMap((f) => f.agents.filter(onTrip)) : []), [world, enabled]);
  const schedule = useMemo(() => {
    const leaveOf = (id: number, start: number) =>
      lifeSchedule?.plans.find((p) => p.agentId === id)?.leaves.find((l) => Math.abs(l.since - start) < 1e-3)?.from ?? null;
    const trips = tripsOf(world, scene, leaveOf);
    if (!enabled || trips.length === 0) return planTrips([], durations, tw);
    return planTrips(relevantTrips(trips, durations, serverNow()), durations, tw);
  }, [world, scene, enabled, durations, tw, lifeSchedule]);

  const shownTrips = useMemo(() => {
    const byAgent = new Map(schedule.plans.map((p) => [p.trip.agentId, p]));
    return travellers.flatMap((a) => {
      const plan = byAgent.get(a.id);
      return plan ? [{ agent: a, plan }] : [];
    });
  }, [schedule, travellers]);
  const shownLife = useMemo(() => {
    if (!lifeSchedule) return [];
    const indexOf = floorIndexOf(scene);
    const byAgent = new Map(lifeSchedule.plans.map((p) => [p.agentId, p]));
    return world.floors.flatMap((f) =>
      f.agents.filter(inOffice).flatMap((a) => {
        const plan = byAgent.get(a.id);
        return plan ? [{ agent: a, plan, caption: activityCaption(a), floorIndex: indexOf.get(f.number) ?? 0 }] : [];
      }),
    );
  }, [lifeSchedule, world, scene]);
  const staff = useMemo(() => (living ? receptionLayout(building).staff.map((s) => ({ ...s, position: [s.position[0], building.floors[0].baseY, s.position[2]] as const })) : []), [living, building]);

  const rigs = useRef(new Map<string, Rig>());
  const rigOf = (key: string) => {
    let r = rigs.current.get(key);
    if (!r) rigs.current.set(key, (r = newRig()));
    return r;
  };
  const cabin = useRef<Group>(null);
  const landing = useRef<(Group | null)[]>([]);
  const entrance = useRef<(Group | null)[]>([]);
  const arms = useRef<(Group | null)[]>([]);
  const reader = useRef<Mesh>(null);
  const fig = useMemo(() => figure(""), []);
  const hipY = useMemo(() => hipsOf(fig), [fig]);

  useFrame(() => {
    const t = serverNow();
    if (living && t > horizon - 60) setHorizon(horizonFor(t));
    const selected = useUiStore.getState().selectedFloor;
    const follow = useUiStore.getState().follow;
    // Between floors (stairs, lift) counts as both: hidden when either floor is hidden.
    const visibleAt = (y: number) => {
      const i = Math.max(0, building.floors.findLastIndex((f) => f.baseY <= y + 0.3));
      const [floor, above] = [building.floors[i], building.floors[i + 1]];
      if (!floor || !isFloorVisible(floor.number, selected)) return false;
      return y <= floor.baseY + 0.5 || !above || isFloorVisible(above.number, selected);
    };
    const props = schedule.props;
    followPoint.valid = false;

    const lift = { runs: props.lift, ys };
    const poses = separate([...shownTrips.map((s) => sample(s.plan.person, t, lift)), ...shownLife.map((s) => sample(s.plan.segs, t))]);
    const people: { key: string; id: number; pose: Pose; car?: Pose; plan?: LifePlan }[] = [
      ...shownTrips.map((s, i) => ({ key: `a${s.agent.id}`, id: s.agent.id, pose: poses[i], car: sample(s.plan.car, t) })),
      ...shownLife.map((s, i) => ({ key: `a${s.agent.id}`, id: s.agent.id, pose: poses[shownTrips.length + i], plan: s.plan })),
    ];
    const byId = new Map(people.map((p) => [p.id, p.pose]));

    for (const { key, id, pose: p, car: c, plan } of people) {
      const rig = rigOf(key);
      if (rig.car && c) {
        rig.car.visible = c.visible;
        rig.car.position.set(...c.pos);
        rig.car.rotation.y = c.yaw;
      }
      const visible = p.visible && visibleAt(p.pos[1]);
      if (rig.root) {
        rig.root.visible = visible;
        rig.root.position.set(...p.pos);
        rig.root.rotation.y = p.yaw;
        const pose = figurePose(p, t, id);
        applyPose(rig, pose, hipY(p.sit, pose.bob));
      }
      if (rig.mug) rig.mug.visible = !!p.carry;
      if (rig.caption) {
        // At the desk the plaque already says it; the caption follows the agent when away from it.
        rig.caption.visible = visible && p.act !== "talk" && !(p.sit > 0.5 && (p.act === "type" || p.act === "lean"));
        rig.caption.position.set(p.pos[0], p.pos[1] + (p.sit > 0.5 ? 1.75 : 2.05), p.pos[2]);
      }
      if (rig.bubble) {
        const partner = p.partner !== undefined ? byId.get(p.partner) : undefined;
        const talking = visible && p.act === "talk" && partner?.act === "talk" && partner.partner === id && id < (p.partner ?? 0);
        rig.bubble.visible = !!talking;
        if (talking && partner) rig.bubble.position.set((p.pos[0] + partner.pos[0]) / 2, p.pos[1] + 2.15, (p.pos[2] + partner.pos[2]) / 2);
      }
      if (rig.cup && plan) rig.cup.visible = plan.cups.some((cup) => t >= cup.from && t < cup.to) && visibleAt(rig.cup.position.y);
      if (process.env.NODE_ENV !== "production") devPoses[id] = { t, person: p.pos, car: c?.pos ?? [], visible: p.visible, act: p.act, sit: p.sit };
      if (id === follow) {
        if (p.visible || !c) followPoint.position.set(p.pos[0], p.pos[1] + 1, p.pos[2]);
        else followPoint.position.set(c.pos[0], 1, c.pos[2]);
        followPoint.valid = true;
      }
    }

    staff.forEach((s, i) => {
      const rig = rigOf(`staff${i}`);
      if (!rig.root) return;
      rig.root.visible = visibleAt(s.position[1]);
      const pose = receptionistPose(t, i + 1);
      applyPose(rig, pose, hipY(1, 0));
    });

    if (cabin.current) {
      const y = liftY(props.lift, ys, t);
      cabin.current.position.y = y;
      cabin.current.visible = visibleAt(y);
    }
    moving.landings.forEach((l, i) => {
      const open = liftDoors(props.lift, l.floorIndex, t);
      l.leaves.forEach((leaf, k) => {
        const g = landing.current[i * 2 + k];
        if (!g) return;
        g.visible = isFloorVisible(l.floorNumber, selected);
        g.position.set(leaf.center[0] + leaf.slide[0] * open, leaf.center[1] + leaf.slide[1] * open, leaf.center[2] + leaf.slide[2] * open);
      });
    });
    const doors = windowOpen(props.door, t, DIM.motion.doorOpen);
    moving.entrance.forEach((leaf, k) => {
      entrance.current[k]?.position.set(leaf.center[0] + leaf.slide[0] * doors, leaf.center[1], leaf.center[2]);
    });
    const gates = [props.entry, props.exit];
    moving.arms.forEach((arm, k) => {
      const g = arms.current[k];
      if (g) g.rotation.z = arm.direction * ARM_RAISED * windowOpen(gates[k] ?? [], t, DIM.motion.gateRaise);
    });
    if (reader.current) {
      const tap = props.reader.find((r) => t >= r.from && t < r.to + 0.6);
      reader.current.visible = !!tap && (t > tap.to || Math.floor((t - tap.from) * 6) % 2 === 0);
      (reader.current.material as MeshBasicMaterial).color.set(tap && t > tap.to ? PALETTE.ledIdle : "#ffffff");
    }
  });

  const restFloor = building.floors[0]?.baseY ?? 0;
  const cupParts = useMemo(() => mug(), []);
  const bubbleParts = useMemo(() => speechBubble(), []);
  return (
    <group>
      <group ref={cabin} position={[moving.cabin.center[0], restFloor, moving.cabin.center[1]]}>
        <PartMeshes parts={moving.cabin.parts} />
      </group>
      {moving.landings.flatMap((l, i) =>
        l.leaves.map((leaf, k) => (
          <group key={`${l.floorIndex}-${k}`} ref={(g) => void (landing.current[i * 2 + k] = g)} position={leaf.center}>
            <PartMeshes parts={leaf.parts} />
          </group>
        )),
      )}
      {moving.entrance.map((leaf, k) => (
        <group key={k} ref={(g) => void (entrance.current[k] = g)} position={leaf.center}>
          <PartMeshes parts={leaf.parts} />
        </group>
      ))}
      {moving.arms.map((arm, k) => (
        <group key={k} ref={(g) => void (arms.current[k] = g)} position={arm.pivot}>
          <PartMeshes parts={arm.parts} />
        </group>
      ))}
      <mesh ref={reader} position={moving.reader} visible={false}>
        <boxGeometry args={[0.1, 0.05, 0.012]} />
        <meshBasicMaterial color={PALETTE.ledIdle} toneMapped={false} />
      </mesh>
      {shownTrips.map(({ agent }) => {
        const rig = rigOf(`a${agent.id}`);
        return (
          <group key={`trip-${agent.id}`}>
            <group ref={(g) => void (rig.car = g)}>
              <PartMeshes parts={carModel(carColor(agent.role_key))} />
            </group>
            <Person outfit={outfitColor(agent.role_key)} rig={rig} />
          </group>
        );
      })}
      {shownLife.map(({ agent, caption, floorIndex }) => {
        const rig = rigOf(`a${agent.id}`);
        return (
          <group key={`life-${agent.id}`}>
            <Person outfit={outfitColor(agent.role_key)} rig={rig} />
            <group ref={(g) => void (rig.cup = g)} position={cupPosition(building, floorIndex, agent.desk_index)} visible={false}>
              <PartMeshes parts={cupParts} />
            </group>
            {caption && (
              <group ref={(g) => void (rig.caption = g)}>
                <Caption text={caption} />
              </group>
            )}
            <group ref={(g) => void (rig.bubble = g)} visible={false}>
              <FaceCamera>
                <PartMeshes parts={bubbleParts} />
              </FaceCamera>
            </group>
          </group>
        );
      })}
      {staff.map((s, i) => {
        const rig = rigOf(`staff${i}`);
        return (
          <group key={`staff-${i}`} position={s.position as unknown as [number, number, number]} rotation-y={s.yaw}>
            <Person outfit={PALETTE.uniform} rig={rig} />
          </group>
        );
      })}
    </group>
  );
}
