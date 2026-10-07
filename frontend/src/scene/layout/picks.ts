import type { BuildingLayout, FloorLayout } from "./building";
import { deskTransform } from "./building";
import { DIM } from "./dims";
import type { ParkingSpot } from "./site";
import { type Box, type Vec3, boxIn, rectCenter } from "./types";

/** Anything the director can click in the scene. */
export type Selection =
  | { kind: "agent"; id: number }
  | { kind: "desk"; floorId: number; deskIndex: number }
  | { kind: "director" }
  | { kind: "server" }
  | { kind: "spot"; index: number };

export function selectionKey(s: Selection): string {
  switch (s.kind) {
    case "agent":
      return `agent:${s.id}`;
    case "desk":
      return `desk:${s.floorId}:${s.deskIndex}`;
    case "director":
      return "director";
    case "server":
      return "server";
    case "spot":
      return `spot:${s.index}`;
  }
}

/** Invisible hit volume of a selectable object; `focus` is where the camera looks when flying to it. */
export type Pick = { key: string; target: Selection; box: Box; focus: Vec3; floorNumber: number | null };

const pick = (target: Selection, box: Box, focus: Vec3, floorNumber: number | null): Pick => ({
  key: selectionKey(target),
  target,
  box,
  focus,
  floorNumber,
});

/** Desk, chair, seated person and plaque of one workstation. */
export function deskPick(f: FloorLayout, deskIndex: number, target: Selection): Pick {
  const [x, , z] = deskTransform(deskIndex).desk;
  const { deskW, deskBack, deskFront, height } = DIM.pick;
  return pick(
    target,
    boxIn({ x0: x - deskW / 2, x1: x + deskW / 2, z0: z - deskBack, z1: z + deskFront }, f.baseY, f.baseY + height),
    [x, f.baseY + 1, z + 0.5],
    f.number,
  );
}

export function directorPick(b: BuildingLayout, f: FloorLayout): Pick {
  const [cx, cz] = rectCenter(b.officeRoom);
  return pick({ kind: "director" }, boxIn(b.officeRoom, f.baseY, f.baseY + DIM.pick.room), [cx, f.baseY + 1, cz], f.number);
}

export function serverPick(f: FloorLayout, room: { x0: number; x1: number; z0: number; z1: number }): Pick {
  const [cx, cz] = rectCenter(room);
  return pick({ kind: "server" }, boxIn(room, f.baseY, f.baseY + DIM.pick.room), [cx, f.baseY + 1, cz], f.number);
}

export function spotPick(spot: ParkingSpot): Pick {
  const [x, , z] = spot.center;
  const { spotW, spotD } = DIM.parking;
  return pick(
    { kind: "spot", index: spot.index },
    boxIn({ x0: x - spotW / 2, x1: x + spotW / 2, z0: z - spotD / 2, z1: z + spotD / 2 }, 0, DIM.pick.car),
    [x, 0.5, z],
    null,
  );
}
