import { hashString } from "@/scene/layout";

export const PALETTE = {
  sky: "#eef0ee",
  ground: "#f1ede5",
  grass: "#d5dccb",
  slab: "#f6f3ee",
  slabEdge: "#d9d2c5",
  wall: "#ebe6dd",
  glass: "#bcd3dd",
  wood: "#c8b69a",
  deskTop: "#efe9df",
  metal: "#9aa1a9",
  dark: "#2d323b",
  screen: "#3d4a5c",
  screenOn: "#9fc6d8",
  chair: "#5b6370",
  free: "#d7d2c9",
  plaque: "#fbfaf7",
  plaqueText: "#2d323b",
  core: "#dcd6cb",
  shaftGlass: "#cfe0e6",
  road: "#8a8f96",
  roadLine: "#f3f1ea",
  asphalt: "#b4b7bb",
  curb: "#d6d1c6",
  plant: "#7f9b78",
  pot: "#b9a68b",
  skin: "#e2c4a8",
  accent: "#ff7a59",
} as const;

const OUTFITS = ["#6f8aa6", "#8b9e7c", "#a58c7a", "#7d7a99", "#6f9a9a", "#a3917a", "#8a8f99"] as const;
const CARS = ["#c9ccd1", "#7e8fa3", "#a8b5a0", "#d8d2c4", "#8d8f94", "#b4a596"] as const;

export function outfitColor(roleKey: string): string {
  return OUTFITS[hashString(roleKey) % OUTFITS.length];
}

export function carColor(roleKey: string): string {
  return CARS[hashString(`car:${roleKey}`) % CARS.length];
}
