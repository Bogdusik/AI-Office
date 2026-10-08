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
  /**
   * `aisleLane`: offset of the inbound (−) and outbound (+) driving lines from the aisle centre;
   * `endRoom`: free asphalt past the last spot so a car can reverse out; `gate`: pedestrian gap in the west fence.
   */
  parking: { gap: 5, spotW: 2.7, spotD: 5.2, aisle: 6.5, laneW: 3.6, island: 1.2, curb: 0.6, guestSpots: 2, aisleLane: 1.3, endRoom: 3.2, gate: 1.4, armShort: 0.6, barrierSetback: 4 },
  fence: { step: 2.5, height: 1.1, inset: 0.4 },
  roof: { parapet: 0.7, thickness: 0.3 },
  /** Invisible click volumes: a workstation (desk, chair, person, plaque), the director's room, a parked car. */
  pick: { deskW: 2.6, deskBack: 0.7, deskFront: 1.6, height: 2.5, room: 2.7, car: 1.5 },
  carTag: { y: 2.1 },
  /** Server room in the kitchen zone of its floor; racks stand in a row by the back wall. */
  server: { inset: 0.35, depth: 4.4, racks: 4, rack: { w: 0.62, d: 1.0, h: 2.0 }, gap: 0.22, leds: 5, door: 1.3 },
  /** Glass partition between the desks and the kitchen/lounge side, with a doorway. */
  partition: { height: 2.7, door: 1.8 },
  /**
   * Office life (stage 7b). `windowZ`: back corridor along the windows; `talkGap`: distance between two people
   * talking; `talkAside`: conversation places stand this far off the right corridor; sofa seats are reached from
   * `sofaSide` left of the lounge centre along a strip `sofaFront` in front of the sofa.
   */
  life: {
    windowZ: 0.65,
    talkGap: 0.95,
    talkAside: 0.4,
    sofaSide: 1.65,
    sofaFront: 0.83,
    queueExit: 0.8,
    /** Waiting for the model longer than this (s) → coffee; `busyWait` when someone else is already waiting too. */
    shortWait: 30,
    busyWait: 10,
    /** At most this many coffee trips at a time (the queue has 4 places). */
    coffeeTrips: 3,
    brew: 8,
    /** Global grid for strolls and conversations (s); conversations start on even legs and last two legs. */
    leg: 30,
    talkChance: 0.45,
    /** Walking back to the desk after a real change is this much faster. */
    hurry: 1.5,
    stand: 1.1,
    queueStep: 1,
    /** A free agent resting on the sofa or by a window goes for a stroll on about every `strollEvery`-th leg… */
    strollEvery: 3,
    /** …and stands at the stroll's end this long before going back. */
    strollPause: 3,
  },
  /** Walking graph: a person's clearance radius and the stair opening from a floor to its landing. */
  walk: { radius: 0.28, stairDoor: 1.05, readerStand: 0.55, carSide: 1.35, outside: 0.8, inside: 0.7 },
  /**
   * Trips (stage 7a). Speeds in m/s, times in s; the planner scales them by one pace factor per trip
   * (between `paceMin` and `paceMax`) so a trip lasts exactly the backend's duration.
   */
  motion: {
    walk: 1.9,
    stairs: 1,
    road: 24,
    lot: 7,
    reverse: 2,
    brake: 40,
    turn: 2.4,
    getOut: 1.4,
    sit: 1.4,
    tap: 1.4,
    gateRaise: 0.9,
    gateClear: 1.8,
    doorOpen: 0.7,
    lift: { speed: 3, doors: 0.9, step: 1.1, hold: 0.8, capacity: 4, home: 4 },
    queueGap: 0.9,
    paceMin: 0.6,
    paceMax: 1.3,
    stride: 1.25,
  },
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
