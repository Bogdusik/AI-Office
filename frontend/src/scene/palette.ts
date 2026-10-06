import { hashString } from "@/scene/layout";

const GROUND = "#f1ede5";

export const PALETTE = {
  /** Scene background equals the ground so the horizon never shows. */
  sky: GROUND,
  ground: GROUND,
  slab: "#f6f3ee",
  slabEdge: "#d9d2c5",
  wall: "#ebe6dd",
  glass: "#bcd3dd",
  wood: "#c8b69a",
  darkWood: "#9c8064",
  deskTop: "#efe9df",
  metal: "#9aa1a9",
  steel: "#6f7680",
  dark: "#2d323b",
  screen: "#3d4a5c",
  screenOn: "#9fc6d8",
  chair: "#5b6370",
  free: "#d7d2c9",
  fabric: "#c9c4bb",
  fabricDark: "#a9a49b",
  rug: "#e9ddd2",
  plaque: "#fbfaf7",
  plaqueText: "#2d323b",
  core: "#dcd6cb",
  shaftGlass: "#cfe0e6",
  road: "#8a8f96",
  roadLine: "#f3f1ea",
  asphalt: "#b4b7bb",
  curb: "#d6d1c6",
  plant: "#7f9b78",
  leaf: ["#8faa7f", "#7d9a72", "#9bb08a"],
  conifer: "#6f8c6a",
  bush: "#86a079",
  soil: "#9b8a73",
  flowers: ["#e8c9c0", "#d9c8e3", "#f0dfb8", "#ffffff"],
  pot: "#b9a68b",
  trunk: "#a08a70",
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
