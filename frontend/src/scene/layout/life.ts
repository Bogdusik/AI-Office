/**
 * Office life: what agents do between arriving and leaving, as a pure function of their activity log
 * (`/state` → `activity_log`), the clock and their number. No model calls, no randomness that isn't hashed.
 *
 * - working: at the desk, typing. waiting for the model: at the desk leaning back; after `shortWait` s
 *   (or `busyWait` when someone else is already waiting too) a coffee trip — queue, brew, back with a cup.
 * - waiting for review: a seat on the lounge sofa (kitchen floor), else a place by the window on the own floor.
 * - idle: strolls on the own floor; idle and review agents on the same floor may meet for a talk.
 * - Any new activity interrupts: the agent heads to where the new activity wants them, in a hurry when
 *   going back to work. Between floors only the stairs (the lift belongs to arrivals and departures).
 *
 * Plans for all agents are built in time order (generators synchronised at coffee decisions, the only thing
 * they share as they go); seats and conversations are decided up front from the logs. A log entry that
 * arrives later only changes what happens after it, so a reload or another tab shows the same picture.
 */
import { type BuildingLayout, deskTransform } from "./building";
import { DIM } from "./dims";
import { type Interval, type LifeAct, type SeatRef, type Seg, holdSeg, measured, timedSeg, walkSeg, yawOf } from "./trips";
import type { Vec3 } from "./types";
import { WALK, type WalkGraph, findPathIds } from "./walk";

export type ActivityKind = "off_site" | "arriving" | "working" | "waiting_model" | "waiting_review" | "idle" | "leaving";
/** `since` in seconds on the server clock, oldest entry first. */
export type LifeInput = { agentId: number; floorIndex: number; deskIndex: number; log: { kind: ActivityKind; since: number }[] };
export type LifeWorld = { building: BuildingLayout; walk: WalkGraph };

/** Where someone stands: on the way from node `prev` to node `next` (the same node when standing on it). */
export type Spot = { pos: Vec3; prev: string; next: string };
/** State at the start of the agent's departure, handed to the trip planner. */
export type LeaveFrom = { at: Spot; seated: SeatRef | null; floor: number };

export type LifePlan = {
  agentId: number;
  segs: Seg[];
  /** Office life covers [from, to); before and after it the trip planner (or nothing) draws the agent. */
  from: number;
  to: number;
  cups: Interval[];
  leave: LeaveFrom | null;
};
export type LifeSchedule = { plans: LifePlan[]; horizon: number };

const LIFE = DIM.life;
const OFFICE: ActivityKind[] = ["working", "waiting_model", "waiting_review", "idle"];
const SETTLE = 6;

type Episode = { kind: ActivityKind; from: number; to: number };
type State = { t: number; at: Spot; seated: SeatRef | null; carry: boolean };
type QueueEntry = { agentId: number; arrive: number; serviceStart: number; serviceEnd: number; leaveAt: number; backAt: number };
type Talk = { partner: number; spot: string; face: string };

/** 32-bit integer hash (deterministic "randomness" from numbers). */
export function hash(...xs: number[]): number {
  let h = 2166136261;
  for (const x of xs) {
    h ^= Math.floor(x) | 0;
    h = Math.imul(h, 16777619);
    h ^= h >>> 13;
  }
  return h >>> 0;
}

export function episodesOf(log: LifeInput["log"]): Episode[] {
  return log.map((e, i) => ({ kind: e.kind, from: e.since, to: log[i + 1]?.since ?? Infinity }));
}

const leisure = (k: ActivityKind) => k === "idle" || k === "waiting_review";

/* ---------- places ---------- */

type Places = {
  kitchenFloor: number | null;
  sofaSeats: SeatRef[];
  windows: Map<number, string[]>;
  strolls: Map<number, string[]>;
  talks: Map<number, [string, string][]>;
};

function placesOf(w: LifeWorld): Places {
  const kitchen = w.building.floors.find((f) => f.hasKitchen) ?? null;
  const sofaSeats: SeatRef[] = [];
  if (kitchen) for (let k = 0; w.walk.nodes.has(WALK.sofa(kitchen.index, k)); k++) sofaSeats.push({ seat: WALK.sofa(kitchen.index, k), front: WALK.sofaFront(kitchen.index, k), yaw: Math.PI });
  const windows = new Map<number, string[]>();
  const strolls = new Map<number, string[]>();
  const talks = new Map<number, [string, string][]>();
  for (const f of w.building.floors) {
    if (f.kind !== "office") continue;
    const i = f.index;
    windows.set(i, Array.from({ length: DIM.deskCols }, (_, c) => WALK.window(i, c)).filter((id) => w.walk.nodes.has(id)));
    talks.set(i, [0, 1].map((p) => [WALK.talk(i, p, 0), WALK.talk(i, p, 1)] as [string, string]).filter(([a]) => w.walk.nodes.has(a)));
    const stroll = new RegExp(`^f${i}:(aisle\\d+:[lr]|back:[lr]|side|lounge|lounge:entry|kitchen:entry|director:door|talk\\d:\\d:line)$`);
    strolls.set(i, [...w.walk.nodes.keys()].filter((id) => stroll.test(id)).sort());
  }
  return { kitchenFloor: kitchen?.index ?? null, sofaSeats, windows, strolls, talks };
}

/* ---------- decisions taken up front from the logs ---------- */

type Rest = { seat: SeatRef } | { window: string } | null;

/** Where each review episode rests: first free sofa seat, else a free window on the own floor, else the desk. */
function restPlaces(agents: LifeInput[], places: Places): Map<string, Rest> {
  const reviews = agents
    .flatMap((a) => episodesOf(a.log).filter((e) => e.kind === "waiting_review").map((e) => ({ a, e })))
    .sort((x, y) => x.e.from - y.e.from || x.a.agentId - y.a.agentId);
  const taken: { key: string; from: number; to: number }[] = [];
  const out = new Map<string, Rest>();
  for (const { a, e } of reviews) {
    const free = (key: string) => !taken.some((x) => x.key === key && x.from < e.to && e.from < x.to);
    const seat = places.sofaSeats.find((s) => free(s.seat));
    const window = seat ? undefined : (places.windows.get(a.floorIndex) ?? []).find(free);
    const rest: Rest = seat ? { seat } : window ? { window } : null;
    if (seat) taken.push({ key: seat.seat, from: e.from, to: e.to });
    else if (window) taken.push({ key: window, from: e.from, to: e.to });
    out.set(`${a.agentId}@${e.from}`, rest);
  }
  return out;
}

/** Conversations: on every even leg, at most one pair per floor among agents at leisure there. */
function conversations(agents: LifeInput[], places: Places, rests: Map<string, Rest>, horizon: number, w: LifeWorld): Map<string, Talk> {
  const L = LIFE.leg;
  const byLeg = new Map<number, { id: number; floor: number }[]>();
  for (const a of agents) {
    for (const e of episodesOf(a.log)) {
      if (!leisure(e.kind)) continue;
      const rest = e.kind === "waiting_review" ? rests.get(`${a.agentId}@${e.from}`) : undefined;
      const floor = rest && "seat" in rest ? (w.walk.nodes.get(rest.seat.seat)?.floor ?? a.floorIndex) : a.floorIndex;
      const first = Math.ceil((e.from + 2 * SETTLE + 10) / (2 * L)) * 2;
      for (let n = first; n * L < Math.min(e.to, horizon); n += 2) byLeg.set(n, [...(byLeg.get(n) ?? []), { id: a.agentId, floor }]);
    }
  }
  const out = new Map<string, Talk>();
  for (const [n, all] of byLeg) {
    const floors = [...new Set(all.map((c) => c.floor))].sort((x, y) => x - y);
    for (const floor of floors) {
      const cands = all.filter((c) => c.floor === floor).map((c) => c.id).sort((x, y) => x - y);
      const pairs = places.talks.get(floor) ?? [];
      if (cands.length < 2 || pairs.length === 0) continue;
      const h = hash(n, floor, 7);
      if ((h % 1000) / 1000 >= LIFE.talkChance) continue;
      const i = h % cands.length;
      const j = (i + 1 + ((h >>> 10) % (cands.length - 1))) % cands.length;
      const [a, b] = [cands[i], cands[j]];
      const [sa, sb] = pairs[(h >>> 20) % pairs.length];
      out.set(`${a}@${n}`, { partner: b, spot: sa, face: sb });
      out.set(`${b}@${n}`, { partner: a, spot: sb, face: sa });
    }
  }
  return out;
}

/* ---------- walking primitives ---------- */

type Ctx = {
  w: LifeWorld;
  places: Places;
  rests: Map<string, Rest>;
  talks: Map<string, Talk>;
  horizon: number;
  queue: QueueEntry[];
  paths: Map<string, string[] | null>;
  waiting: (agentId: number, at: number) => number;
};

const nodeAt = (c: Ctx, id: string): Vec3 => c.w.walk.nodes.get(id)!.p;
const spotAt = (c: Ctx, id: string): Spot => ({ pos: nodeAt(c, id), prev: id, next: id });

function path(c: Ctx, from: string, to: string): string[] {
  const key = `${from}>${to}`;
  if (!c.paths.has(key)) c.paths.set(key, findPathIds(c.w.walk, from, to));
  return c.paths.get(key) ?? [from];
}

const lengthOf = (c: Ctx, ids: string[]) => ids.slice(1).reduce((n, id, i) => n + dist(nodeAt(c, ids[i]), nodeAt(c, id)), 0);
const dist = (a: Vec3, b: Vec3) => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);

function standUp(c: Ctx, s: State, out: Seg[], act?: LifeAct): State {
  if (!s.seated) return s;
  const front = nodeAt(c, s.seated.front);
  out.push(timedSeg(s.t, s.t + LIFE.stand, [s.at.pos, front], { sit: [1, 0], yaw: s.seated.yaw, act, carry: s.carry }));
  return { t: s.t + LIFE.stand, at: spotAt(c, s.seated.front), seated: null, carry: s.carry };
}

/** Walk to a node (standing up first); from between two nodes it goes on via whichever end is shorter. */
function walkTo(c: Ctx, s0: State, target: string, out: Seg[], hurry = false): State {
  let s = standUp(c, s0, out);
  const { at } = s;
  const viaPrev = path(c, at.prev, target);
  const viaNext = path(c, at.next, target);
  const cost = (ids: string[]) => dist(at.pos, nodeAt(c, ids[0])) + lengthOf(c, ids);
  const ids = cost(viaNext) <= cost(viaPrev) ? viaNext : viaPrev;
  const pts = [at.pos, ...ids.map((id) => nodeAt(c, id))];
  const marks = ["", ...ids];
  if (dist(pts[0], pts[1]) < 1e-3) {
    pts.shift();
    marks.shift();
  }
  if (pts.length > 1) {
    const seg = walkSeg(s.t, pts, hurry ? 1 / LIFE.hurry : 1, { ids: marks, carry: s.carry });
    out.push(seg);
    s = { ...s, t: seg.t1 };
  }
  return { ...s, at: spotAt(c, target) };
}

function sitDown(c: Ctx, s0: State, seat: SeatRef, out: Seg[], hurry = false): State {
  if (s0.seated?.seat === seat.seat) return s0;
  const s = walkTo(c, s0, seat.front, out, hurry);
  const t1 = s.t + LIFE.stand;
  out.push(timedSeg(s.t, t1, [nodeAt(c, seat.front), nodeAt(c, seat.seat)], { sit: [0, 1], yaw: seat.yaw, seat, carry: s.carry }));
  return { t: t1, at: spotAt(c, seat.seat), seated: seat, carry: s.carry };
}

function hold(s: State, until: number, out: Seg[], act: LifeAct, yaw: number, extra: Partial<Seg> = {}): State {
  if (until <= s.t) return s;
  const seated = s.seated ? { sit: [1, 1] as [number, number], seat: s.seated, yaw: s.seated.yaw } : { yaw };
  out.push(holdSeg(s.t, until, s.at.pos, seated.yaw, { act, carry: s.carry, ...seated, ...extra, ids: [s.at.prev] }));
  return { ...s, t: until };
}

/** Facing at the end of what has been planned so far. */
function lastYaw(out: Seg[]): number {
  for (let i = out.length - 1; i >= 0; i--) {
    const seg = out[i];
    if (seg.pts.length > 1) {
      const [a, b] = [seg.pts.at(-2)!, seg.pts.at(-1)!];
      if (Math.hypot(b[0] - a[0], b[2] - a[2]) > 1e-3) return yawOf(b[0] - a[0], b[2] - a[2]);
    }
    if (seg.yaw !== undefined) return seg.yaw;
  }
  return 0;
}

/**
 * Keeps what happens before `end`; returns the state there. A sit/stand move in progress is finished first
 * (never a half-seated jump), so the next activity may start up to a second later.
 */
function cut(c: Ctx, segs: Seg[], end: number): { kept: Seg[]; state: State | null } {
  const kept: Seg[] = [];
  for (const seg of segs) {
    if (seg.t0 >= end) break;
    if (seg.t1 <= end || seg.sit?.[0] !== seg.sit?.[1]) {
      kept.push(seg);
      continue;
    }
    if (seg.pts.length === 1) {
      kept.push({ ...seg, t1: end });
      continue;
    }
    let i = 0;
    while (seg.times[i + 1] <= end) i++;
    const k = (end - seg.times[i]) / (seg.times[i + 1] - seg.times[i] || 1);
    const a = seg.pts[i];
    const b = seg.pts[i + 1];
    const p: Vec3 = [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
    const ids = seg.ids ?? [];
    kept.push({ ...seg, t1: end, pts: [...seg.pts.slice(0, i + 1), p], times: [...seg.times.slice(0, i + 1), end], ids: [...ids.slice(0, i + 1), ""] });
    // Cut mid-edge: between the last node passed and the one the walk was heading to.
    const prev = ids.slice(0, i + 1).reverse().find(Boolean) ?? ids.find(Boolean) ?? "";
    const next = ids.slice(i + 1).find(Boolean) ?? prev;
    return { kept, state: { t: end, at: { pos: p, prev, next }, seated: null, carry: !!seg.carry } };
  }
  const last = kept.at(-1);
  if (!last) return { kept, state: null };
  const t = Math.max(end, last.t1 === Infinity ? end : last.t1);
  return { kept, state: stateAfter(c, last, t) };
}

function stateAfter(c: Ctx, seg: Seg, t: number): State {
  const ids = seg.ids ?? [];
  const pos = seg.pts.at(-1)!;
  if (seg.sit && seg.sit[1] === 1 && seg.seat) return { t, at: spotAt(c, seg.seat.seat), seated: seg.seat, carry: !!seg.carry };
  const lastId = [...ids].reverse().find(Boolean) ?? "";
  return { t, at: lastId ? { ...spotAt(c, lastId), pos } : { pos, prev: "", next: "" }, seated: null, carry: !!seg.carry };
}

/* ---------- behaviours ---------- */

function deskSeat(a: LifeInput): SeatRef {
  return { seat: WALK.seat(a.floorIndex, a.deskIndex), front: WALK.approach(a.floorIndex, a.deskIndex), yaw: 0 };
}

const atDesk = (s: State, a: LifeInput) => s.seated?.seat === WALK.seat(a.floorIndex, a.deskIndex);

function* waitingModel(c: Ctx, a: LifeInput, e: Episode, s0: State, out: Seg[], cups: Interval[]): Generator<number, State, void> {
  let s = sitDown(c, s0, deskSeat(a), out);
  const ahead = c.waiting(a.agentId, e.from);
  // Several in the model queue (someone else already waiting) → coffee sooner.
  const decide = Math.max(s.t, e.from + (ahead >= 1 ? LIFE.busyWait : LIFE.shortWait));
  if (decide >= e.to || decide >= c.horizon) return hold(s, Infinity, out, "lean", 0);
  s = hold(s, decide, out, "lean", 0);
  yield decide;
  const busy = c.queue.filter((q) => q.backAt > decide).length;
  const kitchen = c.places.kitchenFloor;
  if (kitchen === null || busy >= LIFE.coffeeTrips) return hold(s, Infinity, out, "lean", 0);

  // Walk to the end of the queue, step forward as people ahead leave, brew, go back the other way.
  // My place = how many of those who decided earlier are still in the queue when I get there.
  const reachAt = (p: number) => walkTo(c, s, WALK.coffee(kitchen, p), []).t;
  let place = 3;
  for (let k = 0; k < 4; k++) {
    const t = reachAt(place);
    const count = Math.min(3, c.queue.filter((q) => q.leaveAt > t).length);
    if (count === place) break;
    place = count;
  }
  const ahead2 = c.queue.filter((q) => q.leaveAt > reachAt(place)).sort((x, y) => x.leaveAt - y.leaveAt);
  place = Math.min(3, Math.max(place, ahead2.length));
  s = walkTo(c, s, WALK.coffee(kitchen, place), out);
  const arrive = s.t;
  for (const q of ahead2) {
    if (place === 0) break;
    const t = Math.max(s.t, q.leaveAt);
    s = hold(s, t, out, "stand", 0);
    const next = place - 1;
    out.push(timedSeg(t, t + LIFE.queueStep, [nodeAt(c, WALK.coffee(kitchen, place)), nodeAt(c, WALK.coffee(kitchen, next))], { ids: [WALK.coffee(kitchen, place), WALK.coffee(kitchen, next)] }));
    s = { ...s, t: t + LIFE.queueStep, at: spotAt(c, WALK.coffee(kitchen, next)) };
    place = next;
  }
  const serviceStart = Math.max(s.t, ahead2.at(-1)?.leaveAt ?? s.t);
  const serviceEnd = serviceStart + LIFE.brew;
  s = hold(s, serviceStart, out, "stand", 0);
  s = hold(s, serviceEnd, out, "brew", 0);
  s = { ...s, carry: true };
  s = sitDown(c, s, deskSeat(a), out);
  const back = s.t;
  const entry: QueueEntry = { agentId: a.agentId, arrive, serviceStart, serviceEnd, leaveAt: Math.min(serviceEnd, e.to), backAt: Math.min(back, e.to) };
  c.queue.push(entry);
  if (back < e.to) cups.push({ from: back, to: Infinity });
  return hold({ ...s, carry: false }, Infinity, out, "lean", 0);
}

/** Strolls (idle) or rest (review) on the global leg grid, with conversations. */
function atLeisure(c: Ctx, a: LifeInput, e: Episode, s0: State, out: Seg[]): State {
  const L = LIFE.leg;
  const rest = e.kind === "waiting_review" ? (c.rests.get(`${a.agentId}@${e.from}`) ?? null) : undefined;
  const strolls = c.places.strolls.get(a.floorIndex) ?? [];
  const waypoint = (n: number) => strolls[(hash(n, a.floorIndex, 3) + a.deskIndex * 5) % Math.max(1, strolls.length)];
  const home = (s: State, n: number): State => {
    if (rest === null) return sitDown(c, s, deskSeat(a), out);
    if (rest && "seat" in rest) return sitDown(c, s, rest.seat, out);
    if (rest && "window" in rest) return walkTo(c, s, rest.window, out);
    return strolls.length ? walkTo(c, s, waypoint(n), out) : s;
  };
  const restAct = (): LifeAct => (rest && "seat" in rest ? "sofa" : rest && "window" in rest ? "window" : rest === null ? "lean" : "stand");
  const restYaw = (): number => (rest && "window" in rest ? 0 : lastYaw(out));

  let s = s0.seated ? hold(s0, s0.t + SETTLE + (hash(a.agentId, e.from) % 5), out, s0.seated.seat === deskSeat(a).seat ? "lean" : restAct(), 0) : s0;
  s = home(s, Math.floor(s.t / L) + 1);
  let n = Math.ceil(s.t / L);
  const end = Math.min(e.to, c.horizon);
  while (n * L < end) {
    const talk = n % 2 === 0 ? c.talks.get(`${a.agentId}@${n}`) : undefined;
    if (talk) {
      s = hold(s, n * L, out, restAct(), restYaw());
      s = walkTo(c, s, talk.spot, out);
      const mine = nodeAt(c, talk.spot);
      const other = nodeAt(c, talk.face);
      s = hold(s, (n + 2) * L, out, "talk", yawOf(other[0] - mine[0], other[2] - mine[2]), { partner: talk.partner });
      n += 2;
      s = home(s, n);
      continue;
    }
    s = hold(s, Math.max(s.t, n * L), out, restAct(), restYaw());
    if (rest === undefined) s = home(s, n + 1);
    n += 1;
  }
  return hold(s, Infinity, out, restAct(), restYaw());
}

function* lifeOf(c: Ctx, a: LifeInput): Generator<number, LifePlan, void> {
  const segs: Seg[] = [];
  const cups: Interval[] = [];
  let state: State | null = null;
  let from = Infinity;
  let to = Infinity;
  let leave: LeaveFrom | null = null;
  for (const e of episodesOf(a.log)) {
    if (e.kind === "arriving") {
      state = { t: e.to, at: spotAt(c, WALK.seat(a.floorIndex, a.deskIndex)), seated: deskSeat(a), carry: false };
      continue;
    }
    if (!OFFICE.includes(e.kind)) {
      if (e.kind === "leaving" && state) {
        leave = { at: state.at, seated: state.seated, floor: c.w.walk.nodes.get(state.at.prev)?.floor ?? a.floorIndex };
        to = e.from;
      }
      state = null;
      for (const cup of cups) cup.to = Math.min(cup.to, e.from);
      continue;
    }
    if (!state) state = { t: e.from, at: spotAt(c, WALK.seat(a.floorIndex, a.deskIndex)), seated: deskSeat(a), carry: false };
    if (from === Infinity || to !== Infinity) {
      from = Math.max(e.from, state.t);
      to = Infinity;
      leave = null;
    }
    const s0: State = { ...state, t: Math.max(state.t, e.from) };
    const out: Seg[] = [];
    if (e.kind === "working") hold(sitDown(c, s0, deskSeat(a), out, !atDesk(s0, a)), Infinity, out, "type", 0);
    else if (e.kind === "waiting_model") yield* waitingModel(c, a, e, s0, out, cups);
    else atLeisure(c, a, e, s0, out);
    const done = cut(c, out, e.to);
    segs.push(...done.kept);
    state = done.state ?? s0;
  }
  return { agentId: a.agentId, segs: measured(segs), from: Number.isFinite(from) ? from : Infinity, to, cups, leave };
}

/** Plans everyone's office life up to `horizon` (s); time order is shared only at coffee decisions. */
export function planLife(agents: LifeInput[], w: LifeWorld, horizon: number): LifeSchedule {
  const places = placesOf(w);
  const rests = restPlaces(agents, places);
  const sorted = [...agents].sort((x, y) => x.agentId - y.agentId);
  const c: Ctx = {
    w,
    places,
    rests,
    talks: conversations(sorted, places, rests, horizon, w),
    horizon,
    queue: [],
    paths: new Map(),
    waiting: (agentId, at) =>
      sorted.filter((o) => o.agentId !== agentId && episodesOf(o.log).some((e) => e.kind === "waiting_model" && e.from < at && e.to > at)).length,
  };
  const runs = sorted.map((a) => ({ a, g: lifeOf(c, a), at: 0, plan: null as LifePlan | null }));
  for (const r of runs) {
    const step = r.g.next();
    if (step.done) r.plan = step.value;
    else r.at = step.value;
  }
  for (;;) {
    const next = runs.filter((r) => !r.plan).sort((x, y) => x.at - y.at || x.a.agentId - y.a.agentId)[0];
    if (!next) break;
    const step = next.g.next();
    if (step.done) next.plan = step.value;
    else next.at = step.value;
  }
  return { plans: runs.map((r) => r.plan!), horizon };
}

/** Desk position of an agent's cup (on the desk top, right of the keyboard). */
export function cupPosition(b: BuildingLayout, floorIndex: number, deskIndex: number): Vec3 {
  const [x, , z] = deskTransform(deskIndex).desk;
  return [x + 0.55, b.floors[floorIndex].baseY + DIM.desk.h, z + 0.15];
}
