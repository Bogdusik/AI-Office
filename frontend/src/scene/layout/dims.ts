export const DIM = {
  floorHeight: 3.2,
  /** Minimum open air between a floor's walls and the next slab; the real gap is derived in `floorPitch`. */
  minFloorGap: 1,
  slab: 0.25,
  wall: 0.15,
  margin: 1,
  deskCols: 3,
  deskPitchX: 4,
  deskPitchZ: 3.8,
  desk: { w: 2, d: 0.9, h: 0.75 },
  chair: { seat: 0.5, offset: 0.95 },
  plaque: { w: 3, h: 0.84, y: 2.05, font: 0.2 },
  sideZone: 7,
  kitchenZone: 5.5,
  office: { inset: 0.35, d: 5.8 },
  door: { w: 4.8, leaf: 2.3 },
  canopy: { w: 7.2, d: 2.6 },
  window: { width: 1.8, gap: 0.9, sill: 0.9, head: 2.55 },
  core: { w: 3.6, elevator: 2.8, landing: 1.3, flightRun: 5.6 },
  stair: { tread: 0.28, laneW: 1.45 },
  road: { setback: 7, width: 7, halfLength: 160, laneOffset: 1.75 },
  cross: { gapFromLot: 12 },
  parking: { gap: 5, spotW: 2.7, spotD: 5.2, aisle: 6.5, laneW: 3.6, island: 1.2, curb: 0.6, guestSpots: 2 },
  fence: { step: 2.5, height: 1.1, inset: 0.4 },
  roof: { parapet: 0.7, thickness: 0.3 },
  /** Invisible click volumes: a workstation (desk, chair, person, plaque), the director's room, a parked car. */
  pick: { deskW: 2.6, deskBack: 0.7, deskFront: 1.6, height: 2.5, room: 2.7, car: 1.5 },
  carTag: { y: 2.1 },
  /** Server room in the kitchen zone of its floor; racks stand in a row by the back wall. */
  server: { inset: 0.35, depth: 4.4, racks: 4, rack: { w: 0.62, d: 1.0, h: 2.0 }, gap: 0.22, leds: 5, door: 1.3 },
  /** Glass partition between the desks and the kitchen/lounge side, with a doorway. */
  partition: { height: 2.7, door: 1.8 },
} as const;

export const CAMERA = {
  homeAzimuth: Math.PI / 4,
  homePolar: Math.PI / 3,
  minPolar: (15 * Math.PI) / 180,
  maxPolar: (75 * Math.PI) / 180,
  distance: 200,
  homeFill: 1.08,
  siteFill: 1.02,
  closeUpWidth: 5,
  smoothTime: 0.28,
  draggingSmoothTime: 0.12,
  /** Zoom when flying to a selected object, as a multiple of the home zoom. */
  focusZoom: 2.6,
  /** Roof fades in when zoomed out below these fractions of the home zoom. */
  roofHiddenAt: 0.85,
  roofShownAt: 0.6,
} as const;

export const FADE = { hidden: 0.07, from: 0.12, to: 0.5, lambda: 8 } as const;
