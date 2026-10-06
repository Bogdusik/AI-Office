import type { BuildingLayout } from "./building";
import { CAMERA, DIM, FADE } from "./dims";
import type { SiteLayout } from "./site";
import { type Rect, type Vec3, rectCenter } from "./types";

export type CameraHome = {
  target: Vec3;
  position: Vec3;
  zoom: number;
  minZoom: number;
  maxZoom: number;
  boundary: { min: Vec3; max: Vec3 };
};

function viewBasis(azimuth: number, polar: number) {
  const o: Vec3 = [Math.sin(polar) * Math.sin(azimuth), Math.cos(polar), Math.sin(polar) * Math.cos(azimuth)];
  const right: Vec3 = [Math.cos(azimuth), 0, -Math.sin(azimuth)];
  const up: Vec3 = [
    o[1] * right[2] - o[2] * right[1],
    o[2] * right[0] - o[0] * right[2],
    o[0] * right[1] - o[1] * right[0],
  ];
  return { offset: o, right, up };
}

/** Screen-space extent (world units) of an axis-aligned box seen from the given angles. */
export function projectedSpan(r: Rect, y0: number, y1: number, azimuth: number, polar: number): [number, number] {
  const { right, up } = viewBasis(azimuth, polar);
  const xs: number[] = [];
  const ys: number[] = [];
  for (const x of [r.x0, r.x1])
    for (const y of [y0, y1])
      for (const z of [r.z0, r.z1]) {
        xs.push(x * right[0] + y * right[1] + z * right[2]);
        ys.push(x * up[0] + y * up[1] + z * up[2]);
      }
  return [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
}

export function cameraHome(b: BuildingLayout, site: SiteLayout, viewport: { width: number; height: number }): CameraHome {
  const { homeAzimuth: az, homePolar: polar, distance } = CAMERA;
  const buildingRect: Rect = { x0: b.core.x0, x1: b.width, z0: b.core.z0, z1: b.depth + DIM.canopy.d };
  const [cx, cz] = rectCenter(buildingRect);
  const target: Vec3 = [cx, b.height * 0.42, cz];
  const { offset } = viewBasis(az, polar);
  const fit = (r: Rect, height: number, fill: number) => {
    const [w, h] = projectedSpan(r, 0, height, az, polar);
    return Math.min(viewport.width / w, viewport.height / h) / fill;
  };
  const zoom = fit(buildingRect, b.height, CAMERA.homeFill);
  const siteZoom = fit(site.bounds, b.height, CAMERA.siteFill);
  const closeUp = Math.min(viewport.width, viewport.height) / CAMERA.closeUpWidth;
  const s = site.bounds;
  return {
    target,
    position: [target[0] + offset[0] * distance, target[1] + offset[1] * distance, target[2] + offset[2] * distance],
    zoom,
    minZoom: Math.min(siteZoom, zoom),
    maxZoom: Math.max(closeUp, zoom),
    // Pan keeps the orbit target anywhere on the site: building, parking, both roads near the intersection.
    boundary: { min: [s.x0, 0, s.z0], max: [s.x1, b.height, s.z1] },
  };
}

const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/** Opacity of a vertical surface with outward normal n, given the horizontal direction towards the camera. */
export function facadeOpacity(normal: [number, number], toCamera: [number, number]): number {
  const dot = normal[0] * toCamera[0] + normal[1] * toCamera[1];
  return 1 - smoothstep(FADE.from, FADE.to, dot) * (1 - FADE.hidden);
}

/** Roof opacity: hidden around the home zoom, fades in as the camera zooms out. */
export function roofOpacity(zoom: number, homeZoom: number): number {
  return smoothstep(homeZoom * CAMERA.roofHiddenAt, homeZoom * CAMERA.roofShownAt, zoom);
}
