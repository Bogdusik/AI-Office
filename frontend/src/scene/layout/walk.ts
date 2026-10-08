/**
 * Where people can walk: a graph of points inside the building (every floor, the stairs between floors)
 * and outside (from each parking spot to the entrance), with obstacle footprints to check it against.
 * The lift is not an edge here: the trip planner rides it between the `lift` points of two floors.
 */
import {
  type BuildingLayout,
  type FloorLayout,
  coreLayout,
  deskTransform,
  elevatorOpening,
  entranceDoorX,
  entranceLayout,
  kitchenLayout,
  loungeLayout,
  officeFurniture,
  partitionLayout,
  receptionLayout,
  serverRoomLayout,
  stairOpening,
} from "./building";
import { DIM } from "./dims";
import type { SiteLayout } from "./site";
import { type Rect, type Vec3, rectCenter } from "./types";

export type WalkNode = { id: string; p: Vec3; floor: number | null };
export type WalkEdge = { a: string; b: string; stairs: boolean };
export type WalkGraph = { nodes: Map<string, WalkNode>; edges: WalkEdge[]; adjacent: Map<string, { to: string; cost: number }[]> };

/** Node ids the planner and the checks address directly; `f` is the floor index (0 = ground). */
export const WALK = {
  outsideDoor: "out:door",
  reader: "out:reader",
  insideDoor: "f0:door",
  lift: (f: number) => `f${f}:lift`,
  stairs: (f: number) => `f${f}:stairs`,
  approach: (f: number, desk: number) => `f${f}:approach${desk}`,
  seat: (f: number, desk: number) => `f${f}:seat${desk}`,
  kitchen: (f: number) => `f${f}:kitchen`,
  lounge: (f: number) => `f${f}:lounge`,
  serverDoor: (f: number) => `f${f}:server`,
  director: (f: number) => `f${f}:director`,
  carSide: (spot: number) => `spot${spot}:side`,
};

/** Seated agents sit at `seat`; the stair landing is entered through `stairOpening`. */
const p3 = (x: number, y: number, z: number): Vec3 => [x, y, z];

class Builder {
  nodes = new Map<string, WalkNode>();
  edges: WalkEdge[] = [];
  add(id: string, p: Vec3, floor: number | null) {
    this.nodes.set(id, { id, p, floor });
    return id;
  }
  link(a: string, b: string, stairs = false) {
    this.edges.push({ a, b, stairs });
  }
  chain(ids: string[]) {
    for (let i = 1; i < ids.length; i++) this.link(ids[i - 1], ids[i]);
  }
  /** Links nodes lying on one line in order of the given coordinate. */
  line(ids: string[], axis: 0 | 2) {
    this.chain([...ids].sort((a, b) => this.nodes.get(a)!.p[axis] - this.nodes.get(b)!.p[axis]));
  }
}

const deskRows = (capacity: number) => Math.ceil(capacity / DIM.deskCols);
const deskRowZ = (row: number) => deskTransform(row * DIM.deskCols).desk[2];
const chairBack = (row: number) => deskRowZ(row) + DIM.chair.offset + 0.35;

/** Corridor x positions in the desk zone: by the left wall and past the last desk column. */
function corridors(b: BuildingLayout) {
  const innerWall = DIM.wall;
  const firstDesk = deskTransform(0).desk[0] - DIM.desk.w / 2;
  const lastDesk = deskTransform(DIM.deskCols - 1).desk[0] + DIM.desk.w / 2;
  return { left: (innerWall + firstDesk) / 2, right: (lastDesk + b.deskZone.x1) / 2 };
}

/** z of the walkway behind desk row `row` (between its chairs and the next row or the front wall). */
function aisleZ(b: BuildingLayout, row: number, rows: number) {
  const next = row + 1 < rows ? deskRowZ(row + 1) - DIM.desk.d / 2 : b.depth - DIM.wall;
  return (chairBack(row) + next) / 2;
}

const sideCorridorZ = (b: BuildingLayout) => (b.officeRoom.z1 + b.depth - DIM.wall) / 2;
const liftZ = (b: BuildingLayout) => {
  const o = elevatorOpening(b);
  return (o.from + o.to) / 2;
};
const stairZ = (b: BuildingLayout) => {
  const o = stairOpening(b);
  return (o.from + o.to) / 2;
};

function officeFloor(g: Builder, b: BuildingLayout, f: FloorLayout) {
  const i = f.index;
  const y = f.baseY;
  const { left, right } = corridors(b);
  const rows = deskRows(f.capacity);
  const leftIds = [g.add(WALK.lift(i), p3(left, y, liftZ(b)), i), g.add(WALK.stairs(i), p3(left, y, stairZ(b)), i)];
  const rightIds: string[] = [];

  for (let r = 0; r < rows; r++) {
    const z = aisleZ(b, r, rows);
    const l = g.add(`f${i}:aisle${r}:l`, p3(left, y, z), i);
    const rr = g.add(`f${i}:aisle${r}:r`, p3(right, y, z), i);
    leftIds.push(l);
    rightIds.push(rr);
    const row = [l, rr];
    for (let c = 0; c < DIM.deskCols; c++) {
      const d = r * DIM.deskCols + c;
      if (d >= f.capacity) break;
      const t = deskTransform(d);
      const a = g.add(`f${i}:aisle${r}:${c}`, p3(t.desk[0], y, z), i);
      const ap = g.add(WALK.approach(i, d), p3(t.desk[0], y, t.seat[2] + 0.65), i);
      const seat = g.add(WALK.seat(i, d), p3(t.seat[0], y, t.seat[2]), i);
      g.chain([a, ap, seat]);
      row.push(a);
    }
    g.line(row, 0);
  }
  g.line(leftIds, 2);

  const sz = sideCorridorZ(b);
  const side = g.add(`f${i}:side`, p3(b.sideZone.x0 + 0.8, y, sz), i);
  const along = [side];
  if (f.hasKitchen) {
    const mid = b.depth / 2;
    const inner = g.add(`f${i}:partition:in`, p3(right, y, mid), i);
    const outer = g.add(`f${i}:partition:out`, p3(b.sideZone.x0 + 0.8, y, mid), i);
    rightIds.push(inner);
    g.chain([inner, outer, side]);
  } else {
    g.link(rightIds.reduce((a, c) => (g.nodes.get(c)!.p[2] > g.nodes.get(a)!.p[2] ? c : a)), side);
  }
  g.line(rightIds, 2);

  if (f.hasDirectorOffice) {
    const o = officeFurniture(b.officeRoom);
    const x = (o.doorGap.from + o.doorGap.to) / 2;
    const door = g.add(`f${i}:director:door`, p3(x, y, sz), i);
    along.push(door);
    g.link(door, g.add(WALK.director(i), p3(x, y, b.officeRoom.z1 - 1.2), i));
  } else {
    const l = loungeLayout(b.sideZone);
    const x = l.sofa.position[0];
    const entry = g.add(`f${i}:lounge:entry`, p3(x, y, sz), i);
    along.push(entry);
    g.link(entry, g.add(WALK.lounge(i), p3(x, y, l.table[2] + 0.9), i));
  }

  if (f.hasServerRoom) {
    const s = serverRoomLayout(b.kitchenZone);
    const x = (s.doorGap.from + s.doorGap.to) / 2;
    const door = g.add(`f${i}:server:door`, p3(x, y, sz), i);
    along.push(door);
    g.link(door, g.add(WALK.serverDoor(i), p3(x, y, s.room.z1 - 0.9), i));
  } else if (f.hasKitchen) {
    const k = kitchenLayout(b.kitchenZone);
    const x = b.kitchenZone.x0 + 0.6;
    const entry = g.add(`f${i}:kitchen:entry`, p3(x, y, sz), i);
    const corner = g.add(`f${i}:kitchen:corner`, p3(x, y, k.counter.position[2] + 1.1), i);
    along.push(entry);
    g.chain([entry, corner, g.add(WALK.kitchen(i), p3(k.counter.position[0], y, k.counter.position[2] + 1.1), i)]);
  }
  g.line(along, 0);
}

function groundFloor(g: Builder, b: BuildingLayout, f: FloorLayout) {
  const y = f.baseY;
  const { left } = corridors(b);
  const x = entranceDoorX(b);
  const lobbyZ = b.depth - 1.7;
  const door = g.add(WALK.insideDoor, p3(x, y, b.depth - DIM.walk.inside), 0);
  const turn = g.add("f0:lobby:turn", p3(x - 1.2, y, lobbyZ), 0);
  const west = g.add("f0:lobby:west", p3(left, y, lobbyZ), 0);
  g.chain([door, turn, west]);
  g.line([west, g.add(WALK.lift(0), p3(left, y, liftZ(b)), 0), g.add(WALK.stairs(0), p3(left, y, stairZ(b)), 0)], 2);
}

/** Switchback stairs from floor `f` to the next one: flight A towards −z, mid landing, flight B back. */
function stairs(g: Builder, b: BuildingLayout, f: FloorLayout, up: FloorLayout) {
  const well = coreLayout(b).stairwell;
  const { landing } = DIM.core;
  const { laneW } = DIM.stair;
  const xa = well.x0 + laneW / 2;
  const xb = well.x1 - laneW / 2;
  const runStart = well.z1 - landing;
  const midZ1 = well.z0 + landing;
  const midZ = (well.z0 + midZ1) / 2;
  const half = f.baseY + b.pitch / 2;
  const s = stairZ(b);
  const k = `st${f.index}`;
  const ids = [
    WALK.stairs(f.index),
    g.add(`${k}:a0`, p3(xa, f.baseY, s), f.index),
    g.add(`${k}:a1`, p3(xa, f.baseY, runStart), f.index),
    g.add(`${k}:a2`, p3(xa, half, midZ1), f.index),
    g.add(`${k}:m0`, p3(xa, half, midZ), f.index),
    g.add(`${k}:m1`, p3(xb, half, midZ), f.index),
    g.add(`${k}:b0`, p3(xb, half, midZ1), f.index),
    g.add(`${k}:b1`, p3(xb, up.baseY, runStart), up.index),
    g.add(`${k}:b2`, p3(xb, up.baseY, s), up.index),
    WALK.stairs(up.index),
  ];
  for (let i = 1; i < ids.length; i++) g.link(ids[i - 1], ids[i], true);
}

/** Outside: car side → aisle → pedestrian gate → along the front of the building → reader → doors. */
function outdoors(g: Builder, b: BuildingLayout, site: SiteLayout) {
  const e = entranceLayout(b, site.roads.main.z0);
  const x = entranceDoorX(b);
  const gateX = site.lot.x0 - DIM.fence.inset;
  const out = g.add(WALK.outsideDoor, p3(x, 0, b.depth + DIM.walk.outside), null);
  // Leaving people pass the reader stand too (without tapping): the reader post is next to the door.
  const reader = g.add(WALK.reader, p3(e.reader[0], 0, e.reader[2] + DIM.walk.readerStand), null);
  const corner = g.add("out:corner", p3(b.width + 2.5, 0, e.reader[2] + DIM.walk.readerStand), null);
  const gateOut = g.add("out:gate:out", p3(gateX - 0.9, 0, site.aisleZ), null);
  const gateIn = g.add("out:gate:in", p3(site.lot.x0 + 0.5, 0, site.aisleZ), null);
  g.link(WALK.insideDoor, out);
  g.chain([out, reader, corner, gateOut, gateIn]);

  const aisle = [gateIn];
  for (const spot of site.spots) {
    const [sx, , sz] = spot.center;
    // Driver's door: on the right in a UK car; back-row cars face −z, front-row cars face +z.
    const side = spot.yaw === 0 ? 1 : -1;
    const px = sx + side * DIM.walk.carSide;
    const a = g.add(`spot${spot.index}:aisle`, p3(px, 0, site.aisleZ), null);
    aisle.push(a);
    g.link(a, g.add(WALK.carSide(spot.index), p3(px, 0, sz), null));
  }
  g.line(aisle, 0);
}

export function walkGraph(b: BuildingLayout, site: SiteLayout): WalkGraph {
  const g = new Builder();
  for (const f of b.floors) (f.kind === "reception" ? groundFloor : officeFloor)(g, b, f);
  for (let i = 0; i + 1 < b.floors.length; i++) stairs(g, b, b.floors[i], b.floors[i + 1]);
  outdoors(g, b, site);

  const adjacent = new Map<string, { to: string; cost: number }[]>();
  const push = (from: string, to: string, cost: number) => adjacent.set(from, [...(adjacent.get(from) ?? []), { to, cost }]);
  for (const e of g.edges) {
    const a = g.nodes.get(e.a);
    const c = g.nodes.get(e.b);
    if (!a || !c) throw new Error(`walk edge ${e.a} → ${e.b} has a missing end`);
    const len = Math.hypot(a.p[0] - c.p[0], a.p[1] - c.p[1], a.p[2] - c.p[2]);
    const cost = e.stairs ? len * (DIM.motion.walk / DIM.motion.stairs) : len;
    push(e.a, e.b, cost);
    push(e.b, e.a, cost);
  }
  return { nodes: g.nodes, edges: g.edges, adjacent };
}

/** Shortest walk between two nodes (Dijkstra; stairs cost their slower pace). Points include both ends. */
export function findPath(g: WalkGraph, from: string, to: string): Vec3[] | null {
  if (!g.nodes.has(from) || !g.nodes.has(to)) return null;
  const dist = new Map<string, number>([[from, 0]]);
  const prev = new Map<string, string>();
  const open = new Set([from]);
  while (open.size) {
    let cur = "";
    let best = Infinity;
    for (const id of open) {
      const d = dist.get(id)!;
      if (d < best) [cur, best] = [id, d];
    }
    open.delete(cur);
    if (cur === to) break;
    for (const { to: next, cost } of g.adjacent.get(cur) ?? []) {
      const d = best + cost;
      if (d < (dist.get(next) ?? Infinity)) {
        dist.set(next, d);
        prev.set(next, cur);
        open.add(next);
      }
    }
  }
  if (!dist.has(to)) return null;
  const ids = [to];
  while (ids[0] !== from) ids.unshift(prev.get(ids[0])!);
  return ids.map((id) => g.nodes.get(id)!.p);
}

/* ---------- obstacles (for checks) ---------- */

const around = (x: number, z: number, w: number, d: number): Rect => ({ x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2 });

/** Wall along x or z with gaps; returns the solid stretches as thin rects. */
function wallRects(fixed: number, alongZ: boolean, from: number, to: number, gaps: { from: number; to: number }[]): Rect[] {
  const t = DIM.wall / 2;
  const out: Rect[] = [];
  let cursor = from;
  for (const gap of [...gaps].sort((a, c) => a.from - c.from)) {
    if (gap.from > cursor) out.push(alongZ ? { x0: fixed - t, x1: fixed + t, z0: cursor, z1: gap.from } : { x0: cursor, x1: gap.from, z0: fixed - t, z1: fixed + t });
    cursor = Math.max(cursor, gap.to);
  }
  if (cursor < to) out.push(alongZ ? { x0: fixed - t, x1: fixed + t, z0: cursor, z1: to } : { x0: cursor, x1: to, z0: fixed - t, z1: fixed + t });
  return out;
}

function glassRoomRects(room: Rect, door: { from: number; to: number }): Rect[] {
  return [
    ...wallRects(room.x0, true, room.z0, room.z1, []),
    ...wallRects(room.x1, true, room.z0, room.z1, []),
    ...wallRects(room.z1, false, room.x0, room.x1, [door]),
  ];
}

/** Footprints a walking person must keep clear of on a floor (walls with their openings, rooms, furniture). */
export function floorObstacles(b: BuildingLayout, f: FloorLayout): Rect[] {
  const t = DIM.wall / 2;
  const doorX = entranceDoorX(b);
  const front = f.isGround ? [{ from: doorX - DIM.door.w / 2, to: doorX + DIM.door.w / 2 }] : [];
  const out: Rect[] = [
    ...wallRects(t, false, 0, b.width, []),
    ...wallRects(b.depth - t, false, 0, b.width, front),
    ...wallRects(t, true, 0, b.depth, [elevatorOpening(b), stairOpening(b)]),
    ...wallRects(b.width - t, true, 0, b.depth, []),
  ];
  const plant = (p: Vec3, scale = 1) => around(p[0], p[2], 0.9 * scale, 0.9 * scale);

  if (f.kind === "reception") {
    const r = receptionLayout(b);
    out.push(around(r.desk.position[0], r.desk.position[2] + 0.2, 4.6, 0.8));
    for (const s of r.staff) out.push(around(s.position[0], s.position[2], 0.6, 0.6));
    for (const g of r.groups) {
      out.push(around(g.sofa.position[0], g.sofa.position[2], 2.4, 0.9));
      for (const a of g.armchairs) out.push(around(a.position[0], a.position[2], 0.9, 1));
      out.push(around(g.table[0], g.table[2], 1.2, 0.7), plant(g.plant, 1.1));
    }
    for (const p of r.plants) out.push(plant(p, 1.2));
    return out;
  }

  for (let d = 0; d < f.capacity; d++) {
    const [x, , z] = deskTransform(d).desk;
    out.push(around(x, z, DIM.desk.w, DIM.desk.d));
  }
  if (f.hasDirectorOffice) {
    const o = officeFurniture(b.officeRoom);
    out.push(...glassRoomRects(b.officeRoom, o.doorGap));
    out.push(around(o.desk.position[0], o.desk.position[2], DIM.desk.w, DIM.desk.d), around(o.meetingTable.position[0], o.meetingTable.position[2], 1.3, 1.3));
    for (const c of o.meetingChairs) out.push(around(c.position[0], c.position[2], 0.45, 0.45));
    out.push(around(o.shelf.position[0], o.shelf.position[2], 0.4, 2));
    for (const p of o.plants) out.push(plant(p));
  } else {
    const l = loungeLayout(b.sideZone);
    out.push(around(l.sofa.position[0], l.sofa.position[2], 2.6, 0.9), around(l.table[0], l.table[2], 1.2, 0.7));
    for (const p of l.plants) out.push(plant(p));
  }
  if (f.hasServerRoom) {
    const s = serverRoomLayout(b.kitchenZone);
    out.push(...glassRoomRects(s.room, s.doorGap));
    const { w, d } = DIM.server.rack;
    for (const r of s.racks) out.push(around(r.position[0], r.position[2], w, d));
    out.push(around(s.cooler.position[0], s.cooler.position[2], 0.7, 0.6));
  } else if (f.hasKitchen) {
    const k = kitchenLayout(b.kitchenZone);
    out.push(around(k.counter.position[0], k.counter.position[2], k.counterLength, 0.68), around(k.fridge.position[0], k.fridge.position[2], 0.75, 0.7));
    out.push(around(k.table.position[0], k.table.position[2], 1.6, 0.9));
    for (const c of k.chairs) out.push(around(c.position[0], c.position[2], 0.44, 0.42));
    out.push(plant(k.plant));
    const p = partitionLayout(b);
    for (const seg of p.segments) out.push({ x0: p.x - 0.05, x1: p.x + 0.05, z0: seg.z0, z1: seg.z1 });
  } else {
    const [kx, kz] = rectCenter(b.kitchenZone);
    for (const dz of [-1.5, 1.5]) out.push(plant([kx, 0, kz + dz], 1.2));
  }
  return out;
}

/** Lines a person must not cross outside: fences, the building walls (except the door) and the island. */
export function outdoorObstacles(b: BuildingLayout, site: SiteLayout, extra: Rect[] = []): Rect[] {
  const fence = site.fence.map(({ from: [x0, z0], to: [x1, z1] }) => ({ x0: Math.min(x0, x1) - 0.05, x1: Math.max(x0, x1) + 0.05, z0: Math.min(z0, z1) - 0.05, z1: Math.max(z0, z1) + 0.05 }));
  const doorX = entranceDoorX(b);
  return [
    ...fence,
    { x0: b.core.x0, x1: b.width, z0: b.core.z0, z1: b.depth - 0.3 },
    ...wallRects(b.depth, false, 0, b.width, [{ from: doorX - DIM.door.w / 2, to: doorX + DIM.door.w / 2 }]),
    site.island,
    ...site.barriers.map((g) => around(g.post[0], g.post[2], 0.36, 0.36)),
    ...extra,
  ];
}

/** True when the segment a→b keeps `radius` clear of every rect (sampled every 5 cm). */
export function segmentClear(a: Vec3, c: Vec3, rects: Rect[], radius: number = DIM.walk.radius): Rect | null {
  const len = Math.hypot(c[0] - a[0], c[2] - a[2]);
  const n = Math.max(1, Math.ceil(len / 0.05));
  for (let k = 0; k <= n; k++) {
    const x = a[0] + ((c[0] - a[0]) * k) / n;
    const z = a[2] + ((c[2] - a[2]) * k) / n;
    for (const r of rects) {
      const dx = Math.max(r.x0 - x, 0, x - r.x1);
      const dz = Math.max(r.z0 - z, 0, z - r.z1);
      if (Math.hypot(dx, dz) < radius) return r;
    }
  }
  return null;
}
