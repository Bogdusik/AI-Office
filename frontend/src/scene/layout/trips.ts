/**
 * Trip planner: where every arriving or leaving agent (car and person) is at any moment.
 *
 * Pure functions of the trips in `/state` (kind, start time, desk) and the layout. Trips are planned one by one
 * in order of their start; each plan depends only on earlier trips (gate, card reader and lift reservations
 * are only ever appended), so a new trip never moves anyone already on the way, and a reload replans the
 * same picture. Each trip lasts exactly its duration: one pace factor scales all speeds, an arriving car can
 * set off later, and the final stretch (walk to the desk, drive to the map edge) absorbs the rest.
 */
import { type BuildingLayout, coreLayout } from "./building";
import { DIM } from "./dims";
import { MAP_EDGES, type Routes, type SiteLayout } from "./site";
import { type Vec3, rectCenter } from "./types";
import type { LeaveFrom } from "./life";
import { WALK, type WalkGraph, findPath } from "./walk";

export type TripKind = "arrive" | "depart";
/** `start` in seconds on the server clock. */
/** `from`: where a leaving agent is when the departure starts (office life); absent → seated at the desk. */
export type TripInput = { agentId: number; kind: TripKind; start: number; floorIndex: number; deskIndex: number; spot: number; from?: LeaveFrom | null };
export type Durations = { arrive: number; depart: number };
export type TripWorld = { building: BuildingLayout; site: SiteLayout; routes: Routes; walk: WalkGraph };

/**
 * A stretch of a timeline: the actor moves through `pts` reaching each at `times` (linear in between).
 * `yaw` fixes the facing (still actors); `ride` puts a person in the lift (y follows the cabin);
 * `sit` goes from one sitting amount to the other; `hidden` hides the actor (person in the car, car off the map).
 */
export type Seg = {
  t0: number;
  t1: number;
  pts: Vec3[];
  times: number[];
  yaw?: number;
  reverse?: boolean;
  sit?: [number, number];
  ride?: boolean;
  hidden?: boolean;
  tap?: boolean;
  /** Office life: what the person is doing (pose), carrying a cup, talking to `partner`, the seat being used. */
  act?: LifeAct;
  carry?: boolean;
  partner?: number;
  seat?: SeatRef;
  /** Walking graph node of every point ("" for a point between nodes), so a walk can be interrupted mid-way. */
  ids?: string[];
  /** Filled by `planTrips`: cumulative lengths along `pts` and the distance covered before this segment. */
  cum?: number[];
  before?: number;
};

export type LifeAct = "type" | "lean" | "sofa" | "stand" | "window" | "talk" | "brew";
/** A seat in use: the seat node, the node one steps to when standing up, the facing while seated. */
export type SeatRef = { seat: string; front: string; yaw: number };

/** `squeeze` < 1: the final stretch had to go faster than the pace to end on time (busy gate, reader or lift). */
export type Plan = { trip: TripInput; end: number; car: Seg[]; person: Seg[]; pace: number; delay: number; squeeze: number };

export type Interval = { from: number; to: number };
export type LiftStop = { floor: number; arrive: number; close: number };
export type LiftRun = { startAt: number; startFloor: number; stops: LiftStop[]; riders: number };
/** A stretch of the parking aisle (x range) a leaving car needs for a while. */
export type Zone = Interval & { x0: number; x1: number; drive: boolean };
export type Props = { entry: Interval[]; exit: Interval[]; reader: Interval[]; door: Interval[]; aisle: Zone[]; lift: LiftRun[] };
export type Schedule = { plans: Plan[]; props: Props };

const M = DIM.motion;
const L = M.lift;
const EPS = 1e-6;

/* ---------- geometry ---------- */

const dist2 = (a: Vec3, b: Vec3) => Math.hypot(b[0] - a[0], b[2] - a[2]);
const dist3 = (a: Vec3, b: Vec3) => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const lerp3 = (a: Vec3, b: Vec3, k: number): Vec3 => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];

/** Yaw that turns a model facing −z towards the horizontal direction (dx, dz). */
export const yawOf = (dx: number, dz: number) => Math.atan2(-dx, -dz);

/** Rounds corners in plan view with quadratic curves (radius `r`, shortened where segments are short). */
export function rounded(pts: Vec3[], r: number, steps = 7): Vec3[] {
  const clean = pts.filter((p, i) => i === 0 || dist2(p, pts[i - 1]) > 1e-4);
  if (clean.length < 3) return clean;
  const out: Vec3[] = [clean[0]];
  for (let i = 1; i < clean.length - 1; i++) {
    const [a, b, c] = [clean[i - 1], clean[i], clean[i + 1]];
    const ab = dist2(a, b);
    const bc = dist2(b, c);
    const u: [number, number] = [(b[0] - a[0]) / ab, (b[2] - a[2]) / ab];
    const v: [number, number] = [(c[0] - b[0]) / bc, (c[2] - b[2]) / bc];
    const turn = Math.acos(Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1])));
    if (turn < 0.02 || turn > 3) {
      out.push(b);
      continue;
    }
    const limitA = i - 1 === 0 ? ab : ab / 2;
    const limitC = i + 1 === clean.length - 1 ? bc : bc / 2;
    const tangent = Math.min(r * Math.tan(turn / 2), limitA, limitC);
    const p1: Vec3 = [b[0] - u[0] * tangent, b[1], b[2] - u[1] * tangent];
    const p2: Vec3 = [b[0] + v[0] * tangent, b[1], b[2] + v[1] * tangent];
    for (let k = 0; k <= steps; k++) {
      const s = k / steps;
      const q0 = lerp3(p1, b, s);
      const q1 = lerp3(b, p2, s);
      out.push(lerp3(q0, q1, s));
    }
  }
  out.push(clean.at(-1)!);
  return out.filter((p, i, all) => i === 0 || dist2(p, all[i - 1]) > 1e-4 || Math.abs(p[1] - all[i - 1][1]) > 1e-4);
}

/** Cumulative 3D lengths along a polyline. */
export function cumulative(pts: Vec3[]): number[] {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist3(pts[i - 1], pts[i]));
  return cum;
}

/** Splits a polyline at distance `s` (both halves include the split point). */
function splitAt(pts: Vec3[], s: number): [Vec3[], Vec3[]] {
  const cum = cumulative(pts);
  if (s <= 0) return [[pts[0]], pts];
  if (s >= cum.at(-1)!) return [pts, [pts.at(-1)!]];
  let i = 1;
  while (cum[i] < s) i++;
  const k = (s - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
  const p = lerp3(pts[i - 1], pts[i], k);
  return [[...pts.slice(0, i), p], [p, ...pts.slice(i)]];
}

/** Distance along the path to the point closest to p (in plan view). */
function distanceTo(pts: Vec3[], p: Vec3): number {
  const cum = cumulative(pts);
  let best = 0;
  let bestD = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const [a, b] = [pts[i - 1], pts[i]];
    const len = dist2(a, b);
    const k = len < EPS ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * (b[0] - a[0]) + (p[2] - a[2]) * (b[2] - a[2])) / (len * len)));
    const d = dist2(lerp3(a, b, k), p);
    if (d < bestD) [bestD, best] = [d, cum[i - 1] + k * (cum[i] - cum[i - 1])];
  }
  return best;
}

/** Where a car waits at a barrier: its nose just short of the arm, on the lane the barrier closes. */
const GATE_STOP = 2.3;

/** Breaks long edges so speed profiles stay smooth when sampled at the points. */
function densify(pts: Vec3[], step = 2): Vec3[] {
  const out: Vec3[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const n = Math.max(1, Math.ceil(dist3(pts[i - 1], pts[i]) / step));
    for (let k = 1; k <= n; k++) out.push(lerp3(pts[i - 1], pts[i], k / n));
  }
  return out;
}

/* ---------- timing ---------- */

export type Profile = "linear" | "in" | "out" | "drive";
const RAMP = 0.25;

/** Time to cover `d` at cruise speed `v` with the given profile (in/out start or end at rest). */
function profileTime(profile: Profile, d: number, v: number): number {
  if (d < EPS) return 0;
  if (profile === "linear") return d / v;
  if (profile === "drive") return d / (v * (1 - RAMP));
  return (2 * d) / v;
}

/** Fraction of time elapsed when the fraction `f` of the distance is covered. */
function timeFraction(profile: Profile, f: number): number {
  if (profile === "linear") return f;
  if (profile === "in") return Math.sqrt(f);
  if (profile === "out") return 1 - Math.sqrt(1 - f);
  // Trapezoid: accelerate during the first RAMP of the time, cruise, brake during the last RAMP.
  const vmax = 1 / (1 - RAMP);
  const sRamp = (vmax * RAMP) / 2;
  if (f <= sRamp) return Math.sqrt((2 * RAMP * f) / vmax);
  if (f >= 1 - sRamp) return 1 - Math.sqrt((2 * RAMP * (1 - f)) / vmax);
  return RAMP + (f - sRamp) / vmax;
}

/** A moving segment: points timed by a speed profile (car) or by per-edge speed (person; stairs are slower). */
function moveSeg(t0: number, pts: Vec3[], v: number, profile: Profile, extra: Partial<Seg> = {}): Seg {
  const dense = profile === "linear" ? pts : densify(pts);
  const cum = cumulative(dense);
  const total = cum.at(-1)!;
  const T = profileTime(profile, total, v);
  const times = cum.map((c) => t0 + (total > EPS ? timeFraction(profile, c / total) * T : 0));
  return { t0, t1: t0 + T, pts: dense, times, ...extra };
}

export function walkSeg(t0: number, pts: Vec3[], pace: number, extra: Partial<Seg> = {}): Seg {
  const times = [t0];
  for (let i = 1; i < pts.length; i++) {
    const [a, b] = [pts[i - 1], pts[i]];
    const stairs = Math.abs(b[1] - a[1]) > 0.01;
    times.push(times[i - 1] + (dist3(a, b) / (stairs ? M.stairs : M.walk)) * pace);
  }
  return { t0, t1: times.at(-1)!, pts, times, ...extra };
}

export const holdSeg = (t0: number, t1: number, p: Vec3, yaw: number, extra: Partial<Seg> = {}): Seg => ({ t0, t1, pts: [p], times: [t0], yaw, ...extra });
export const timedSeg = (t0: number, t1: number, pts: Vec3[], extra: Partial<Seg> = {}): Seg => {
  const cum = cumulative(pts);
  const total = cum.at(-1)! || 1;
  return { t0, t1, pts, times: cum.map((c) => t0 + ((t1 - t0) * c) / total), ...extra };
};

/** Facing at the end of a segment (direction of its last move). */
export function endYaw(seg: Seg, fallback = 0): number {
  if (seg.yaw !== undefined && seg.pts.length < 2) return seg.yaw;
  for (let i = seg.pts.length - 1; i > 0; i--) {
    const [a, b] = [seg.pts[i - 1], seg.pts[i]];
    if (dist2(a, b) > 1e-3) return yawOf(b[0] - a[0], b[2] - a[2]) + (seg.reverse ? Math.PI : 0);
  }
  return seg.yaw ?? fallback;
}


/** Rescales segments from `from` so the last one ends at `to` (segments before `from` stay). */
function retime(segs: Seg[], from: number, to: number): Seg[] {
  const end = Math.max(from, ...segs.map((s) => s.t1));
  if (end - from < EPS) return segs;
  const k = Math.max(0, to - from) / (end - from);
  const f = (t: number) => (t <= from ? t : from + (t - from) * k);
  return segs.map((s) => ({ ...s, t0: f(s.t0), t1: f(s.t1), times: s.times.map(f) }));
}

/* ---------- shared resources ---------- */

/** Earliest t ≥ `want` such that [t, t + len] overlaps none of `busy`. */
function fitSlot(busy: Interval[], want: number, len: number): number {
  let t = want;
  for (;;) {
    const clash = busy.find((b) => t < b.to && t + len > b.from);
    if (!clash) return t;
    t = clash.to;
  }
}

function liftFloors(b: BuildingLayout) {
  return b.floors.map((f) => f.baseY);
}

const liftTravel = (ys: number[], a: number, c: number) => (a === c ? 0 : Math.abs(ys[c] - ys[a]) / L.speed + 0.8);

/** Where the cabin is (floor) and from when it is free, before a new run starting no earlier than `t`. */
function liftStartFor(runs: LiftRun[], ys: number[], t: number): { at: number; floor: number } {
  const last = runs.at(-1);
  if (!last) return { at: t, floor: 0 };
  const stop = last.stops.at(-1)!;
  const free = stop.close + L.doors;
  if (stop.floor === 0) return { at: Math.max(t, free), floor: 0 };
  const homeAt = free + L.home;
  if (t < homeAt) return { at: Math.max(t, free), floor: stop.floor };
  return { at: Math.max(t, homeAt + liftTravel(ys, stop.floor, 0)), floor: 0 };
}

type Ride = { board: number; out: number; slot: number; runs: LiftRun[] };

function newRun(start: { at: number; floor: number }, ys: number[], a: number, c: number, t: number): { run: LiftRun; board: number; out: number } {
  const arriveA = start.at + liftTravel(ys, start.floor, a);
  const board = Math.max(t, arriveA + L.doors);
  const closeA = Math.max(arriveA + L.doors + L.hold, board + L.step);
  const arriveC = closeA + L.doors + liftTravel(ys, a, c);
  const run: LiftRun = {
    startAt: start.at,
    startFloor: start.floor,
    stops: [
      { floor: a, arrive: arriveA, close: closeA },
      { floor: c, arrive: arriveC, close: arriveC + L.doors + L.step + L.hold },
    ],
    riders: 1,
  };
  return { run, board, out: arriveC + L.doors };
}

/**
 * The quickest way from floor `a` to `c` for someone at the lift at time t, without changing any planned stop:
 * join a run that stops at both (or extend the last run), slot a new run into an idle gap, or append one.
 */
function requestLift(runs: LiftRun[], ys: number[], a: number, c: number, t: number): Ride {
  const options: Ride[] = [];
  const copy = () => runs.map((r) => ({ ...r, stops: [...r.stops] }));
  runs.forEach((run, i) => {
    const ia = run.stops.findIndex((s) => s.floor === a);
    if (ia < 0 || run.riders >= L.capacity) return;
    const sa = run.stops[ia];
    const board = Math.max(t, sa.arrive + L.doors);
    if (board + L.step > sa.close) return;
    const ic = run.stops.findIndex((s, k) => k > ia && s.floor === c);
    const up = c > a;
    const extendable = i === runs.length - 1 && ic < 0 && run.stops.slice(ia + 1).every((s) => (up ? s.floor > a && s.floor < c : s.floor < a && s.floor > c));
    if (ic < 0 && !extendable) return;
    const next = copy();
    let out: number;
    if (ic >= 0) out = run.stops[ic].arrive + L.doors;
    else {
      const last = run.stops.at(-1)!;
      const arrive = last.close + L.doors + liftTravel(ys, last.floor, c);
      next[i].stops.push({ floor: c, arrive, close: arrive + L.doors + L.step + L.hold });
      out = arrive + L.doors;
    }
    next[i].riders += 1;
    options.push({ board, out, slot: run.riders, runs: next });
  });
  for (let i = 0; i <= runs.length; i++) {
    const before = runs.slice(0, i);
    const after = runs[i];
    const made = newRun(liftStartFor(before, ys, t), ys, a, c, t);
    if (after) {
      const free = made.run.stops.at(-1)!.close + L.doors;
      const fits = after.startFloor === c ? free <= after.startAt : after.startFloor === 0 && free + L.home + liftTravel(ys, c, 0) <= after.startAt;
      if (!fits || made.run.startAt < (before.at(-1)?.stops.at(-1)!.close ?? -Infinity)) continue;
    }
    options.push({ board: made.board, out: made.out, slot: 0, runs: [...before, made.run, ...runs.slice(i)] });
  }
  return options.reduce((best, o) => (o.out < best.out ? o : best));
}

/** Cabin floor height at time t (eased moves between stops, homing to the ground floor when idle). */
export function liftY(runs: LiftRun[], ys: number[], t: number): number {
  let y = ys[0] ?? 0;
  let free = -Infinity;
  let floor = 0;
  const move = (t0: number, f0: number, f1: number): number | null => {
    const T = liftTravel(ys, f0, f1);
    if (T === 0) return null;
    if (t < t0) return ys[f0];
    if (t < t0 + T) {
      const u = (t - t0) / T;
      return lerp(ys[f0], ys[f1], u * u * (3 - 2 * u));
    }
    return null;
  };
  for (const run of runs) {
    if (t < run.startAt) return homing(free, floor, t, ys) ?? y;
    let f = run.startFloor;
    let t0 = run.startAt;
    for (const stop of run.stops) {
      const m = move(t0, f, stop.floor);
      if (m !== null) return m;
      if (t < stop.close + L.doors) return ys[stop.floor];
      f = stop.floor;
      t0 = stop.close + L.doors;
    }
    floor = f;
    free = t0;
    y = ys[f];
  }
  return homing(free, floor, t, ys) ?? y;

  function homing(freeAt: number, f: number, now: number, heights: number[]): number | null {
    if (f === 0 || freeAt === -Infinity) return null;
    const t0 = freeAt + L.home;
    const T = liftTravel(heights, f, 0);
    if (now < t0) return heights[f];
    if (now < t0 + T) {
      const u = (now - t0) / T;
      return lerp(heights[f], heights[0], u * u * (3 - 2 * u));
    }
    return heights[0];
  }
}

/** How far open (0..1) the lift doors on `floor` are at time t. */
export function liftDoors(runs: LiftRun[], floor: number, t: number): number {
  let open = 0;
  for (const run of runs) {
    for (const s of run.stops) {
      if (s.floor !== floor || t < s.arrive || t > s.close + L.doors) continue;
      const opening = Math.min(1, (t - s.arrive) / L.doors);
      const closing = Math.min(1, Math.max(0, (s.close + L.doors - t) / L.doors));
      open = Math.max(open, Math.min(opening, closing));
    }
  }
  return open;
}

/** 0..1 open amount of a window (barrier arm, entrance doors) with `ramp` seconds to open and to close. */
export function windowOpen(windows: Interval[], t: number, ramp: number): number {
  let open = 0;
  for (const w of windows) {
    if (t < w.from || t > w.to + ramp) continue;
    open = Math.max(open, Math.min(1, (t - w.from) / ramp, (w.to + ramp - t) / ramp));
  }
  return open;
}

/* ---------- planning one trip ---------- */

type State = Props;

const cloneState = (s: State): State => ({ entry: [...s.entry], exit: [...s.exit], reader: [...s.reader], door: [...s.door], aisle: [...s.aisle], lift: s.lift });

/** Cabin slots for up to `capacity` people, as offsets in the shaft. */
function liftSlots(b: BuildingLayout): Vec3[] {
  const [cx, cz] = rectCenter(coreLayout(b).shaft);
  return [
    [cx + 0.55, 0, cz - 0.55],
    [cx + 0.55, 0, cz + 0.55],
    [cx - 0.55, 0, cz - 0.55],
    [cx - 0.55, 0, cz + 0.55],
  ];
}

function edgesFor(agentId: number) {
  const n = MAP_EDGES.length;
  const h = (agentId * 7 + 3) % n;
  return { from: MAP_EDGES[h], to: MAP_EDGES[(h + 2) % n] };
}

/** Time at which a walking segment passes closest to point p. */
function timeNear(seg: Seg, p: Vec3): number {
  let best = 0;
  let d = Infinity;
  seg.pts.forEach((q, i) => {
    const e = dist2(q, p) + Math.abs(q[1] - p[1]);
    if (e < d) [d, best] = [e, i];
  });
  return seg.times[best];
}

function nodePos(w: TripWorld, id: string): Vec3 {
  const n = w.walk.nodes.get(id);
  if (!n) throw new Error(`walk node ${id} missing`);
  return n.p;
}

function pathOf(w: TripWorld, from: string, to: string): Vec3[] {
  const p = findPath(w.walk, from, to);
  if (!p) throw new Error(`no walking path ${from} → ${to}`);
  return p;
}

type Sim = { car: Seg[]; person: Seg[]; state: State; end: number; tailFrom: number };

/** Lift or stairs between floors, whichever gets there first; returns the segments and the time at `toId`. */
function changeFloors(w: TripWorld, st: State, pace: number, t: number, fromFloor: number, toFloor: number, toId: string, person: Seg[]): number {
  const ys = liftFloors(w.building);
  const fromLift = nodePos(w, WALK.lift(fromFloor));
  const toLift = nodePos(w, WALK.lift(toFloor));
  const stairsPath = pathOf(w, WALK.lift(fromFloor), toId);
  const stairs = walkSeg(t, stairsPath, pace);

  const ride = requestLift(st.lift, ys, fromFloor, toFloor, t);
  const afterLift = walkSeg(ride.out + L.step, pathOf(w, WALK.lift(toFloor), toId), pace);
  if (stairs.t1 < afterLift.t1) {
    person.push(stairs);
    return stairs.t1;
  }
  st.lift = ride.runs;
  const doorX = DIM.wall / 2;
  const slot = liftSlots(w.building)[ride.slot % L.capacity];
  const at = (p: Vec3, y: number): Vec3 => [p[0], y, p[2]];
  const threshold = (p: Vec3): Vec3 => [doorX, p[1], p[2]];
  const facingDoors = yawOf(1, 0);
  if (ride.board > t) person.push(holdSeg(t, ride.board, fromLift, yawOf(-1, 0)));
  person.push(timedSeg(ride.board, ride.board + L.step, [fromLift, threshold(fromLift), at(slot, fromLift[1])]));
  person.push(holdSeg(ride.board + L.step, ride.out, at(slot, 0), facingDoors, { ride: true }));
  person.push(timedSeg(ride.out, ride.out + L.step, [at(slot, toLift[1]), threshold(toLift), toLift]));
  person.push(afterLift);
  return afterLift.t1;
}

function arriveSim(w: TripWorld, base: State, trip: TripInput, pace: number, delay: number): Sim {
  const st = cloneState(base);
  const { site, routes } = w;
  const spot = site.spots[trip.spot];
  const edge = edgesFor(trip.agentId).from;
  const road = M.road / pace;
  const lot = M.lot / pace;

  // Car: edge → stop before the entry barrier → spot.
  const full = rounded([...routes.arrive[edge], ...routes.toSpot[trip.spot].slice(1)], M.turn);
  const sStop = distanceTo(full, [site.entryLaneX, 0, site.barrierZ + GATE_STOP]);
  const [approach, inside] = splitAt(full, sStop);
  const [cruise, braking] = splitAt(approach, Math.max(0, sStop - M.brake));
  const approachTime = profileTime("linear", cumulative(cruise).at(-1)!, road) + profileTime("out", cumulative(braking).at(-1)!, road);
  const naturalStop = trip.start + delay + approachTime;
  const gateAt = fitSlot(st.entry, naturalStop, M.gateRaise + M.gateClear);
  const spawn = trip.start + delay + (gateAt - naturalStop);
  const car: Seg[] = [];
  car.push(holdSeg(trip.start, spawn, cruise[0], 0, { hidden: true }));
  const c1 = moveSeg(spawn, cruise, road, "linear");
  const c2 = moveSeg(c1.t1, braking, road, "out");
  car.push(c1, c2);
  const stopYaw = endYaw(c2);
  car.push(holdSeg(c2.t1, c2.t1 + M.gateRaise * pace, braking.at(-1)!, stopYaw));
  const c3 = moveSeg(c2.t1 + M.gateRaise * pace, inside, lot, "drive");
  car.push(c3);
  st.entry.push({ from: c2.t1, to: c3.t0 + M.gateClear });
  const parked = holdSeg(c3.t1, Infinity, spot.center, spot.yaw);
  car.push(parked);

  // Person: out of the car → card reader → doors → lift or stairs → desk.
  const person: Seg[] = [];
  const side = nodePos(w, WALK.carSide(trip.spot));
  const doorPoint: Vec3 = [lerp(spot.center[0], side[0], 0.7), 0, spot.center[2]];
  person.push(holdSeg(trip.start, c3.t1, doorPoint, spot.yaw, { hidden: true }));
  const out = timedSeg(c3.t1, c3.t1 + M.getOut * pace, [doorPoint, side]);
  person.push(out);
  const toReader = walkSeg(out.t1, pathOf(w, WALK.carSide(trip.spot), WALK.reader), pace);
  const reader = nodePos(w, WALK.reader);
  const tapLen = M.tap * pace;
  const tapAt = fitSlot(st.reader, toReader.t1, tapLen);
  if (tapAt > toReader.t1 + EPS) {
    const ahead = st.reader.filter((r) => r.to > toReader.t1 && r.from < tapAt).length;
    const back = Math.min(M.queueGap * ahead, cumulative(toReader.pts).at(-1)!);
    const [before, last] = splitAt(toReader.pts, cumulative(toReader.pts).at(-1)! - back);
    const walkIn = walkSeg(out.t1, before, pace);
    const stepT = (back / M.walk) * pace;
    person.push(walkIn, holdSeg(walkIn.t1, tapAt - stepT, before.at(-1)!, endYaw(walkIn)), timedSeg(tapAt - stepT, tapAt, last));
  } else {
    person.push(toReader);
  }
  st.reader.push({ from: tapAt, to: tapAt + tapLen });
  person.push(holdSeg(tapAt, tapAt + tapLen, reader, 0, { tap: true }));
  const inside0 = walkSeg(tapAt + tapLen, pathOf(w, WALK.reader, WALK.lift(0)), pace);
  person.push(inside0);
  st.door.push({ from: tapAt + tapLen - M.doorOpen, to: timeNear(inside0, nodePos(w, WALK.insideDoor)) + 0.6 });

  const resources = person.length;
  const target = WALK.approach(trip.floorIndex, trip.deskIndex);
  const atDesk = changeFloors(w, st, pace, inside0.t1, 0, trip.floorIndex, target, person);
  const lastResource = person.slice(resources).findLast((s) => s.ride)?.t1 ?? inside0.t1;
  const seat = nodePos(w, WALK.seat(trip.floorIndex, trip.deskIndex));
  const app = nodePos(w, target);
  const sit = timedSeg(atDesk, atDesk + M.sit * pace, [app, seat], { yaw: 0, sit: [0, 1] });
  person.push(sit);
  return { car, person, state: st, end: sit.t1, tailFrom: lastResource };
}

/** First steps of a departure: stand up from the desk (or the sofa), or step from wherever office life left them. */
function leaveStart(w: TripWorld, trip: TripInput, pace: number, person: Seg[]): { t: number; id: string; floor: number } {
  const desk = WALK.seat(trip.floorIndex, trip.deskIndex);
  const from = trip.from;
  const floorOf = (id: string) => w.walk.nodes.get(id)?.floor ?? trip.floorIndex;
  if (!from || from.seated?.seat === desk) {
    const app = WALK.approach(trip.floorIndex, trip.deskIndex);
    person.push(timedSeg(trip.start, trip.start + M.sit * pace, [nodePos(w, desk), nodePos(w, app)], { yaw: 0, sit: [1, 0] }));
    return { t: trip.start + M.sit * pace, id: app, floor: trip.floorIndex };
  }
  if (from.seated) {
    const t = trip.start + M.sit * pace;
    person.push(timedSeg(trip.start, t, [nodePos(w, from.seated.seat), nodePos(w, from.seated.front)], { yaw: from.seated.yaw, sit: [1, 0] }));
    return { t, id: from.seated.front, floor: floorOf(from.seated.front) };
  }
  const ends = [from.at.prev, from.at.next].filter((id) => w.walk.nodes.has(id));
  const id = ends.sort((a, b) => dist3(from.at.pos, nodePos(w, a)) - dist3(from.at.pos, nodePos(w, b)))[0] ?? WALK.approach(trip.floorIndex, trip.deskIndex);
  const step = walkSeg(trip.start, [from.at.pos, nodePos(w, id)], pace);
  if (dist3(from.at.pos, nodePos(w, id)) > 1e-3) person.push(step);
  else person.push(holdSeg(trip.start, trip.start, from.at.pos, 0));
  return { t: step.t1, id, floor: floorOf(id) };
}

function departSim(w: TripWorld, base: State, trip: TripInput, pace: number, delay: number): Sim {
  const st = cloneState(base);
  const { site, routes } = w;
  const spot = site.spots[trip.spot];
  const edge = edgesFor(trip.agentId).to;
  const person: Seg[] = [];

  const start = leaveStart(w, trip, pace, person);
  let down = start.t;
  if (start.floor > 0) {
    const walkToLift = walkSeg(start.t, pathOf(w, start.id, WALK.lift(start.floor)), pace);
    person.push(walkToLift);
    down = changeFloors(w, st, pace, walkToLift.t1, start.floor, 0, WALK.lift(0), person);
  } else {
    const walkDown = walkSeg(start.t, pathOf(w, start.id, WALK.lift(0)), pace);
    person.push(walkDown);
    down = walkDown.t1;
  }
  const toCar = walkSeg(down, pathOf(w, WALK.lift(0), WALK.carSide(trip.spot)), pace);
  person.push(toCar);
  const doorAt = timeNear(toCar, nodePos(w, WALK.insideDoor));
  st.door.push({ from: doorAt - 1.2, to: timeNear(toCar, nodePos(w, WALK.outsideDoor)) + 0.4 });
  const side = nodePos(w, WALK.carSide(trip.spot));
  const doorPoint: Vec3 = [lerp(spot.center[0], side[0], 0.7), 0, spot.center[2]];
  const getIn = timedSeg(toCar.t1, toCar.t1 + M.getOut * pace, [side, doorPoint]);
  person.push(getIn, holdSeg(getIn.t1, Infinity, doorPoint, spot.yaw, { hidden: true }));

  // Car: reverse out into the aisle, drive to the exit barrier, wait for it, out to the map edge.
  const [sx, , sz] = spot.center;
  const back = rounded([[sx, 0, sz], [sx, 0, site.aisleOut], [sx + M.turn, 0, site.aisleOut]], M.turn);
  const forward = rounded([[sx + M.turn, 0, site.aisleOut], ...routes.fromSpot[trip.spot].slice(2), ...routes.depart[edge].slice(1)], M.turn);
  const sStop = distanceTo(forward, [site.exitLaneX, 0, site.barrierZ - GATE_STOP]);
  const [toGate, away] = splitAt(forward, sStop);
  const [speedUp, cruise] = splitAt(away, M.brake);
  const lot = M.lot / pace;
  const road = M.road / pace;
  // Wait in the spot until the aisle in front is clear (no car reversing nearby or driving past) and the
  // exit barrier will be free when we get there.
  const sweep = { x0: sx - 1.6, x1: sx + M.turn + 2.4 };
  let leave = getIn.t1 + delay;
  let r = moveSeg(leave, back, M.reverse / pace, "drive", { reverse: true });
  let g = moveSeg(r.t1, toGate, lot, "drive");
  let zones: Zone[] = [];
  for (let guard = 0; guard < 200; guard++) {
    r = moveSeg(leave, back, M.reverse / pace, "drive", { reverse: true });
    g = moveSeg(r.t1, toGate, lot, "drive");
    zones = [
      { ...sweep, from: leave, to: r.t1, drive: false },
      { x0: site.exitLaneX - 2, x1: sweep.x1, from: r.t1, to: g.t1, drive: true },
    ];
    // Cars driving out one after another don't clash; a reversing car clashes with anything nearby.
    const clash = st.aisle.find((z) => zones.some((m) => !(m.drive && z.drive) && m.x0 < z.x1 && z.x0 < m.x1 && m.from < z.to && z.from < m.to));
    if (clash) {
      leave = Math.max(leave, clash.to) + 0.1;
      continue;
    }
    const gateAt = fitSlot(st.exit, g.t1, M.gateRaise + M.gateClear);
    if (gateAt > g.t1 + EPS) {
      leave += gateAt - g.t1;
      continue;
    }
    break;
  }
  st.aisle.push(...zones);
  const car: Seg[] = [holdSeg(trip.start, leave, spot.center, spot.yaw)];
  car.push(r, g, holdSeg(g.t1, g.t1 + M.gateRaise * pace, toGate.at(-1)!, endYaw(g)));
  const a = moveSeg(g.t1 + M.gateRaise * pace, speedUp, road, "in");
  const c = moveSeg(a.t1, cruise, road, "linear");
  car.push(a, c, holdSeg(c.t1, Infinity, cruise.at(-1)!, endYaw(c), { hidden: true }));
  st.exit.push({ from: g.t1, to: a.t0 + M.gateClear });
  return { car, person, state: st, end: c.t1, tailFrom: a.t0 };
}

/** First time a car track is past z (driving towards +z), e.g. clear of the exit barrier. */
function passTime(segs: Seg[], z: number): number {
  for (const seg of segs) {
    if (seg.hidden) continue;
    for (let i = 0; i < seg.pts.length; i++) if (seg.pts[i][2] > z && seg.pts[0][2] < z) return seg.times[i];
  }
  return -Infinity;
}

/** Pace and (for arrivals) a later start so the trip ends exactly at start + duration. */
function fitTrip(w: TripWorld, state: State, trip: TripInput, duration: number): Plan & { state: State } {
  const sim = (pace: number, delay: number) => (trip.kind === "arrive" ? arriveSim(w, state, trip, pace, delay) : departSim(w, state, trip, pace, delay));
  const target = trip.start + duration;
  // Queues make the end time jump with the pace, so try a grid and keep the run whose final stretch
  // needs the least stretching or squeezing. Early even at the slowest pace: an arriving car sets off later,
  // a leaving one waits in its spot a little longer.
  const squeezeOf = (r: Sim) => {
    const from = Math.min(r.tailFrom, target);
    return r.end - from > EPS ? (target - from) / (r.end - from) : target >= r.end ? Infinity : 0;
  };
  // Prefer the natural pace a little, so an early trip doesn't dawdle and hold the gate or lift for later ones.
  // A leaving car may drive off to the map edge up to `STRETCH` times slower than usual (mostly off screen).
  const STRETCH = 2.5;
  const badness = (r: Sim, p: number) => {
    const sq = Math.max(1e-3, Math.min(1e3, squeezeOf(r)));
    const off = trip.kind === "depart" && sq > 1 ? Math.max(0, Math.log(sq / STRETCH)) : Math.abs(Math.log(sq)) * (sq < 1 ? 2 : 1);
    return off + 0.5 * Math.abs(Math.log(p));
  };
  let pace = 1;
  let delay = 0;
  let bestBad = Infinity;
  for (let p = M.paceMin; p <= M.paceMax + 1e-9; p += 0.025) {
    const bad = badness(sim(p, 0), p);
    if (bad < bestBad - 1e-9) [bestBad, pace] = [bad, p];
  }
  if (squeezeOf(sim(pace, 0)) > (trip.kind === "depart" ? STRETCH : 1.15)) {
    for (let d = 0.5; d < duration; d += 0.5) {
      const bad = badness(sim(pace, d), pace);
      if (bad < bestBad - 1e-9) [bestBad, delay] = [bad, d];
    }
  }

  const best = sim(pace, delay);
  const tailFrom = Math.min(best.tailFrom, target);
  // The final stretch (walk to the desk, drive to the map edge) takes up what is left, so the end is exact.
  const fit = (segs: Seg[]) => [...retime(segs.filter((x) => Number.isFinite(x.t1)), tailFrom, target), ...segs.filter((x) => !Number.isFinite(x.t1))];
  const person = trip.kind === "arrive" ? fit(best.person) : best.person;
  const car = trip.kind === "depart" ? fit(best.car) : best.car;
  const squeeze = squeezeOf(best);
  const next = { ...best.state, exit: [...best.state.exit] };
  if (trip.kind === "depart") {
    // The final drive was retimed: keep the exit barrier up until this car is really through.
    const through = passTime(car, w.site.barrierZ + 4.5);
    const last = next.exit.at(-1)!;
    next.exit[next.exit.length - 1] = { from: last.from, to: Math.max(last.to, through + 0.3) };
  }
  return { trip, end: target, car, person, pace, delay, squeeze, state: next };
}

/* ---------- public API ---------- */

export function tripWorld(building: BuildingLayout, site: SiteLayout, routes: Routes, walk: WalkGraph): TripWorld {
  return { building, site, routes, walk };
}

const durationOf = (d: Durations, kind: TripKind) => (kind === "arrive" ? d.arrive : d.depart);

/**
 * Trips that still matter at `now`: those in progress plus, transitively, earlier ones they may have queued
 * behind (a finished trip stays in the set while a trip planned after it is still under way).
 */
export function relevantTrips(trips: TripInput[], d: Durations, now: number): TripInput[] {
  const sorted = [...trips].sort((a, b) => a.start - b.start || a.agentId - b.agentId);
  const margin = L.home + 10;
  const endOf = (t: TripInput) => t.start + durationOf(d, t.kind) + margin;
  const keep = new Set<TripInput>();
  let horizon = now;
  for (let i = sorted.length - 1; i >= 0; i--) {
    const t = sorted[i];
    if (endOf(t) > horizon || endOf(t) > now) {
      keep.add(t);
      horizon = Math.min(horizon, t.start);
    }
  }
  return sorted.filter((t) => keep.has(t));
}

export function planTrips(trips: TripInput[], d: Durations, w: TripWorld): Schedule {
  let state: State = { entry: [], exit: [], reader: [], door: [], aisle: [], lift: [] };
  const plans: Plan[] = [];
  for (const trip of [...trips].sort((a, b) => a.start - b.start || a.agentId - b.agentId)) {
    const { state: next, ...plan } = fitTrip(w, state, trip, durationOf(d, trip.kind));
    state = next;
    plans.push({ ...plan, car: measured(plan.car), person: measured(plan.person) });
  }
  return { plans, props: state };
}

/* ---------- sampling ---------- */

export function measured(segs: Seg[]): Seg[] {
  let before = 0;
  return segs.map((seg) => {
    const cum = cumulative(seg.pts);
    const out = { ...seg, cum, before };
    before += cum.at(-1)!;
    return out;
  });
}

export type Pose = {
  visible: boolean;
  pos: Vec3;
  yaw: number;
  sit: number;
  walked: number;
  speed: number;
  tapping: boolean;
  riding: boolean;
  act?: LifeAct;
  carry?: boolean;
  partner?: number;
};

function segAt(segs: Seg[], t: number): Seg {
  for (const s of segs) if (t < s.t1) return s;
  return segs.at(-1)!;
}

function posIn(seg: Seg, t: number): Vec3 {
  const { pts, times } = seg;
  if (pts.length === 1 || t <= times[0]) return pts[0];
  if (t >= times.at(-1)!) return pts.at(-1)!;
  let i = 1;
  while (times[i] < t) i++;
  const k = (t - times[i - 1]) / (times[i] - times[i - 1] || 1);
  return lerp3(pts[i - 1], pts[i], k);
}

function walkedIn(seg: Seg, t: number): number {
  const cum = seg.cum ?? cumulative(seg.pts);
  const { times } = seg;
  if (seg.pts.length === 1 || t <= times[0]) return 0;
  if (t >= times.at(-1)!) return cum.at(-1)!;
  let i = 1;
  while (times[i] < t) i++;
  const k = (t - times[i - 1]) / (times[i] - times[i - 1] || 1);
  return lerp(cum[i - 1], cum[i], k);
}

/** Pose of an actor at time t; facing follows the motion, looking a little ahead and behind to turn smoothly. */
export function sample(segs: Seg[], t: number, lift?: { runs: LiftRun[]; ys: number[] }): Pose {
  const seg = segAt(segs, t);
  let pos = posIn(seg, t);
  if (seg.ride && lift) pos = [pos[0], liftY(lift.runs, lift.ys, t), pos[2]];
  let yaw = seg.yaw ?? 0;
  const moving = seg.pts.length > 1 && t > seg.t0 && t < seg.t1;
  if (seg.yaw === undefined || (moving && !seg.sit)) {
    const h = seg.reverse ? 0.35 : 0.3;
    const a = posIn(seg, Math.max(seg.t0, t - h));
    const b = posIn(seg, Math.min(seg.t1, t + h));
    if (dist2(a, b) > 0.02) yaw = yawOf(b[0] - a[0], b[2] - a[2]) + (seg.reverse ? Math.PI : 0);
    else yaw = endYaw(seg, seg.yaw ?? 0);
  }
  const sit = seg.sit ? lerp(seg.sit[0], seg.sit[1], Math.min(1, Math.max(0, (t - seg.t0) / (seg.t1 - seg.t0 || 1)))) : 0;
  const before = seg.before ?? 0;
  const dt = 0.1;
  const speed = moving ? dist2(posIn(seg, t - dt), posIn(seg, t + dt)) / (2 * dt) : 0;
  return {
    visible: !seg.hidden,
    pos,
    yaw,
    sit,
    walked: before + walkedIn(seg, t),
    speed,
    tapping: !!seg.tap && t >= seg.t0 && t < seg.t1,
    riding: !!seg.ride,
    act: seg.act,
    carry: seg.carry,
    partner: seg.partner,
  };
}

export const liftHeights = liftFloors;
export const LIFT_SLOTS = liftSlots;

/** Natural lengths of a lone trip to every desk (for tuning the backend durations). */
export function naturalDurations(w: TripWorld): { arrive: number[]; depart: number[] } {
  const arrive: number[] = [];
  const depart: number[] = [];
  const empty: State = { entry: [], exit: [], reader: [], door: [], aisle: [], lift: [] };
  for (const f of w.building.floors) {
    for (let d = 0; d < f.capacity; d++) {
      const trip = { agentId: d, start: 0, floorIndex: f.index, deskIndex: d, spot: w.site.deskSpot(f.index, d) };
      arrive.push(arriveSim(w, empty, { ...trip, kind: "arrive" }, 1, 0).end);
      depart.push(departSim(w, empty, { ...trip, kind: "depart" }, 1, 0).end);
    }
  }
  return { arrive, depart };
}

/**
 * Poses of everyone walking at time t. People who would pass through each other step aside, perpendicular
 * to their way, just enough to keep `gap` between them (seated and lift riders stay put).
 */
export function samplePeople(plans: Plan[], t: number, lift: { runs: LiftRun[]; ys: number[] }, gap = 0.5): Pose[] {
  return separate(plans.map((p) => sample(p.person, t, lift)), gap);
}

/** People closer than `gap` on the same floor step aside; seated, riding, tapping and talking people stay put. */
export function separate(input: Pose[], gap = 0.5): Pose[] {
  const poses = [...input];
  const free = (p: Pose) => p.visible && !p.riding && p.sit < 0.5 && !p.tapping && p.act !== "talk" && p.act !== "brew";
  for (let pass = 0; pass < 4; pass++)
  for (let i = 0; i < poses.length; i++) {
    for (let j = i + 1; j < poses.length; j++) {
      const [a, b] = [poses[i], poses[j]];
      if (!a.visible || !b.visible || Math.abs(a.pos[1] - b.pos[1]) > 1) continue;
      const dx = b.pos[0] - a.pos[0];
      const dz = b.pos[2] - a.pos[2];
      if (Math.hypot(dx, dz) >= gap - 1e-3) continue;
      const lead = a.speed >= b.speed ? a : b;
      const heading = [-Math.sin(lead.yaw), -Math.cos(lead.yaw)];
      const side = [-heading[1], heading[0]];
      const along = dx * heading[0] + dz * heading[1];
      const across = dx * side[0] + dz * side[1];
      const need = Math.sqrt(Math.max(0, gap * gap - along * along)) + 0.01;
      const sign = across === 0 ? 1 : Math.sign(across);
      const push = Math.max(0, need - Math.abs(across));
      const movers = [free(a), free(b)];
      const share = movers[0] && movers[1] ? push / 2 : push;
      const move = (p: Pose, k: number) => ({ ...p, pos: [p.pos[0] + side[0] * k, p.pos[1], p.pos[2] + side[1] * k] as Vec3 });
      if (movers[0]) poses[i] = move(a, -sign * share);
      if (movers[1]) poses[j] = move(b, sign * share);
    }
  }
  return poses;
}
