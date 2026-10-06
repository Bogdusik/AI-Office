/**
 * All scene geometry lives here as pure functions of world data.
 * Axes: y is up; the camera looks from +x/+z, so the far (kept) walls are at x = 0 and z = 0
 * and the near ones (x = width, z = depth) are omitted.
 * Floor-local positions are relative to the floor's slab top (y = 0).
 */

export type Vec3 = [number, number, number];

export type Rect = { x0: number; x1: number; z0: number; z1: number };

export type FloorInput = { number: number; capacity: number; has_director_office: boolean };

export const DIM = {
  floorHeight: 3.2,
  /** Open air between a floor's walls and the next slab, so lower floors stay visible from the iso camera. */
  floorGap: 2.9,
  slab: 0.25,
  wall: 0.15,
  margin: 0.8,
  deskCols: 3,
  deskPitchX: 2.6,
  deskPitchZ: 2.4,
  desk: { w: 1.6, d: 0.8, h: 0.75 },
  chair: { seat: 0.48 },
  office: { w: 5, d: 4.2 },
  plaque: { w: 2, h: 0.5, y: 1.95 },
  core: { w: 3.2, d: 5 },
  door: { w: 1.4, h: 2.4 },
  window: { width: 1.6, gap: 0.8, sill: 0.9, head: 2.5 },
  road: { setback: 4, width: 6 },
  parking: { gap: 3, spotW: 2.6, spotD: 5, aisle: 5.5, entryW: 3.4, perRow: 8 },
} as const;

export const rectCenter = (r: Rect): [number, number] => [(r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2];
export const rectSize = (r: Rect): [number, number] => [r.x1 - r.x0, r.z1 - r.z0];

const rowsFor = (capacity: number) => Math.max(1, Math.ceil(capacity / DIM.deskCols));

export function deskZoneSize(maxCapacity: number): { width: number; depth: number } {
  return {
    width: DIM.margin * 2 + DIM.deskCols * DIM.deskPitchX,
    depth: DIM.margin * 2 + rowsFor(maxCapacity) * DIM.deskPitchZ,
  };
}

/* ---------- workstations ---------- */

export type DeskTransform = {
  desk: Vec3;
  monitor: Vec3;
  chair: Vec3;
  seat: Vec3;
  plaque: Vec3;
  plaqueYaw: number;
};

/** Desk grid is filled row by row; the seated agent faces -z, towards the monitor. */
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
    plaqueYaw: Math.PI / 4,
  };
}

export function deskIndices(capacity: number): number[] {
  return Array.from({ length: capacity }, (_, i) => i);
}

/* ---------- building ---------- */

export type FloorLayout = {
  number: number;
  index: number;
  baseY: number;
  capacity: number;
  hasDirectorOffice: boolean;
};

export type BuildingLayout = {
  width: number;
  depth: number;
  height: number;
  officeZone: Rect;
  officeRoom: Rect;
  lounge: Vec3;
  floors: FloorLayout[];
  core: Rect;
  coreHeight: number;
};

export const FLOOR_PITCH = DIM.floorHeight + DIM.floorGap;

export function floorBaseY(index: number): number {
  return index * FLOOR_PITCH + DIM.slab;
}

/** Vertical extent of a floor's core segment / columns: up to the next slab, or just the walls on top. */
export function storeyHeight(isTop: boolean): number {
  return isTop ? DIM.floorHeight : FLOOR_PITCH;
}

export function buildingLayout(floors: readonly FloorInput[]): BuildingLayout {
  const sorted = [...floors].sort((a, b) => a.number - b.number);
  const maxCapacity = Math.max(1, ...sorted.map((f) => f.capacity));
  const zone = deskZoneSize(maxCapacity);
  const width = zone.width + DIM.office.w;
  const depth = Math.max(zone.depth, DIM.office.d + DIM.margin * 2);

  const officeZone: Rect = { x0: zone.width, x1: width, z0: 0, z1: depth };
  const officeRoom: Rect = {
    x0: zone.width + 0.2,
    x1: width - 0.6,
    z0: 0.6,
    z1: 0.6 + DIM.office.d,
  };
  const floorLayouts = sorted.map((f, index) => ({
    number: f.number,
    index,
    baseY: floorBaseY(index),
    capacity: f.capacity,
    hasDirectorOffice: f.has_director_office,
  }));
  const height = Math.max(0, sorted.length - 1) * FLOOR_PITCH + DIM.floorHeight + DIM.slab;

  return {
    width,
    depth,
    height,
    officeZone,
    officeRoom,
    lounge: [(officeZone.x0 + officeZone.x1) / 2, 0, 2.6],
    floors: floorLayouts,
    core: { x0: -DIM.core.w, x1: 0, z0: depth - DIM.core.d, z1: depth },
    coreHeight: height + 0.9,
  };
}

/* ---------- walls ---------- */

export type Box = { position: Vec3; size: Vec3 };

export type WallPieces = { solid: Box[]; glass: Box[] };

/**
 * A wall along local +u (length) with window bands; u maps to x or z by the caller.
 * Returns boxes in wall-local space: [u, y, 0] with thickness on the third axis.
 */
export function wallWithWindows(length: number, height: number): WallPieces {
  const { width, gap, sill, head } = DIM.window;
  const t = DIM.wall;
  const solid: Box[] = [
    { position: [length / 2, sill / 2, 0], size: [length, sill, t] },
    { position: [length / 2, (head + height) / 2, 0], size: [length, height - head, t] },
  ];
  const glass: Box[] = [];
  const count = Math.max(0, Math.floor((length - gap) / (width + gap)));
  const used = count * width + (count + 1) * gap;
  const pad = (length - used) / 2;
  let cursor = 0;
  const pier = (from: number, to: number) => {
    if (to - from > 0.01) {
      solid.push({ position: [(from + to) / 2, (sill + head) / 2, 0], size: [to - from, head - sill, t] });
    }
  };
  for (let i = 0; i < count; i++) {
    const start = pad + gap + i * (width + gap);
    pier(cursor, start);
    glass.push({ position: [start + width / 2, (sill + head) / 2, 0], size: [width, head - sill, t * 0.4] });
    cursor = start + width;
  }
  pier(cursor, length);
  return { solid, glass };
}

/* ---------- core: elevator + stairs ---------- */

export type CoreLayout = { shaft: Rect; stairs: Rect; sign: Vec3 };

export function coreLayout(b: BuildingLayout): CoreLayout {
  const { core } = b;
  const shaftDepth = 2.2;
  return {
    shaft: { x0: core.x0 + 0.3, x1: core.x1 - 0.3, z0: core.z0 + 0.2, z1: core.z0 + 0.2 + shaftDepth },
    stairs: { x0: core.x0 + 0.2, x1: core.x1 - 0.2, z0: core.z0 + 0.4 + shaftDepth, z1: core.z1 - 0.2 },
    sign: [core.x0 + 0.15, 0, core.z1 + 0.01],
  };
}

/** One straight flight per storey (up to the next slab), alternating direction along x. Positions are floor-local. */
export function stairSteps(stairs: Rect, floorIndex: number, steps = 16): Box[] {
  const [w, d] = rectSize(stairs);
  const rise = FLOOR_PITCH / steps;
  const run = w / steps;
  const forward = floorIndex % 2 === 0;
  return Array.from({ length: steps }, (_, i) => {
    const k = forward ? i : steps - 1 - i;
    const h = rise * (i + 1);
    return {
      position: [stairs.x0 + run * (k + 0.5), h / 2, (stairs.z0 + stairs.z1) / 2] as Vec3,
      size: [run, h, d * 0.9] as Vec3,
    };
  });
}

/* ---------- entrance ---------- */

export type EntranceLayout = { door: Vec3; reader: Vec3; walkway: Rect };

export function entranceLayout(b: BuildingLayout): EntranceLayout {
  const x = DIM.margin + DIM.door.w / 2 + 0.2;
  return {
    door: [x, DIM.slab, b.depth],
    reader: [x + DIM.door.w / 2 + 0.45, DIM.slab, b.depth + 0.35],
    walkway: { x0: x - 1, x1: x + 1, z0: b.depth, z1: b.depth + DIM.road.setback },
  };
}

/* ---------- site: road + parking ---------- */

export type ParkingSpot = { index: number; center: Vec3; director: boolean };

export type SiteLayout = {
  road: Rect;
  lot: Rect;
  entry: Rect;
  barrier: { post: Vec3; length: number };
  spots: ParkingSpot[];
  bounds: Rect;
  /** What the home camera frames: building, core and parking lot (the road may run off-screen). */
  focus: Rect;
};

/** Spot 0 is the director's; agent i (sorted by id) parks in spot i + 1. */
export function siteLayout(b: BuildingLayout, agentCount: number): SiteLayout {
  const p = DIM.parking;
  const spotCount = agentCount + 1;
  const rows = Math.ceil(spotCount / p.perRow);
  const perRow = Math.min(spotCount, p.perRow);

  const roadZ0 = b.depth + DIM.road.setback;
  const road: Rect = { x0: 0, x1: 0, z0: roadZ0, z1: roadZ0 + DIM.road.width };

  const lotX0 = b.width + p.gap;
  const lotX1 = lotX0 + p.entryW + perRow * p.spotW + 0.6;
  const lotZ1 = roadZ0;
  const lotZ0 = lotZ1 - p.aisle - rows * p.spotD;
  const lot: Rect = { x0: lotX0, x1: lotX1, z0: lotZ0, z1: lotZ1 };
  const entry: Rect = { x0: lotX0, x1: lotX0 + p.entryW, z0: lotZ1 - 0.4, z1: lotZ1 };

  const spots: ParkingSpot[] = Array.from({ length: spotCount }, (_, i) => {
    const row = Math.floor(i / p.perRow);
    const col = i % p.perRow;
    const x = lotX0 + p.entryW + p.spotW * (col + 0.5);
    const z = lotZ1 - p.aisle - p.spotD * (row + 0.5);
    return { index: i, center: [x, 0, z] as Vec3, director: i === 0 };
  });

  const minX = b.core.x0 - 2;
  const maxX = lot.x1 + 2;
  road.x0 = minX;
  road.x1 = maxX;

  return {
    road,
    lot,
    entry,
    barrier: { post: [lotX0 + 0.25, 0, lotZ1 - 0.3], length: p.entryW - 0.4 },
    spots,
    bounds: { x0: minX, x1: maxX, z0: Math.min(-1, lotZ0 - 1), z1: road.z1 },
    focus: { x0: b.core.x0, x1: lot.x1, z0: Math.min(0, lotZ0), z1: roadZ0 + DIM.road.width / 2 },
  };
}

/** Trees along the far side of the road, skipping the walkway and the parking entry. */
export function treePositions(site: SiteLayout, walkway: Rect): Vec3[] {
  const z = site.road.z1 + 1.8;
  const step = 7;
  const trees: Vec3[] = [];
  for (let x = site.road.x0 + 3; x <= site.road.x1 - 3; x += step) {
    const blocked = [walkway, site.entry].some((r) => x > r.x0 - 1.5 && x < r.x1 + 1.5);
    if (!blocked) trees.push([x, 0, z]);
  }
  return trees;
}

/* ---------- camera ---------- */

export const CAMERA = {
  azimuth: Math.PI / 4,
  azimuthRange: (40 * Math.PI) / 180,
  polar: Math.acos(1 / Math.sqrt(3)),
  minPolar: (25 * Math.PI) / 180,
  maxPolar: (70 * Math.PI) / 180,
  distance: 80,
  zoomFill: 1.08,
  minZoomFactor: 0.6,
  maxZoomFactor: 4,
} as const;

export type CameraHome = { target: Vec3; position: Vec3; zoom: number; minZoom: number; maxZoom: number };

export function cameraHome(bounds: Rect, height: number, viewport: { width: number; height: number }): CameraHome {
  const [cx, cz] = rectCenter(bounds);
  const [w, d] = rectSize(bounds);
  const target: Vec3 = [cx, height * 0.35, cz];
  const { azimuth, polar, distance } = CAMERA;
  const position: Vec3 = [
    cx + distance * Math.sin(polar) * Math.sin(azimuth),
    target[1] + distance * Math.cos(polar),
    cz + distance * Math.sin(polar) * Math.cos(azimuth),
  ];
  // Iso projection of the site's footprint: horizontal span ≈ (w + d)·cos45°, vertical ≈ (w + d)·sin45°·cos(polar) + height
  const spanX = (w + d) * Math.SQRT1_2;
  const spanY = (w + d) * Math.SQRT1_2 * Math.cos(polar) + height * Math.sin(polar);
  const zoom = Math.min(viewport.width / spanX, viewport.height / spanY) / CAMERA.zoomFill;
  return {
    target,
    position,
    zoom,
    minZoom: zoom * CAMERA.minZoomFactor,
    maxZoom: zoom * CAMERA.maxZoomFactor,
  };
}

/* ---------- appearance helpers ---------- */

/** Structural columns at the slab corners, floor-local; they span the gap up to the next slab. */
export function columnPositions(b: BuildingLayout): Vec3[] {
  const inset = 0.15;
  return [
    [inset, 0, inset],
    [b.width - inset, 0, inset],
    [b.width - inset, 0, b.depth - inset],
    [inset, 0, b.depth - inset],
  ];
}

export function hashString(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i++) h = (h * 31 + value.charCodeAt(i)) | 0;
  return Math.abs(h);
}
