/**
 * Parts that move with trips: the lift cabin, lift landing doors, entrance doors, barrier arms, the reader light,
 * and the people and cars themselves. Shapes and rest positions live here; the scene only applies offsets.
 */
import { PALETTE } from "@/scene/palette";
import { type BuildingLayout, type EntranceLayout, coreLayout, elevatorOpening } from "./building";
import { DIM } from "./dims";
import type { Barrier, SiteLayout } from "./site";
import { type Part, type Vec3, cube, part, rectCenter, rectSize } from "./types";

/** A sliding leaf: parts around its closed centre, and the direction it slides to open. */
export type Leaf = { center: Vec3; parts: Part[]; slide: Vec3 };
export type LandingDoors = { floorIndex: number; floorNumber: number; leaves: Leaf[] };
export type ArmSpec = { pivot: Vec3; direction: 1 | -1; parts: Part[] };

export type MovingSpec = {
  cabin: { center: [number, number]; parts: Part[] };
  landings: LandingDoors[];
  entrance: Leaf[];
  arms: ArmSpec[];
  reader: Vec3;
};

/** Lift cabin with its floor at y = 0: open towards the landing doors (+x), translucent walls and roof. */
function cabinParts(b: BuildingLayout): Part[] {
  const [w, d] = rectSize(coreLayout(b).shaft);
  const [cw, cd, h] = [w - 0.3, d - 0.3, 2.4];
  const t = 0.05;
  return [
    cube([0, 0.04, 0], [cw, 0.08, cd], PALETTE.steel),
    cube([-cw / 2 + t / 2, h / 2, 0], [t, h, cd], PALETTE.metal, "glass"),
    ...[-1, 1].map((s) => cube([0, h / 2, (s * (cd - t)) / 2], [cw, h, t], PALETTE.metal, "glass")),
    cube([0, h - 0.04, 0], [cw, 0.08, cd], PALETTE.metal, "glass"),
    cube([cw / 2 - 0.05, h - 0.12, 0], [0.06, 0.16, cd], PALETTE.steel),
  ];
}

function landingLeaves(b: BuildingLayout, y: number): Leaf[] {
  const o = elevatorOpening(b);
  const mid = (o.from + o.to) / 2;
  const ow = o.to - o.from;
  const x = DIM.wall + 0.01;
  return [-1, 1].map((s) => ({
    center: [x, y + 1.15, mid + (s * ow) / 4] as Vec3,
    parts: [cube([0, 0, 0], [0.04, 2.3, ow / 2 - 0.02], PALETTE.metal)],
    slide: [0, 0, (s * ow) / 2 - s * 0.05] as Vec3,
  }));
}

function entranceLeaves(e: EntranceLayout): Leaf[] {
  const [x, y, z] = e.door;
  const { leaf } = DIM.door;
  const h = DIM.floorHeight - DIM.slab - 0.14;
  return [-1, 1].map((s) => ({
    center: [x + (s * (leaf + 0.08)) / 2, y + h / 2, z] as Vec3,
    parts: [
      cube([0, 0, 0], [leaf - 0.06, h, 0.04], PALETTE.glass, "glass"),
      cube([-s * (leaf / 2 - 0.25), 1.15 - h / 2, 0.07], [0.05, 1.2, 0.05], PALETTE.metal),
    ],
    slide: [s * (leaf - 0.2), 0, 0] as Vec3,
  }));
}

/** Striped barrier arm along +x from its pivot (mirrored by `direction`). */
function armParts(b: Barrier): Part[] {
  const stripes = 7;
  const stripe = b.length / stripes;
  return Array.from({ length: stripes }, (_, i) =>
    cube([b.direction * (stripe * (i + 0.5)), 0, 0], [stripe, 0.1, 0.1], i % 2 === 0 ? PALETTE.accent : "#ffffff"),
  );
}

export function movingSpec(b: BuildingLayout, site: SiteLayout, e: EntranceLayout): MovingSpec {
  const [cx, cz] = rectCenter(coreLayout(b).shaft);
  const [rx, , rz] = e.reader;
  return {
    cabin: { center: [cx, cz], parts: cabinParts(b) },
    landings: b.floors.map((f) => ({ floorIndex: f.index, floorNumber: f.number, leaves: landingLeaves(b, f.baseY) })),
    entrance: entranceLeaves(e),
    arms: site.barriers.map((bar) => ({ pivot: [bar.post[0] + bar.direction * 0.18, 0.98, bar.post[2]], direction: bar.direction, parts: armParts(bar) })),
    reader: [rx, 1.17, rz + 0.106],
  };
}

/** Raised barrier arm angle (radians) at full opening. */
export const ARM_RAISED = 1.35;

/* ---------- people ---------- */

/**
 * A person built for animation: origin on the floor, facing −z. Each limb hangs from its pivot so the
 * scene can swing it; with every angle at 0 the person stands upright.
 */
export type Figure = {
  hipY: number;
  seatedHipY: number;
  body: Part[];
  thigh: { pivot: [number, number, number]; parts: Part[] };
  shin: { pivot: [number, number, number]; parts: Part[] };
  arm: { pivot: [number, number, number]; parts: Part[] };
};

export function figure(outfit: string): Figure {
  const hipY = 0.88;
  return {
    hipY,
    // Same height as the seated model at a desk (`seatedPerson`): seat surface + 0.08.
    seatedHipY: DIM.chair.seat + 0.05 + 0.08,
    body: [
      part("cylinder", [0, 0.32, 0.04], [0.4, 0.56, 0.3], outfit),
      cube([0, 0.02, 0.02], [0.38, 0.16, 0.28], PALETTE.trousers),
      part("sphere", [0, 0.8, 0.02], [0.3, 0.32, 0.3], PALETTE.skin),
      part("sphere", [0, 0.87, 0.06], [0.32, 0.2, 0.32], PALETTE.hair),
    ],
    thigh: { pivot: [0.1, 0, 0.02], parts: [cube([0, -0.23, 0], [0.17, 0.46, 0.16], PALETTE.trousers)] },
    shin: { pivot: [0, -0.46, 0], parts: [cube([0, -0.2, 0], [0.15, 0.42, 0.14], PALETTE.trousers), cube([0, -0.4, -0.06], [0.15, 0.06, 0.26], PALETTE.dark)] },
    arm: { pivot: [0.25, 0.56, 0.02], parts: [part("cylinder", [0, -0.21, 0], [0.11, 0.42, 0.11], outfit)] },
  };
}

/** Walking cycle and sitting for a figure: angles about x (positive swings forward, towards −z). */
export function figurePose(walked: number, speed: number, sit: number, tapping: boolean) {
  const phase = (walked / DIM.motion.stride) * Math.PI * 2;
  const amp = Math.min(1, speed / 1.2) * (1 - sit);
  const swing = Math.sin(phase) * 0.55 * amp;
  const knee = (s: number) => -Math.max(0, -Math.sin(phase + s)) * 0.7 * amp;
  const reach = 1.05 * sit;
  return {
    legs: [
      { thigh: swing + (sit * Math.PI) / 2, shin: knee(0) - (sit * Math.PI) / 2 },
      { thigh: -swing + (sit * Math.PI) / 2, shin: knee(Math.PI) - (sit * Math.PI) / 2 },
    ],
    arms: [-swing * 0.8 + reach, tapping ? 1.35 : swing * 0.8 + reach],
    bob: Math.abs(Math.sin(phase)) * 0.03 * amp,
  };
}
