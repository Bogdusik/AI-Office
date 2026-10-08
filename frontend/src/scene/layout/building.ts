import { CAMERA, DIM } from "./dims";
import { type Box, type FloorInput, type FloorKind, type Placement, type Rect, type Vec3, boxIn, rectCenter } from "./types";

/* ---------- workstations ---------- */

export type DeskTransform = { desk: Vec3; seat: Vec3; plaque: Vec3 };

/** Desk grid is filled row by row; the seated agent faces −z, towards the monitors. */
export function deskTransform(deskIndex: number): DeskTransform {
  const col = deskIndex % DIM.deskCols;
  const row = Math.floor(deskIndex / DIM.deskCols);
  const x = DIM.margin + DIM.deskPitchX * (col + 0.5);
  const z = DIM.margin + DIM.deskPitchZ * (row + 0.5);
  return {
    desk: [x, 0, z],
    seat: [x, DIM.chair.seat + 0.05, z + DIM.chair.offset - 0.05],
    plaque: [x, DIM.plaque.y, z + DIM.desk.d / 2 + 0.15],
  };
}

export const deskIndices = (capacity: number) => Array.from({ length: capacity }, (_, i) => i);
const rowsFor = (capacity: number) => Math.max(1, Math.ceil(capacity / DIM.deskCols));

/* ---------- floor stacking ---------- */

/**
 * Vertical distance between slabs: just enough air that every back-row plaque of a lower floor stays
 * visible from the home camera (at azimuth 45° the sight line climbs √2·tan(elevation) per unit of depth).
 */
export function floorPitch(depth: number): number {
  const backPlaqueZ = deskTransform(0).plaque[2];
  const elevation = Math.PI / 2 - CAMERA.homePolar;
  const climb = (depth - backPlaqueZ) * Math.SQRT2 * Math.tan(elevation);
  const plaqueTop = DIM.plaque.y + DIM.plaque.h / 2;
  return Math.max(DIM.floorHeight + DIM.minFloorGap, plaqueTop + climb + DIM.slab + 0.2);
}

export type FloorLayout = {
  number: number;
  index: number;
  kind: FloorKind;
  baseY: number;
  capacity: number;
  hasDirectorOffice: boolean;
  hasServerRoom: boolean;
  hasKitchen: boolean;
  isGround: boolean;
};

export type BuildingLayout = {
  width: number;
  depth: number;
  pitch: number;
  height: number;
  deskZone: Rect;
  sideZone: Rect;
  kitchenZone: Rect;
  officeRoom: Rect;
  floors: FloorLayout[];
  core: Rect;
};

export function buildingLayout(floors: readonly FloorInput[]): BuildingLayout {
  const sorted = [...floors].sort((a, b) => a.number - b.number);
  const maxCapacity = Math.max(1, ...sorted.map((f) => f.capacity));
  const zoneW = DIM.margin * 2 + DIM.deskCols * DIM.deskPitchX;
  const width = zoneW + DIM.sideZone + DIM.kitchenZone;
  const depth = Math.max(DIM.margin * 2 + rowsFor(maxCapacity) * DIM.deskPitchZ, DIM.office.d + DIM.office.inset * 2 + 1);
  const pitch = floorPitch(depth);
  const { inset } = DIM.office;
  const { w: coreW, elevator, landing, flightRun } = DIM.core;
  const coreD = elevator + landing * 2 + flightRun + 0.3;
  const sideX1 = zoneW + DIM.sideZone;

  return {
    width,
    depth,
    pitch,
    height: Math.max(0, sorted.length - 1) * pitch + DIM.floorHeight + DIM.slab,
    deskZone: { x0: 0, x1: zoneW, z0: 0, z1: depth },
    sideZone: { x0: zoneW, x1: sideX1, z0: 0, z1: depth },
    kitchenZone: { x0: sideX1, x1: width, z0: 0, z1: depth },
    officeRoom: { x0: zoneW + inset, x1: sideX1 - inset, z0: inset, z1: inset + DIM.office.d },
    floors: sorted.map((f, index) => ({
      number: f.number,
      index,
      kind: f.kind,
      baseY: index * pitch + DIM.slab,
      capacity: f.kind === "office" ? f.capacity : 0,
      hasDirectorOffice: f.kind === "office" && f.has_director_office,
      hasServerRoom: f.kind === "office" && !!f.has_server_room,
      hasKitchen: f.kind === "office" && !!f.has_kitchen && !f.has_server_room,
      isGround: index === 0,
    })),
    core: { x0: -coreW, x1: 0, z0: depth - coreD, z1: depth },
  };
}

export const storeyHeight = (b: BuildingLayout, isTop: boolean) => (isTop ? DIM.floorHeight : b.pitch);

export function columnPositions(b: BuildingLayout): Vec3[] {
  const i = 0.15;
  return [
    [i, 0, i],
    [b.width - i, 0, i],
    [b.width - i, 0, b.depth - i],
    [i, 0, b.depth - i],
  ];
}

/* ---------- walls ---------- */

export type Opening = { from: number; to: number };
export type WallPieces = { solid: Box[]; glass: Box[] };

/** Wall along local +u with window bands and full-height openings; wall-local [u, y, 0]. */
export function wallWithWindows(length: number, height: number, openings: readonly Opening[] = []): WallPieces {
  const { width, gap, sill, head } = DIM.window;
  const t = DIM.wall;
  const solid: Box[] = [];
  const glass: Box[] = [];
  const spans: Opening[] = [];
  let cursor = 0;
  for (const c of [...openings].sort((a, b) => a.from - b.from)) {
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

/** A wall in world space: pieces already transformed, plus the outward normal used for fading. */
export type WallMesh = { key: string; normal: [number, number]; solid: Box[]; glass: Box[] };

function orient(boxes: Box[], origin: Vec3, alongZ: boolean): Box[] {
  return boxes.map(({ position: [u, y, w], size: [su, sy, sw] }) =>
    alongZ
      ? { position: [origin[0] + w, origin[1] + y, origin[2] + u] as Vec3, size: [sw, sy, su] as Vec3 }
      : { position: [origin[0] + u, origin[1] + y, origin[2] + w] as Vec3, size: [su, sy, sw] as Vec3 },
  );
}

export function elevatorOpening(b: BuildingLayout): Opening {
  const shaft = coreLayout(b).shaft;
  return { from: shaft.z0 + 0.3, to: shaft.z1 - 0.3 };
}

/** Doorway from a floor to its stair landing (front landing of the stairwell). */
export function stairOpening(b: BuildingLayout): Opening {
  const well = coreLayout(b).stairwell;
  const mid = well.z1 - DIM.core.landing / 2;
  return { from: mid - DIM.walk.stairDoor / 2, to: mid + DIM.walk.stairDoor / 2 };
}

export const entranceDoorX = (b: BuildingLayout) => b.width / 2;

export function floorWalls(b: BuildingLayout, f: FloorLayout): WallMesh[] {
  const h = DIM.floorHeight - DIM.slab;
  const t = DIM.wall / 2;
  const y = f.baseY;
  const doorX = entranceDoorX(b);
  const front = f.isGround ? [{ from: doorX - DIM.door.w / 2, to: doorX + DIM.door.w / 2 }] : [];
  const specs: { key: string; normal: [number, number]; length: number; origin: Vec3; alongZ: boolean; openings: Opening[] }[] = [
    { key: "back", normal: [0, -1], length: b.width, origin: [0, y, t], alongZ: false, openings: [] },
    { key: "front", normal: [0, 1], length: b.width, origin: [0, y, b.depth - t], alongZ: false, openings: front },
    { key: "left", normal: [-1, 0], length: b.depth, origin: [t, y, 0], alongZ: true, openings: [elevatorOpening(b), stairOpening(b)] },
    { key: "right", normal: [1, 0], length: b.depth, origin: [b.width - t, y, 0], alongZ: true, openings: [] },
  ];
  return specs.map((s) => {
    const pieces = wallWithWindows(s.length, h, s.openings);
    return { key: `${f.number}-${s.key}`, normal: s.normal, solid: orient(pieces.solid, s.origin, s.alongZ), glass: orient(pieces.glass, s.origin, s.alongZ) };
  });
}

/* ---------- zones: director office, lounge, kitchen, reception ---------- */

export type OfficeFurniture = {
  desk: Placement;
  meetingTable: Placement;
  meetingChairs: Placement[];
  shelf: Placement;
  plants: Vec3[];
  sign: Vec3;
  doorGap: Opening;
};

export function officeFurniture(room: Rect): OfficeFurniture {
  const [cx] = rectCenter(room);
  const w = room.x1 - room.x0;
  const deskX = cx + w * 0.18;
  const deskZ = room.z0 + 1.9;
  const tableX = room.x0 + 1.6;
  const tableZ = room.z1 - 1.7;
  return {
    desk: { position: [deskX, 0, deskZ], yaw: Math.PI },
    meetingTable: { position: [tableX, 0, tableZ], yaw: 0 },
    meetingChairs: [
      { position: [tableX - 0.95, 0, tableZ], yaw: -Math.PI / 2 },
      { position: [tableX + 0.95, 0, tableZ], yaw: Math.PI / 2 },
      { position: [tableX, 0, tableZ - 0.85], yaw: Math.PI },
      { position: [tableX, 0, tableZ + 0.85], yaw: 0 },
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

/** `seats`: where people sit on the sofa (seat surface height comes from DIM.life), facing +z. */
export type LoungeLayout = { sofa: Placement; table: Vec3; plants: Vec3[]; seats: Placement[] };

export function loungeLayout(zone: Rect): LoungeLayout {
  const [cx, cz] = rectCenter(zone);
  return {
    sofa: { position: [cx, 0, cz - 0.6], yaw: 0 },
    table: [cx, 0, cz + 0.95],
    seats: [-0.75, 0, 0.75].map((dx) => ({ position: [cx + dx, 0, cz - 0.6 + 0.1] as Vec3, yaw: Math.PI })),
    plants: [
      [cx + 2.2, 0, cz - 0.8],
      [zone.x0 + 0.6, 0, zone.z0 + 0.6],
    ],
  };
}

/** `coffee`: machine on the counter; `queue`: where people wait for it, place 0 in front of the machine. */
export type KitchenLayout = { counter: Placement; counterLength: number; fridge: Placement; table: Placement; chairs: Placement[]; plant: Vec3; coffee: Placement; queue: Vec3[] };

export function kitchenLayout(zone: Rect): KitchenLayout {
  const [cx, cz] = rectCenter(zone);
  const counterLength = zone.x1 - zone.x0 - 1.6;
  const tableZ = cz + 1.2;
  return {
    counter: { position: [zone.x0 + 0.4 + counterLength / 2, 0, zone.z0 + 0.5], yaw: 0 },
    counterLength,
    fridge: { position: [zone.x1 - 0.6, 0, zone.z0 + 0.55], yaw: 0 },
    table: { position: [cx, 0, tableZ], yaw: 0 },
    chairs: [
      { position: [cx - 0.5, 0, tableZ - 0.75], yaw: Math.PI },
      { position: [cx + 0.5, 0, tableZ - 0.75], yaw: Math.PI },
      { position: [cx - 0.5, 0, tableZ + 0.75], yaw: 0 },
      { position: [cx + 0.5, 0, tableZ + 0.75], yaw: 0 },
    ],
    plant: [zone.x1 - 0.6, 0, zone.z1 - 0.6],
    coffee: { position: [zone.x0 + 0.75, 0.94, zone.z0 + 0.42], yaw: 0 },
    queue: [
      [zone.x0 + 0.75, 0, zone.z0 + 1.45],
      ...[2.35, 3.25, 4.15].map((dz) => [zone.x0 + 0.6, 0, zone.z0 + dz] as Vec3),
    ],
  };
}

export type ServerRoomLayout = { room: Rect; racks: Placement[]; doorGap: Opening; sign: Vec3; cooler: Placement };

/** Server room in the kitchen zone: a glass room, racks in a row by the back wall, door in the front. */
export function serverRoomLayout(zone: Rect): ServerRoomLayout {
  const { inset, depth, racks, rack, gap, door } = DIM.server;
  const room: Rect = { x0: zone.x0 + inset, x1: zone.x1 - inset, z0: inset, z1: inset + depth };
  const [cx] = rectCenter(room);
  const row = racks * rack.w + (racks - 1) * gap;
  const z = room.z0 + 0.25 + rack.d / 2;
  return {
    room,
    racks: Array.from({ length: racks }, (_, i) => ({ position: [cx - row / 2 + rack.w / 2 + i * (rack.w + gap), 0, z], yaw: 0 })),
    doorGap: { from: cx - door / 2, to: cx + door / 2 },
    sign: [cx, 2.3, room.z1 + 0.03],
    cooler: { position: [room.x1 - 0.45, 0, room.z1 - 0.6], yaw: 0 },
  };
}

export type PartitionLayout = { x: number; segments: { z0: number; z1: number }[] };

/** Glass partition along the desk zone's edge, open in the middle so people can walk through. */
export function partitionLayout(b: BuildingLayout): PartitionLayout {
  const x = b.deskZone.x1;
  const mid = b.depth / 2;
  const half = DIM.partition.door / 2;
  return { x, segments: [{ z0: 0.2, z1: mid - half }, { z0: mid + half, z1: b.depth - 0.2 }] };
}

export type GuestGroup = { sofa: Placement; armchairs: Placement[]; table: Vec3; rug: Rect; plant: Vec3 };
export type ReceptionLayout = { desk: Placement; staff: Placement[]; groups: GuestGroup[]; plants: Vec3[]; sign: Vec3 };

function guestGroup(cx: number, cz: number, facing: 1 | -1): GuestGroup {
  return {
    sofa: { position: [cx, 0, cz - facing * 1.1], yaw: facing === 1 ? 0 : Math.PI },
    armchairs: [
      { position: [cx - 1.6, 0, cz + facing * 0.2], yaw: Math.PI / 2 },
      { position: [cx + 1.6, 0, cz + facing * 0.2], yaw: -Math.PI / 2 },
    ],
    table: [cx, 0, cz + facing * 0.1],
    rug: { x0: cx - 2.4, x1: cx + 2.4, z0: cz - 1.8, z1: cz + 1.4 },
    plant: [cx + 2.4, 0, cz - facing * 1.3],
  };
}

/** Whole ground floor as a lobby: two-seat counter facing the doors, three guest seating groups. */
export function receptionLayout(b: BuildingLayout): ReceptionLayout {
  const cx = entranceDoorX(b);
  const deskZ = 2.6;
  return {
    desk: { position: [cx, 0, deskZ], yaw: 0 },
    staff: [-0.95, 0.95].map((dx) => ({ position: [cx + dx, DIM.chair.seat + 0.05, deskZ - 0.75] as Vec3, yaw: Math.PI })),
    groups: [guestGroup(5.6, b.depth - 3, 1), guestGroup(b.width - 5.6, b.depth - 3, 1), guestGroup(b.width - 5.6, 2.6, -1)],
    plants: [
      [0.8, 0, 0.8],
      [cx - 3.2, 0, 0.8],
      [cx + 3.2, 0, 0.8],
      [cx - DIM.door.w / 2 - 0.9, 0, b.depth - 0.8],
      [cx + DIM.door.w / 2 + 0.9, 0, b.depth - 0.8],
    ],
    sign: [cx, 2.4, 0.3],
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

/** Switchback stairs for one storey (floor-local): flight A goes towards −z, a mid landing turns, flight B returns. */
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
      return { position: [(lane[0] + lane[1]) / 2, base + rise * (i + 1) - 0.09, z] as Vec3, size: [lane[1] - lane[0], 0.18, stepRun] as Vec3 };
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

/* ---------- entrance & roof ---------- */

export type EntranceLayout = { door: Vec3; reader: Vec3; canopy: Box; walkway: Rect };

export function entranceLayout(b: BuildingLayout, roadZ0: number): EntranceLayout {
  const x = entranceDoorX(b);
  const z = b.depth;
  return {
    door: [x, DIM.slab, z],
    reader: [x + DIM.door.w / 2 + 0.8, 0, z + 0.8],
    canopy: { position: [x, DIM.slab + DIM.floorHeight - 0.12, z + DIM.canopy.d / 2], size: [DIM.canopy.w, 0.16, DIM.canopy.d] },
    walkway: { x0: x - 2.4, x1: x + 2.4, z0: z, z1: roadZ0 },
  };
}

export type RoofLayout = { slab: Box; parapets: Box[]; hvac: Placement[]; ac: Placement[]; coreCap: Box };

export function roofLayout(b: BuildingLayout, topBaseY: number): RoofLayout {
  const y = topBaseY + DIM.floorHeight - DIM.slab;
  const { parapet, thickness } = DIM.roof;
  const t = 0.25;
  const w = b.width;
  const d = b.depth;
  const py = y + thickness + parapet / 2;
  return {
    slab: { position: [w / 2, y + thickness / 2, d / 2], size: [w + 0.3, thickness, d + 0.3] },
    parapets: [
      { position: [w / 2, py, -0.02], size: [w + 0.3, parapet, t] },
      { position: [w / 2, py, d + 0.02], size: [w + 0.3, parapet, t] },
      { position: [-0.02, py, d / 2], size: [t, parapet, d + 0.3] },
      { position: [w + 0.02, py, d / 2], size: [t, parapet, d + 0.3] },
    ],
    hvac: [
      { position: [w * 0.3, y + thickness, d * 0.4], yaw: 0 },
      { position: [w * 0.55, y + thickness, d * 0.4], yaw: 0 },
    ],
    ac: [0.15, 0.25, 0.75, 0.85].map((k, i) => ({ position: [w * k, y + thickness, i % 2 ? d * 0.7 : d * 0.75] as Vec3, yaw: 0 })),
    coreCap: (() => {
      const [cx, cz] = rectCenter(b.core);
      return { position: [cx, y + thickness / 2 + 0.6, cz], size: [b.core.x1 - b.core.x0, thickness + 1.2, b.core.z1 - b.core.z0] };
    })(),
  };
}
