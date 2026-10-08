"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { type Group, type Mesh, type MeshBasicMaterial, Vector3 } from "three";
import type { AgentState, WorldState } from "@/lib/api";
import {
  ARM_RAISED,
  DIM,
  type Plan,
  type SceneSpec,
  type TripInput,
  car as carModel,
  figure,
  figurePose,
  liftDoors,
  liftHeights,
  liftY,
  planTrips,
  relevantTrips,
  routes as carRoutes,
  sample,
  samplePeople,
  tripWorld,
  walkGraph,
  windowOpen,
} from "@/scene/layout";
import { PALETTE, carColor, outfitColor } from "@/scene/palette";
import { isFloorVisible, useUiStore } from "@/store/useUiStore";
import { useWorldStore } from "@/store/useWorldStore";
import { PartMeshes } from "./PartMeshes";

/** Seconds on the server clock (trips are timed by the backend). */
export const serverNow = () => (Date.now() + useWorldStore.getState().clockOffset) / 1000;

/** Arriving or leaving with a trip that matches: drawn by the animation instead of the static scene. */
export const onTrip = (a: Pick<AgentState, "status" | "trip">) =>
  (a.status === "arriving" && a.trip?.kind === "arrive") || (a.status === "leaving" && a.trip?.kind === "depart");

/** Where the followed agent is right now (written every frame by the movers, read by the camera). */
export const followPoint = { valid: false, position: new Vector3() };

/** Dev builds: latest poses for browser checks (`window.__aiOfficeMotion`). */
const devPoses: Record<number, { t: number; person: number[]; car: number[]; visible: boolean }> = {};
if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") (window as unknown as Record<string, unknown>).__aiOfficeMotion = devPoses;

function tripsOf(world: WorldState, scene: SceneSpec): TripInput[] {
  const indexOf = new Map(scene.building.floors.map((f) => [f.number, f.index]));
  return world.floors.flatMap((f) =>
    f.agents.flatMap((a) => {
      const floorIndex = indexOf.get(f.number);
      if (!a.trip || floorIndex === undefined) return [];
      return [
        {
          agentId: a.id,
          kind: a.trip.kind,
          start: Date.parse(a.trip.started_at) / 1000,
          floorIndex,
          deskIndex: a.desk_index,
          spot: scene.site.deskSpot(floorIndex, a.desk_index),
        },
      ];
    }),
  );
}

type Rig = { root: Group | null; hips: Group | null; thighs: (Group | null)[]; shins: (Group | null)[]; arms: (Group | null)[]; car: Group | null };

function Person({ outfit, rig }: { outfit: string; rig: Rig }) {
  const f = useMemo(() => figure(outfit), [outfit]);
  return (
    <group ref={(g) => void (rig.root = g)}>
      <group ref={(g) => void (rig.hips = g)} position-y={f.hipY}>
        <PartMeshes parts={f.body} />
        {[-1, 1].map((side, i) => (
          <group key={side} ref={(g) => void (rig.thighs[i] = g)} position={[side * f.thigh.pivot[0], f.thigh.pivot[1], f.thigh.pivot[2]]}>
            <PartMeshes parts={f.thigh.parts} />
            <group ref={(g) => void (rig.shins[i] = g)} position={f.shin.pivot}>
              <PartMeshes parts={f.shin.parts} />
            </group>
          </group>
        ))}
        {[-1, 1].map((side, i) => (
          <group key={side} ref={(g) => void (rig.arms[i] = g)} position={[side * f.arm.pivot[0], f.arm.pivot[1], f.arm.pivot[2]]}>
            <PartMeshes parts={f.arm.parts} />
          </group>
        ))}
      </group>
    </group>
  );
}

/**
 * Cars and people on their trips, the lift, lift and entrance doors, barrier arms and the reader light.
 * Everything is placed in one frame loop from the trip schedule (pure functions of the clock): no React renders.
 */
export function Motion({ world, scene, enabled }: { world: WorldState; scene: SceneSpec; enabled: boolean }) {
  const { building, site, moving } = scene;
  const tw = useMemo(() => tripWorld(building, site, carRoutes(site), walkGraph(building, site)), [building, site]);
  const ys = useMemo(() => liftHeights(building), [building]);
  const durations = useMemo(() => ({ arrive: world.motion.arrive_seconds, depart: world.motion.depart_seconds }), [world.motion.arrive_seconds, world.motion.depart_seconds]);

  const travellers = useMemo(() => (enabled ? world.floors.flatMap((f) => f.agents.filter(onTrip)) : []), [world, enabled]);
  const schedule = useMemo(() => {
    const trips = tripsOf(world, scene);
    if (!enabled || trips.length === 0) return planTrips([], durations, tw);
    return planTrips(relevantTrips(trips, durations, serverNow()), durations, tw);
  }, [world, scene, enabled, durations, tw]);
  const shown = useMemo(() => {
    const byAgent = new Map(schedule.plans.map((p) => [p.trip.agentId, p]));
    return travellers.flatMap((a) => {
      const plan = byAgent.get(a.id);
      return plan ? [{ agent: a, plan }] : [];
    });
  }, [schedule, travellers]);

  const rigs = useRef(new Map<number, Rig>());
  const rigOf = (id: number) => {
    let r = rigs.current.get(id);
    if (!r) rigs.current.set(id, (r = { root: null, hips: null, thighs: [], shins: [], arms: [], car: null }));
    return r;
  };
  const cabin = useRef<Group>(null);
  const landing = useRef<(Group | null)[]>([]);
  const entrance = useRef<(Group | null)[]>([]);
  const arms = useRef<(Group | null)[]>([]);
  const reader = useRef<Mesh>(null);
  const fig = useMemo(() => figure(""), []);

  useFrame(() => {
    const t = serverNow();
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

    const plans: Plan[] = shown.map((s) => s.plan);
    const people = samplePeople(plans, t, { runs: props.lift, ys });
    shown.forEach(({ agent, plan }, i) => {
      const rig = rigOf(agent.id);
      const p = people[i];
      const c = sample(plan.car, t);
      if (rig.car) {
        rig.car.visible = c.visible;
        rig.car.position.set(...c.pos);
        rig.car.rotation.y = c.yaw;
      }
      if (rig.root && rig.hips) {
        const visible = p.visible && visibleAt(p.pos[1]);
        rig.root.visible = visible;
        rig.root.position.set(...p.pos);
        rig.root.rotation.y = p.yaw;
        const pose = figurePose(p.walked, p.speed, p.sit, p.tapping);
        rig.hips.position.y = fig.hipY + (fig.seatedHipY - fig.hipY) * p.sit + pose.bob;
        pose.legs.forEach((leg, k) => {
          if (rig.thighs[k]) rig.thighs[k]!.rotation.x = leg.thigh;
          if (rig.shins[k]) rig.shins[k]!.rotation.x = leg.shin;
        });
        pose.arms.forEach((angle, k) => {
          if (rig.arms[k]) rig.arms[k]!.rotation.x = angle;
        });
      }
      if (process.env.NODE_ENV !== "production") devPoses[agent.id] = { t, person: p.pos, car: c.pos, visible: p.visible };
      if (agent.id === follow) {
        if (p.visible) followPoint.position.set(p.pos[0], p.pos[1] + 1, p.pos[2]);
        else followPoint.position.set(c.pos[0], 1, c.pos[2]);
        followPoint.valid = true;
      }
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
      {shown.map(({ agent }) => {
        const rig = rigOf(agent.id);
        return (
          <group key={agent.id}>
            <group ref={(g) => void (rig.car = g)}>
              <PartMeshes parts={carModel(carColor(agent.role_key))} />
            </group>
            <Person outfit={outfitColor(agent.role_key)} rig={rig} />
          </group>
        );
      })}
    </group>
  );
}
