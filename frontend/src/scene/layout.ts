/**
 * All scene geometry lives here as pure functions of world data.
 * Axes: y is up. The building occupies x ∈ [0, width]; the ground floor is deeper (z ∈ [0, groundDepth])
 * because of the lobby strip at the front (+z), upper floors span z ∈ [0, upperDepth].
 * The core (elevator in front, stairs behind) sits outside the building on the −x side.
 * Floor-local positions are relative to that floor's slab top (y = 0).
 */

export type Vec3 = [number, number, number];
export type Rect = { x0: number; x1: number; z0: number; z1: number };
export type Box = { position: Vec3; size: Vec3; rotation?: Vec3 };
export type Placement = { position: Vec3; yaw: number };

export type FloorInput = { number: number; capacity: number; has_director_office: boolean };

export const DIM = {
  floorHeight: 3.2,
  /** Minimum open air between a floor's walls and the next slab; the real gap is derived in `floorPitch`. */
  minFloorGap: 1,
  slab: 0.25,
  wall: 0.15,
  margin: 1,
  deskCols: 3,
  deskPitchX: 3.4,
  deskPitchZ: 3.4,
  desk: { w: 1.6, d: 0.8, h: 0.75 },
  chair: { seat: 0.48 },
  plaque: { w: 2.6, h: 0.66, y: 2, font: 0.22 },
  sideZone: 7,
  office: { inset: 0.35, d: 5.8 },
  lobbyDepth: 4.8,
  door: { w: 3.2, leaf: 1.5 },
  canopy: { w: 5.4, d: 2.4 },
  window: { width: 1.8, gap: 0.9, sill: 0.9, head: 2.55 },
  core: { w: 3.6, elevator: 2.8, landing: 1.3, flightRun: 5.6 },
  stair: { tread: 0.28, laneW: 1.45 },
  road: { setback: 7, width: 7, halfLength: 160 },
  parking: { gap: 5, spotW: 2.7, spotD: 5.2, aisle: 6.5, laneW: 3.6, island: 1.2, curb: 0.6, guestSpots: 2 },
} as const;

export const rectCenter = (r: Rect): [number, number] => [(r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2];
export const rectSize = (r: Rect): [number, number] => [r.x1 - r.x0, r.z1 - r.z0];
export const boxIn = (r: Rect, y0: number, y1: number): Box => {
  const [cx, cz] = rectCenter(r);
  const [w, d] = rectSize(r);
  return { position: [cx, (y0 + y1) / 2, cz], size: [w, y1 - y0, d] };
};

const rowsFor = (capacity: number) => Math.max(1, Math.ceil(capacity / DIM.deskCols));

/* ---------- camera constants (needed early: the floor gap depends on the home view) ---------- */

export const CAMERA = {
  homeAzimuth: Math.PI / 4,
  homePolar: Math.PI / 3,
  minPolar: (15 * Math.PI) / 180,
  maxPolar: (75 * Math.PI) / 180,
  distance: 150,
  homeFill: 1.08,
  siteFill: 1.02,
  closeUpWidth: 5,
  smoothTime: 0.28,
  draggingSmoothTime: 0.12,
  panPadding: 6,
} as const;

/* ---------- workstations ---------- */

export type DeskTransform = {
  desk: Vec3;
  monitor: Vec3;
  chair: Vec3;
  seat: Vec3;
  plaque: Vec3;
};

/** Desk grid is filled row by row; the seated agent faces −z, towards the monitor. */
export function deskTransform(deskIndex: number): DeskTransform {
  const col = deskIndex % DIM.deskCols;
  const row = Math.floor(deskIndex / DIM.deskCols);
  const x = DIM.margin + DIM.deskPitchX * (col + 0.5);
  const z = DIM.margin + DIM.deskPitchZ * (row + 0.5);
  const { d, h } = DIM.desk;
  return {
    desk: [x, h / 2, z],
    monitor: [x, h, z - d / 2 + 0.15],
    chair: [x, 0, z + d / 2 + 0.35],
    seat: [x, DIM.chair.seat, z + d / 2 + 0.35],
    plaque: [x, DIM.plaque.y, z + d / 2 + 0.15],
  };
}

export function deskIndices(capacity: number): number[] {
  return Array.from({ length: capacity }, (_, i) => i);
}

/* ---------- floor stacking ---------- */

/**
 * Vertical distance between slabs. Chosen so that from the home camera every plaque on the back desk row
 * of a lower floor is visible under the next slab: the sight line climbs √2·tan(elevation) per unit of depth
 * (the home azimuth is 45°, so the ray crosses x and z equally).
 */
export function floorPitch(upperDepth: number): number {
  const backPlaqueZ = deskTransform(0).plaque[2];
  const elevation = Math.PI / 2 - CAMERA.homePolar;
  const climb = (upperDepth - backPlaqueZ) * Math.SQRT2 * Math.tan(elevation);
  const plaqueTop = DIM.plaque.y + DIM.plaque.h / 2;
  const needed = plaqueTop + climb + DIM.slab + 0.2;
  return Math.max(DIM.floorHeight + DIM.minFloorGap, needed);
}

export type FloorLayout = {
  number: number;
  index: number;
  baseY: number;
  depth: number;
  capacity: number;
  hasDirectorOffice: boolean;
  isGround: boolean;
};

export type BuildingLayout = {
  width: number;
  upperDepth: number;
  groundDepth: number;
  pitch: number;
  height: number;
  deskZone: Rect;
  sideZone: Rect;
  officeRoom: Rect;
  lobby: Rect;
  floors: FloorLayout[];
  core: Rect;
};

export function buildingLayout(floors: readonly FloorInput[]): BuildingLayout {
  const sorted = [...floors].sort((a, b) => a.number - b.number);
  const maxCapacity = Math.max(1, ...sorted.map((f) => f.capacity));
  const zoneW = DIM.margin * 2 + DIM.deskCols * DIM.deskPitchX;
  const zoneD = DIM.margin * 2 + rowsFor(maxCapacity) * DIM.deskPitchZ;
  const width = zoneW + DIM.sideZone;
  const upperDepth = Math.max(zoneD, DIM.office.d + DIM.office.inset * 2 + 1);
  const groundDepth = upperDepth + DIM.lobbyDepth;
  const pitch = floorPitch(upperDepth);
  const { inset } = DIM.office;

  const floorLayouts = sorted.map((f, index) => ({
    number: f.number,
    index,
    baseY: index * pitch + DIM.slab,
    depth: index === 0 ? groundDepth : upperDepth,
    capacity: f.capacity,
    hasDirectorOffice: f.has_director_office,
    isGround: index === 0,
  }));
  const { w: coreW, elevator, landing, flightRun } = DIM.core;
  const coreD = elevator + landing * 2 + flightRun + 0.3;

  return {
    width,
    upperDepth,
    groundDepth,
    pitch,
    height: Math.max(0, sorted.length - 1) * pitch + DIM.floorHeight + DIM.slab,
    deskZone: { x0: 0, x1: zoneW, z0: 0, z1: upperDepth },
    sideZone: { x0: zoneW, x1: width, z0: 0, z1: upperDepth },
    officeRoom: { x0: zoneW + inset, x1: width - inset, z0: inset, z1: inset + DIM.office.d },
    lobby: { x0: 0, x1: width, z0: upperDepth, z1: groundDepth },
    floors: floorLayouts,
    core: { x0: -coreW, x1: 0, z0: upperDepth - coreD, z1: upperDepth },
  };
}

/** Vertical extent of a storey's core segment / columns: up to the next slab, or just the walls on top. */
export function storeyHeight(b: BuildingLayout, isTop: boolean): number {
  return isTop ? DIM.floorHeight : b.pitch;
}

/** Structural columns under the next slab (upper footprint corners), floor-local. */
export function columnPositions(b: BuildingLayout): Vec3[] {
  const i = 0.15;
  return [
    [i, 0, i],
    [b.width - i, 0, i],
    [b.width - i, 0, b.upperDepth - i],
    [i, 0, b.upperDepth - i],
  ];
}

/* ---------- walls ---------- */

export type WallPieces = { solid: Box[]; glass: Box[] };
export type Opening = { from: number; to: number };

/** Wall along local +u with window bands and optional full-height openings; wall-local [u, y, 0]. */
export function wallWithWindows(length: number, height: number, openings: readonly Opening[] = []): WallPieces {
  const { width, gap, sill, head } = DIM.window;
  const t = DIM.wall;
  const solid: Box[] = [];
  const glass: Box[] = [];
  const cuts = [...openings].sort((a, b) => a.from - b.from);

  const spans: Opening[] = [];
  let cursor = 0;
  for (const c of cuts) {
    if (c.from > cursor) spans.push({ from: cursor, to: c.from });
    cursor = Math.max(cursor, c.to);
  }
  if (cursor < length) spans.push({ from: cursor, to: length });

  for (const span of spans) {
    const len = span.to - span.from;
    const mid = (span.from + span.to) / 2;
    solid.push({ position: [mid, sill / 2, 0], size: [len, sill, t] });
    solid.push({ position: [mid, (head + height) / 2, 0], size: [len, height - head, t] });
    const count = Math.max(0, Math.floor((len - gap) / (width + gap)));
    const pad = (len - (count * width + (count + 1) * gap)) / 2;
    let at = span.from;
    const pier = (a: number, b: number) => {
      if (b - a > 0.01) solid.push({ position: [(a + b) / 2, (sill + head) / 2, 0], size: [b - a, head - sill, t] });
    };
    for (let i = 0; i < count; i++) {
      const start = span.from + pad + gap + i * (width + gap);
      pier(at, start);
      glass.push({ position: [start + width / 2, (sill + head) / 2, 0], size: [width, head - sill, t * 0.4] });
      at = start + width;
    }
    pier(at, span.to);
  }
  return { solid, glass };
}

export type WallSpec = {
  key: string;
  length: number;
  /** Group transform: walls run along local +x from `origin`, rotated by `yaw`. */
  origin: Vec3;
  yaw: number;
  /** Outward horizontal normal [x, z], used to fade walls that face the camera. */
  normal: [number, number];
  openings: Opening[];
};

export function elevatorOpening(b: BuildingLayout): Opening {
  const shaft = coreLayout(b).shaft;
  return { from: shaft.z0 + 0.3, to: shaft.z1 - 0.3 };
}

export function entranceDoorX(b: BuildingLayout): number {
  return b.width * 0.3;
}

/** The four facade walls of a floor. Wall-local +u maps to world +x (yaw 0) or +z (yaw −π/2). */
export function floorWalls(b: BuildingLayout, f: FloorLayout): WallSpec[] {
  const t = DIM.wall / 2;
  const depth = f.depth;
  const elev = elevatorOpening(b);
  const leftOpenings = elev.from >= 0 && elev.to <= depth ? [elev] : [];
  const doorX = entranceDoorX(b);
  const frontOpenings = f.isGround ? [{ from: doorX - DIM.door.w / 2, to: doorX + DIM.door.w / 2 }] : [];
  return [
    { key: "back", length: b.width, origin: [0, 0, t], yaw: 0, normal: [0, -1], openings: [] },
    { key: "front", length: b.width, origin: [0, 0, depth - t], yaw: 0, normal: [0, 1], openings: frontOpenings },
    { key: "left", length: depth, origin: [t, 0, 0], yaw: -Math.PI / 2, normal: [-1, 0], openings: leftOpenings },
    { key: "right", length: depth, origin: [b.width - t, 0, 0], yaw: -Math.PI / 2, normal: [1, 0], openings: [] },
  ];
}

/* ---------- director office, lounge, lobby ---------- */

export type OfficeFurniture = {
  desk: Placement;
  chair: Placement;
  monitor: Placement;
  meetingTable: Placement;
  meetingChairs: Placement[];
  shelf: Placement;
  plants: Vec3[];
  sign: Vec3;
  doorGap: Opening;
};

export function officeFurniture(room: Rect): OfficeFurniture {
  const [cx] = rectCenter(room);
  const [w] = rectSize(room);
  const deskX = cx + w * 0.18;
  const deskZ = room.z0 + 1.9;
  const tableX = room.x0 + 1.6;
  const tableZ = room.z1 - 1.7;
  return {
    desk: { position: [deskX, 0, deskZ], yaw: 0 },
    monitor: { position: [deskX, 0.8, deskZ - 0.3], yaw: 0 },
    chair: { position: [deskX, 0, deskZ - 1], yaw: 0 },
    meetingTable: { position: [tableX, 0, tableZ], yaw: 0 },
    meetingChairs: [
      { position: [tableX - 0.95, 0, tableZ], yaw: Math.PI / 2 },
      { position: [tableX + 0.95, 0, tableZ], yaw: -Math.PI / 2 },
      { position: [tableX, 0, tableZ - 0.95], yaw: 0 },
      { position: [tableX, 0, tableZ + 0.95], yaw: Math.PI },
    ],
    shelf: { position: [room.x0 + 0.35, 0, room.z0 + 1.6], yaw: Math.PI / 2 },
    plants: [
      [room.x1 - 0.5, 0, room.z0 + 0.5],
      [room.x0 + 0.5, 0, room.z0 + 0.5],
      [room.x1 - 0.5, 0, room.z1 - 0.5],
    ],
    sign: [deskX, 2.3, room.z1 + 0.03],
    doorGap: { from: deskX - 0.65, to: deskX + 0.65 },
  };
}

export type LoungeLayout = { sofa: Placement; table: Vec3; plants: Vec3[] };

export function loungeLayout(zone: Rect): LoungeLayout {
  const [cx, cz] = rectCenter(zone);
  return {
    sofa: { position: [cx, 0, cz - 0.6], yaw: 0 },
    table: [cx, 0, cz + 0.7],
    plants: [
      [cx + 2, 0, cz - 0.8],
      [zone.x1 - 0.6, 0, zone.z0 + 0.6],
    ],
  };
}

export type LobbyLayout = {
  reception: Placement;
  receptionChair: Placement;
  sofas: Placement[];
  armchairs: Placement[];
  coffeeTable: Vec3;
  rug: Rect;
  plants: Vec3[];
  sign: Vec3;
};

export function lobbyLayout(b: BuildingLayout): LobbyLayout {
  const l = b.lobby;
  const doorX = entranceDoorX(b);
  const waitX = b.width * 0.66;
  const waitZ = (l.z0 + l.z1) / 2;
  return {
    reception: { position: [doorX, 0, l.z0 + 1.2], yaw: 0 },
    receptionChair: { position: [doorX, 0, l.z0 + 0.4], yaw: 0 },
    sofas: [
      { position: [waitX, 0, waitZ - 1.2], yaw: 0 },
      { position: [waitX + 2.4, 0, waitZ + 0.1], yaw: -Math.PI / 2 },
    ],
    armchairs: [
      { position: [waitX - 1.3, 0, waitZ + 0.9], yaw: Math.PI * 0.75 },
      { position: [waitX + 0.3, 0, waitZ + 1.5], yaw: Math.PI },
    ],
    coffeeTable: [waitX + 0.2, 0, waitZ + 0.1],
    rug: { x0: waitX - 2.1, x1: waitX + 3.1, z0: waitZ - 1.9, z1: waitZ + 2.1 },
    plants: [
      [l.x0 + 0.7, 0, l.z1 - 0.7],
      [doorX - DIM.door.w / 2 - 0.8, 0, l.z1 - 0.7],
      [doorX + DIM.door.w / 2 + 0.8, 0, l.z1 - 0.7],
      [l.x1 - 0.7, 0, l.z1 - 0.7],
      [l.x1 - 0.7, 0, l.z0 + 0.7],
    ],
    sign: [doorX, 1.85, l.z0 + 0.62],
  };
}

/* ---------- core: elevator + stairs ---------- */

export type CoreWall = { key: string; box: Rect; normal: [number, number] };
export type CoreLayout = { shaft: Rect; stairwell: Rect; sign: Vec3; walls: CoreWall[] };

export function coreLayout(b: BuildingLayout): CoreLayout {
  const { core } = b;
  const shaft: Rect = { x0: core.x0 + 0.35, x1: core.x1 - 0.35, z0: core.z1 - DIM.core.elevator, z1: core.z1 - 0.15 };
  const stairwell: Rect = { x0: core.x0 + 0.15, x1: core.x1, z0: core.z0 + 0.15, z1: shaft.z0 - 0.15 };
  const t = DIM.wall;
  const walls: CoreWall[] = [
    { key: "outer", box: { x0: core.x0, x1: core.x0 + t, z0: core.z0, z1: core.z1 }, normal: [-1, 0] },
    { key: "rear", box: { x0: core.x0, x1: core.x1, z0: core.z0, z1: core.z0 + t }, normal: [0, -1] },
  ];
  if (core.z0 < 0) walls.push({ key: "inner", box: { x0: core.x1 - t, x1: core.x1, z0: core.z0, z1: 0 }, normal: [1, 0] });
  return { shaft, stairwell, sign: [core.x0 - 0.3, 2.5, core.z1 + 0.6], walls };
}

export type StairStorey = { steps: Box[]; landings: Box[]; rails: Box[]; posts: Box[] };

/**
 * Switchback stairs for one storey (floor-local): flight A climbs towards −z in the outer lane,
 * a mid landing at the back turns around, flight B climbs towards +z in the inner lane to the next floor.
 */
export function stairStorey(well: Rect, pitch: number): StairStorey {
  const { tread, laneW } = DIM.stair;
  const { landing } = DIM.core;
  const half = pitch / 2;
  const frontLanding: Rect = { x0: well.x0, x1: well.x1, z0: well.z1 - landing, z1: well.z1 };
  const midLanding: Rect = { x0: well.x0, x1: well.x1, z0: well.z0, z1: well.z0 + landing };
  const runStart = frontLanding.z0;
  const run = runStart - midLanding.z1;
  const steps = Math.max(8, Math.floor(run / tread));
  const stepRun = run / steps;
  const rise = half / steps;
  const laneA: [number, number] = [well.x0, well.x0 + laneW];
  const laneB: [number, number] = [well.x1 - laneW, well.x1];

  const flight = (lane: [number, number], base: number, towardsBack: boolean): Box[] =>
    Array.from({ length: steps }, (_, i) => {
      const z = towardsBack ? runStart - stepRun * (i + 0.5) : midLanding.z1 + stepRun * (i + 0.5);
      const top = base + rise * (i + 1);
      return { position: [(lane[0] + lane[1]) / 2, top - 0.09, z] as Vec3, size: [lane[1] - lane[0], 0.18, stepRun] as Vec3 };
    });

  const angle = Math.atan2(half, run);
  const railLen = Math.hypot(half, run);
  const innerA = laneA[1] - 0.05;
  const innerB = laneB[0] + 0.05;
  const railY = 0.9;
  const midZ = (runStart + midLanding.z1) / 2;
  return {
    steps: [...flight(laneA, 0, true), ...flight(laneB, half, false)],
    landings: [boxIn(midLanding, half - 0.2, half), boxIn(frontLanding, -DIM.slab, 0)],
    rails: [
      { position: [innerA, half / 2 + railY, midZ], size: [0.05, 0.05, railLen], rotation: [angle, 0, 0] },
      { position: [innerB, half + half / 2 + railY, midZ], size: [0.05, 0.05, railLen], rotation: [-angle, 0, 0] },
    ],
    posts: [0.15, 0.5, 0.85].flatMap((k) => {
      const z = runStart - run * k;
      return [
        { position: [innerA, half * k + railY / 2, z] as Vec3, size: [0.04, railY, 0.04] as Vec3 },
        { position: [innerB, half + half * (1 - k) + railY / 2, z] as Vec3, size: [0.04, railY, 0.04] as Vec3 },
      ];
    }),
  };
}

/* ---------- entrance ---------- */

export type EntranceLayout = { door: Vec3; reader: Vec3; canopy: Box; walkway: Rect };

export function entranceLayout(b: BuildingLayout, roadZ0: number): EntranceLayout {
  const x = entranceDoorX(b);
  const z = b.groundDepth;
  return {
    door: [x, DIM.slab, z],
    reader: [x + DIM.door.w / 2 + 0.7, 0, z + 0.7],
    canopy: { position: [x, DIM.slab + DIM.floorHeight - 0.15, z + DIM.canopy.d / 2], size: [DIM.canopy.w, 0.16, DIM.canopy.d] },
    walkway: { x0: x - 1.6, x1: x + 1.6, z0: z, z1: roadZ0 },
  };
}

/* ---------- site: road + parking ---------- */

export type SpotKind = "director" | "desk" | "guest";
export type ParkingSpot = { index: number; center: Vec3; yaw: number; kind: SpotKind };
export type Barrier = { post: Vec3; length: number; direction: 1 | -1 };
export type Arrow = { position: Vec3; yaw: number };

export type SiteLayout = {
  road: Rect;
  lot: Rect;
  lanes: Rect;
  island: Rect;
  barriers: Barrier[];
  arrows: Arrow[];
  spots: ParkingSpot[];
  /** Spot index of the parking place tied to a desk; floors in stacking order. */
  deskSpot: (floorIndex: number, deskIndex: number) => number;
  focus: Rect;
};

/** Spots: 0 director, then one per desk (floor by floor), then the guest spots at the end. */
export function siteLayout(b: BuildingLayout): SiteLayout {
  const p = DIM.parking;
  const capacities = b.floors.map((f) => f.capacity);
  const deskTotal = capacities.reduce((a, c) => a + c, 0);
  const total = 1 + deskTotal + p.guestSpots;
  const perRow = Math.ceil(total / 2);

  const roadZ0 = b.groundDepth + DIM.road.setback;
  const lanesW = p.laneW * 2 + p.island;
  const x0 = b.width + p.gap;
  const spotsX0 = x0 + lanesW + 0.5;
  const x1 = spotsX0 + perRow * p.spotW + 0.6;

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
  const lanes: Rect = { x0, x1: x0 + lanesW, z0: aisle.z0, z1: roadZ0 };
  const island: Rect = { x0: x0 + p.laneW, x1: x0 + p.laneW + p.island, z0: aisle.z1 + 0.6, z1: roadZ0 - 0.4 };
  const barrierZ = roadZ0 - 2.2;
  const cx = (b.core.x0 + x1) / 2;

  return {
    road: { x0: cx - DIM.road.halfLength, x1: cx + DIM.road.halfLength, z0: roadZ0, z1: roadZ0 + DIM.road.width },
    lot,
    lanes,
    island,
    barriers: [
      { post: [island.x0 + 0.3, 0, barrierZ], length: p.laneW, direction: -1 },
      { post: [island.x1 - 0.3, 0, barrierZ], length: p.laneW, direction: 1 },
    ],
    arrows: [
      { position: [x0 + p.laneW / 2, 0.035, barrierZ - 3.5], yaw: 0 },
      { position: [island.x1 + p.laneW / 2, 0.035, barrierZ - 3.5], yaw: Math.PI },
    ],
    spots,
    deskSpot: (floorIndex, deskIndex) => 1 + (offsets[floorIndex] ?? 0) + deskIndex,
    focus: { x0: b.core.x0, x1, z0: Math.min(b.core.z0, lot.z0), z1: roadZ0 + DIM.road.width },
  };
}

/* ---------- greenery ---------- */

export type GreeneryKind = "conifer" | "deciduous" | "bush" | "flowerbed";
export type GreeneryItem = { kind: GreeneryKind; position: Vec3; scale: number; variant: number };

const inAny = (x: number, ranges: [number, number][]) => ranges.some(([a, c]) => x > a && x < c);

/** Trees along the road (clear of the site frontage), shrubs around the building, beds by the entrance, lot edges. */
export function greenery(b: BuildingLayout, site: SiteLayout, entrance: EntranceLayout): GreeneryItem[] {
  const items: GreeneryItem[] = [];
  let n = 0;
  const add = (kind: GreeneryKind, x: number, z: number, scale = 1) => {
    items.push({ kind, position: [x, 0, z], scale: scale * (0.85 + ((n * 37) % 10) / 33), variant: n % 3 });
    n++;
  };

  const nearSide = site.road.z0 - 2.4;
  const farSide = site.road.z1 + 2.8;
  const frontage: [number, number][] = [[b.core.x0 - 3, site.lot.x1 + 3]];
  const walkway: [number, number][] = [[entrance.walkway.x0 - 2.5, entrance.walkway.x1 + 2.5]];
  let i = 0;
  for (let x = site.road.x0 + 6; x < site.road.x1 - 6; x += 8.5, i++) {
    if (!inAny(x, frontage)) add(i % 3 === 1 ? "conifer" : "deciduous", x, nearSide);
    if (!inAny(x + 4, walkway)) add(i % 2 === 0 ? "conifer" : "deciduous", x + 4, farSide);
  }

  for (let x = 1.2; x < b.width - 0.5; x += 2.6) add("bush", x, -1.4, 0.9);
  for (let z = 1.2; z < b.upperDepth - 0.5; z += 2.6) add("bush", b.width + 1.6, z, 0.9);
  add("flowerbed", entrance.walkway.x0 - 2, b.groundDepth + 2.4);
  add("flowerbed", entrance.walkway.x1 + 2, b.groundDepth + 2.4);
  add("flowerbed", b.width - 2.6, b.groundDepth + 2.4);

  for (let x = site.lot.x0 + 1.5; x < site.lot.x1; x += 2.4) add("bush", x, site.lot.z0 - 1.3, 0.8);
  for (let z = site.lot.z0 + 1; z < site.lot.z1 - 1.5; z += 5) add("deciduous", site.lot.x1 + 2.4, z, 0.9);
  add("deciduous", site.lot.x0 - 2.4, site.lot.z0 - 1.6, 0.9);
  return items;
}

/* ---------- camera ---------- */

export type CameraHome = {
  target: Vec3;
  position: Vec3;
  zoom: number;
  minZoom: number;
  maxZoom: number;
  boundary: { min: Vec3; max: Vec3 };
};

function viewBasis(azimuth: number, polar: number) {
  const o: Vec3 = [Math.sin(polar) * Math.sin(azimuth), Math.cos(polar), Math.sin(polar) * Math.cos(azimuth)];
  const right: Vec3 = [Math.cos(azimuth), 0, -Math.sin(azimuth)];
  const up: Vec3 = [
    o[1] * right[2] - o[2] * right[1],
    o[2] * right[0] - o[0] * right[2],
    o[0] * right[1] - o[1] * right[0],
  ];
  return { offset: o, right, up };
}

/** Screen-space extent (world units) of an axis-aligned box seen from the given angles. */
export function projectedSpan(r: Rect, y0: number, y1: number, azimuth: number, polar: number): [number, number] {
  const { right, up } = viewBasis(azimuth, polar);
  const xs: number[] = [];
  const ys: number[] = [];
  for (const x of [r.x0, r.x1])
    for (const y of [y0, y1])
      for (const z of [r.z0, r.z1]) {
        xs.push(x * right[0] + y * right[1] + z * right[2]);
        ys.push(x * up[0] + y * up[1] + z * up[2]);
      }
  return [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
}

export function cameraHome(
  b: BuildingLayout,
  site: SiteLayout,
  viewport: { width: number; height: number },
): CameraHome {
  const { homeAzimuth: az, homePolar: polar, distance } = CAMERA;
  const buildingRect: Rect = { x0: b.core.x0, x1: b.width, z0: b.core.z0, z1: b.groundDepth + DIM.canopy.d };
  const [cx, cz] = rectCenter(buildingRect);
  const target: Vec3 = [cx, b.height * 0.42, cz];
  const { offset } = viewBasis(az, polar);
  const fit = (r: Rect, height: number, fill: number) => {
    const [w, h] = projectedSpan(r, 0, height, az, polar);
    return Math.min(viewport.width / w, viewport.height / h) / fill;
  };
  const zoom = fit(buildingRect, b.height, CAMERA.homeFill);
  const siteZoom = fit(site.focus, b.height, CAMERA.siteFill) * 0.55;
  const closeUp = Math.min(viewport.width, viewport.height) / CAMERA.closeUpWidth;
  const pad = CAMERA.panPadding;
  return {
    target,
    position: [target[0] + offset[0] * distance, target[1] + offset[1] * distance, target[2] + offset[2] * distance],
    zoom,
    minZoom: Math.min(siteZoom, zoom),
    maxZoom: Math.max(closeUp, zoom),
    // Pan keeps the orbit target over the building (± padding), so the building can't be dragged off-screen.
    boundary: {
      min: [buildingRect.x0 - pad, 0, buildingRect.z0 - pad],
      max: [buildingRect.x1 + pad, b.height, buildingRect.z1 + pad],
    },
  };
}

/* ---------- dynamic wall fading ---------- */

export const FADE = { hidden: 0.07, from: 0.12, to: 0.5, lambda: 8 } as const;

/** Opacity of a vertical surface with outward normal n, given the horizontal direction towards the camera. */
export function facadeOpacity(normal: [number, number], toCamera: [number, number]): number {
  const dot = normal[0] * toCamera[0] + normal[1] * toCamera[1];
  const t = Math.min(1, Math.max(0, (dot - FADE.from) / (FADE.to - FADE.from)));
  const s = t * t * (3 - 2 * t);
  return 1 - s * (1 - FADE.hidden);
}

/* ---------- appearance helpers ---------- */

export function hashString(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i++) h = (h * 31 + value.charCodeAt(i)) | 0;
  return Math.abs(h);
}
