import type { BuildingLayout } from "./building";
import { DIM } from "./dims";
import type { Rect, Vec3 } from "./types";

export type SpotKind = "director" | "desk" | "guest";
export type ParkingSpot = { index: number; center: Vec3; yaw: number; kind: SpotKind };
export type Barrier = { post: Vec3; length: number; direction: 1 | -1 };
export type Arrow = { position: Vec3; yaw: number };
export type FenceLine = { from: [number, number]; to: [number, number] };

export type Roads = {
  main: Rect;
  cross: Rect;
  intersection: Rect;
  /** Lane centre lines (UK: drive on the left). */
  lanes: { eastbound: number; westbound: number; northbound: number; southbound: number };
};

export type SiteLayout = {
  roads: Roads;
  lot: Rect;
  laneArea: Rect;
  island: Rect;
  entryLaneX: number;
  exitLaneX: number;
  aisleZ: number;
  /** Driving lines in the aisle (UK, keep left): inbound cars head east on `aisleIn`, outbound west on `aisleOut`. */
  aisleIn: number;
  aisleOut: number;
  barrierZ: number;
  barriers: Barrier[];
  arrows: Arrow[];
  spots: ParkingSpot[];
  fence: FenceLine[];
  /** Spot index of the parking place tied to a desk; floors in stacking order. */
  deskSpot: (floorIndex: number, deskIndex: number) => number;
  focus: Rect;
  bounds: Rect;
};

/** Spots: 0 director, then one per desk (floor by floor), then the guest spots at the end. */
export function siteLayout(b: BuildingLayout): SiteLayout {
  const p = DIM.parking;
  const capacities = b.floors.map((f) => f.capacity);
  const deskTotal = capacities.reduce((a, c) => a + c, 0);
  const total = 1 + deskTotal + p.guestSpots;
  const perRow = Math.ceil(total / 2);

  const roadZ0 = b.depth + DIM.road.setback;
  const lanesW = p.laneW * 2 + p.island;
  const x0 = b.width + p.gap;
  const spotsX0 = x0 + lanesW + 0.5;
  const x1 = spotsX0 + perRow * p.spotW + p.endRoom;

  const frontRow = { z0: roadZ0 - p.curb - p.spotD, z1: roadZ0 - p.curb };
  const aisle = { z0: frontRow.z0 - p.aisle, z1: frontRow.z0 };
  const backRow = { z0: aisle.z0 - p.spotD, z1: aisle.z0 };
  const lot: Rect = { x0, x1, z0: backRow.z0 - 0.5, z1: roadZ0 };

  const spots: ParkingSpot[] = Array.from({ length: total }, (_, i) => {
    const back = i < perRow;
    const col = back ? i : i - perRow;
    const zc = back ? (backRow.z0 + backRow.z1) / 2 : (frontRow.z0 + frontRow.z1) / 2;
    const kind: SpotKind = i === 0 ? "director" : i > deskTotal ? "guest" : "desk";
    return { index: i, center: [spotsX0 + p.spotW * (col + 0.5), 0, zc], yaw: back ? 0 : Math.PI, kind };
  });
  const offsets = capacities.map((_, i) => capacities.slice(0, i).reduce((a, c) => a + c, 0));

  const island: Rect = { x0: x0 + p.laneW, x1: x0 + p.laneW + p.island, z0: aisle.z1 + 0.6, z1: roadZ0 - 0.4 };
  const barrierZ = roadZ0 - 2.2;
  const w = DIM.road.width;
  const off = w / 4;
  const crossX = x1 + DIM.cross.gapFromLot + w / 2;
  const mainZc = roadZ0 + w / 2;
  const half = DIM.road.halfLength;
  const cx = (b.core.x0 + crossX) / 2;
  const main: Rect = { x0: cx - half, x1: cx + half, z0: roadZ0, z1: roadZ0 + w };
  const cross: Rect = { x0: crossX - w / 2, x1: crossX + w / 2, z0: mainZc - half, z1: mainZc + half };
  const fi = DIM.fence.inset;

  return {
    roads: {
      main,
      cross,
      intersection: { x0: cross.x0, x1: cross.x1, z0: main.z0, z1: main.z1 },
      lanes: { eastbound: mainZc - off, westbound: mainZc + off, northbound: crossX - off, southbound: crossX + off },
    },
    lot,
    laneArea: { x0, x1: x0 + lanesW, z0: aisle.z0, z1: roadZ0 },
    island,
    entryLaneX: x0 + p.laneW / 2,
    exitLaneX: island.x1 + p.laneW / 2,
    aisleZ: (aisle.z0 + aisle.z1) / 2,
    aisleIn: (aisle.z0 + aisle.z1) / 2 - p.aisleLane,
    aisleOut: (aisle.z0 + aisle.z1) / 2 + p.aisleLane,
    barrierZ,
    // Arms stop short of the outer kerb: people walk past the entry barrier along the fence.
    barriers: [
      { post: [island.x0 + 0.3, 0, barrierZ], length: p.laneW - p.armShort, direction: -1 },
      { post: [island.x1 - 0.3, 0, barrierZ], length: p.laneW - p.armShort, direction: 1 },
    ],
    arrows: [
      { position: [x0 + p.laneW / 2, 0, barrierZ - 3.5], yaw: 0 },
      { position: [island.x1 + p.laneW / 2, 0, barrierZ - 3.5], yaw: Math.PI },
    ],
    spots,
    fence: [
      { from: [x0 - fi, lot.z0 - fi], to: [x1 + fi, lot.z0 - fi] },
      { from: [x1 + fi, lot.z0 - fi], to: [x1 + fi, roadZ0 - fi] },
      { from: [x0 + lanesW, roadZ0 - fi], to: [x1 + fi, roadZ0 - fi] },
      // West side: a pedestrian gate level with the aisle.
      { from: [x0 - fi, lot.z0 - fi], to: [x0 - fi, (aisle.z0 + aisle.z1) / 2 - p.gate / 2] },
      { from: [x0 - fi, (aisle.z0 + aisle.z1) / 2 + p.gate / 2], to: [x0 - fi, roadZ0 - fi] },
    ],
    deskSpot: (floorIndex, deskIndex) => 1 + (offsets[floorIndex] ?? 0) + deskIndex,
    focus: { x0: b.core.x0, x1: cross.x1, z0: Math.min(b.core.z0, lot.z0), z1: main.z1 },
    bounds: { x0: b.core.x0 - 14, x1: cross.x1 + 14, z0: Math.min(b.core.z0, lot.z0) - 14, z1: main.z1 + 14 },
  };
}

/* ---------- car routes ---------- */

export type MapEdge = "west" | "east" | "north" | "south";
export const MAP_EDGES: MapEdge[] = ["west", "east", "north", "south"];

export type Routes = {
  /** Map edge → entry barrier. */
  arrive: Record<MapEdge, Vec3[]>;
  /** Entry barrier → parking spot (by spot index). */
  toSpot: Vec3[][];
  /** Parking spot → exit barrier. */
  fromSpot: Vec3[][];
  /** Exit barrier → map edge. */
  depart: Record<MapEdge, Vec3[]>;
};

export type RouteGraph = { nodes: Vec3[]; edges: [number, number][] };

const pt = (x: number, z: number): Vec3 => [x, 0, z];

export function routes(site: SiteLayout): Routes {
  const { main, cross, lanes } = site.roads;
  const { eastbound: eb, westbound: wb, northbound: nb, southbound: sb } = lanes;
  const ex = site.entryLaneX;
  const xx = site.exitLaneX;
  const inGate = pt(ex, site.barrierZ + 1.2);
  const outGate = pt(xx, site.barrierZ + 1.2);

  return {
    arrive: {
      west: [pt(main.x0, eb), pt(ex, eb), inGate],
      east: [pt(main.x1, wb), pt(ex, wb), inGate],
      north: [pt(sb, cross.z0), pt(sb, wb), pt(ex, wb), inGate],
      south: [pt(nb, cross.z1), pt(nb, wb), pt(ex, wb), inGate],
    },
    toSpot: site.spots.map((s) => [inGate, pt(ex, site.aisleIn), pt(s.center[0], site.aisleIn), pt(s.center[0], s.center[2])]),
    fromSpot: site.spots.map((s) => [pt(s.center[0], s.center[2]), pt(s.center[0], site.aisleOut), pt(xx, site.aisleOut), outGate]),
    depart: {
      east: [outGate, pt(xx, eb), pt(main.x1, eb)],
      west: [outGate, pt(xx, wb), pt(main.x0, wb)],
      north: [outGate, pt(xx, eb), pt(nb, eb), pt(nb, cross.z0)],
      south: [outGate, pt(xx, eb), pt(sb, eb), pt(sb, cross.z1)],
    },
  };
}

/** All route polylines merged into one graph with shared nodes (points closer than 1 cm are the same node). */
export function routeGraph(r: Routes): RouteGraph {
  const nodes: Vec3[] = [];
  const edges = new Set<string>();
  const id = (p: Vec3) => {
    const i = nodes.findIndex((n) => Math.hypot(n[0] - p[0], n[2] - p[2]) < 0.01);
    if (i >= 0) return i;
    nodes.push(p);
    return nodes.length - 1;
  };
  const lines = [...Object.values(r.arrive), ...r.toSpot, ...r.fromSpot, ...Object.values(r.depart)];
  for (const line of lines) {
    for (let i = 1; i < line.length; i++) edges.add(`${id(line[i - 1])}>${id(line[i])}`);
  }
  return { nodes, edges: [...edges].map((e) => e.split(">").map(Number) as [number, number]) };
}
