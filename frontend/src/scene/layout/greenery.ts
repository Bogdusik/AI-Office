import type { BuildingLayout, EntranceLayout } from "./building";
import type { SiteLayout } from "./site";
import type { Vec3 } from "./types";

export type GreeneryKind = "conifer" | "deciduous" | "bush" | "flowerbed";
export type GreeneryItem = { kind: GreeneryKind; position: Vec3; scale: number; variant: number };

const inAny = (v: number, ranges: [number, number][]) => ranges.some(([a, c]) => v > a && v < c);

/**
 * Trees along both roads (clear of the site frontage, the walkway and the intersection),
 * shrubs around the building, flower beds at the entrance, trees and shrubs around the parking.
 */
export function greenery(b: BuildingLayout, site: SiteLayout, entrance: EntranceLayout): GreeneryItem[] {
  const items: GreeneryItem[] = [];
  let n = 0;
  const add = (kind: GreeneryKind, x: number, z: number, scale = 1) => {
    items.push({ kind, position: [x, 0, z], scale: scale * (0.85 + ((n * 37) % 10) / 33), variant: n % 3 });
    n++;
  };
  const { main, cross } = site.roads;

  const crossBand: [number, number] = [cross.x0 - 4, cross.x1 + 4];
  const frontage: [number, number] = [b.core.x0 - 3, site.lot.x1 + 3];
  const walkway: [number, number] = [entrance.walkway.x0 - 2.5, entrance.walkway.x1 + 2.5];
  let i = 0;
  for (let x = main.x0 + 6; x < main.x1 - 6; x += 7.5, i++) {
    if (!inAny(x, [frontage, crossBand])) add(i % 3 === 1 ? "conifer" : "deciduous", x, main.z0 - 2.4);
    if (!inAny(x + 3.5, [walkway, crossBand])) add(i % 2 === 0 ? "conifer" : "deciduous", x + 3.5, main.z1 + 2.8);
  }
  const mainBand: [number, number] = [main.z0 - 4, main.z1 + 4];
  for (let z = cross.z0 + 6; z < cross.z1 - 6; z += 7.5, i++) {
    if (!inAny(z, [mainBand])) {
      add(i % 2 === 0 ? "deciduous" : "conifer", cross.x0 - 2.6, z);
      add(i % 2 === 1 ? "deciduous" : "conifer", cross.x1 + 2.6, z + 3.5);
    }
  }

  for (let x = 1.2; x < b.width - 0.5; x += 2.6) add("bush", x, -1.4, 0.9);
  for (let z = 1.2; z < b.depth - 0.5; z += 2.6) add("bush", b.width + 1.6, z, 0.9);
  add("flowerbed", entrance.walkway.x0 - 2.2, b.depth + 2.6);
  add("flowerbed", entrance.walkway.x1 + 2.2, b.depth + 2.6);
  add("flowerbed", 3.5, b.depth + 2.6);
  add("flowerbed", b.width - 3.5, b.depth + 2.6);
  add("deciduous", b.core.x0 - 4, b.core.z0 + 1);
  add("conifer", b.core.x0 - 5, b.depth + 2);
  add("deciduous", -2, -4);
  add("deciduous", b.width * 0.5, -4.5);
  add("conifer", b.width - 2, -4);

  const lot = site.lot;
  for (let x = lot.x0 + 1; x < lot.x1; x += 2.3) add("bush", x, lot.z0 - 1.4, 0.8);
  for (let x = lot.x0; x <= lot.x1 + 0.1; x += 5) add(n % 2 ? "deciduous" : "conifer", x, lot.z0 - 4.2, 0.95);
  for (let z = lot.z0 + 1; z < lot.z1 - 1.5; z += 2.3) add("bush", lot.x1 + 1.4, z, 0.8);
  for (let z = lot.z0; z < lot.z1 - 1.5; z += 4.5) add("deciduous", lot.x1 + 4.2, z, 0.9);
  for (let z = lot.z0 + 2; z < lot.z1 - 4; z += 4) add("bush", lot.x0 - 1.6, z, 0.8);
  return items;
}
