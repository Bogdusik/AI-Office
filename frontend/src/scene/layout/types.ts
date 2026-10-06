export type Vec3 = [number, number, number];
export type Rect = { x0: number; x1: number; z0: number; z1: number };
export type Box = { position: Vec3; size: Vec3; rotation?: Vec3 };
export type Placement = { position: Vec3; yaw: number };

/** Unit primitives; `scale` is the full size along each axis (diameter for round shapes). */
export type Shape = "box" | "cylinder" | "sphere" | "ico" | "cone" | "prism";
/** Material family of a part; parts with the same shape and finish are drawn as one instanced mesh. */
export type Finish = "matte" | "foliage" | "decal" | "glass" | "ghost" | "screen";
/** Rotation uses Euler order YXZ so a placement yaw can simply be added to `rotation[1]`. */
export type Part = { shape: Shape; position: Vec3; scale: Vec3; rotation?: Vec3; color: string; finish?: Finish };

export type FloorKind = "reception" | "office";
export type FloorInput = { number: number; kind: FloorKind; capacity: number; has_director_office: boolean };

export const rectCenter = (r: Rect): [number, number] => [(r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2];
export const rectSize = (r: Rect): [number, number] => [r.x1 - r.x0, r.z1 - r.z0];
export const inRect = (r: Rect, x: number, z: number, pad = 0) =>
  x > r.x0 - pad && x < r.x1 + pad && z > r.z0 - pad && z < r.z1 + pad;

export function boxIn(r: Rect, y0: number, y1: number): Box {
  const [cx, cz] = rectCenter(r);
  const [w, d] = rectSize(r);
  return { position: [cx, (y0 + y1) / 2, cz], size: [w, y1 - y0, d] };
}

export function part(
  shape: Shape,
  position: Vec3,
  scale: Vec3,
  color: string,
  finish: Finish = "matte",
  rotation?: Vec3,
): Part {
  return { shape, position, scale, color, finish, rotation };
}

export const cube = (position: Vec3, scale: Vec3, color: string, finish?: Finish, rotation?: Vec3) =>
  part("box", position, scale, color, finish, rotation);

/** Rotate parts about Y by `yaw` and move them to `position` (same convention as three's rotation.y). */
export function place(parts: Part[], at: Placement): Part[] {
  const c = Math.cos(at.yaw);
  const s = Math.sin(at.yaw);
  const [px, py, pz] = at.position;
  return parts.map((p) => {
    const [x, y, z] = p.position;
    const r = p.rotation ?? [0, 0, 0];
    return {
      ...p,
      position: [px + x * c + z * s, py + y, pz - x * s + z * c],
      rotation: [r[0], r[1] + at.yaw, r[2]],
    };
  });
}

export const lift = (parts: Part[], dy: number): Part[] => place(parts, { position: [0, dy, 0], yaw: 0 });
