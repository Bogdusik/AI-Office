/**
 * Sanity checks for the pure scene layout (no test runner):
 *   node --experimental-strip-types --no-warnings --import ./scripts/register-ts.mjs scripts/check-layout.mts
 */
import assert from "node:assert/strict";
import { RIBBON, ribbonState } from "@/lib/stages";
import { MAP_EDGES, type Vec3, buildScene, inRect, presence, routeGraph } from "@/scene/layout";

type FloorFixture = Parameters<typeof buildScene>[0][number];

const floor = (number: number, kind: "reception" | "office", capacity: number, office = false, agents = 0): FloorFixture => ({
  id: number,
  number,
  name: `F${number}`,
  kind,
  capacity,
  has_director_office: office,
  agents: Array.from({ length: agents }, (_, i) => ({ id: number * 100 + i, deskIndex: i, roleKey: `r${number}${i}`, title: "T", atDesk: true, carParked: true, status: "S", statusColor: "#000" })),
});

const standard = [floor(1, "reception", 0), floor(2, "office", 5, false, 4), floor(3, "office", 5, true, 2)];
const plusOne = [...standard, floor(4, "office", 5)];

let checks = 0;
const check = (name: string, fn: () => void) => {
  fn();
  checks++;
  console.log(`ok  ${name}`);
};

for (const [label, floors, expectedSpots] of [
  ["3 floors", standard, 1 + 10 + 2],
  ["4 floors", plusOne, 1 + 15 + 2],
] as const) {
  const scene = buildScene(floors, () => true);
  const { building, site, routes } = scene;

  check(`${label}: parking spots = Σcapacity + director + 2 guests (${expectedSpots})`, () => {
    assert.equal(site.spots.length, expectedSpots);
    assert.equal(site.spots.filter((s) => s.kind === "guest").length, 2);
    assert.equal(site.spots[0].kind, "director");
  });

  check(`${label}: every desk has its own spot`, () => {
    const used = building.floors.flatMap((f) => Array.from({ length: f.capacity }, (_, i) => site.deskSpot(f.index, i)));
    assert.equal(new Set(used).size, used.length);
    assert.ok(used.every((i) => site.spots[i]?.kind === "desk"));
  });

  const footprint = { x0: building.core.x0, x1: building.width, z0: building.core.z0, z1: building.depth };
  const samples = (line: Vec3[]) =>
    line.slice(1).flatMap((b, i) => {
      const a = line[i];
      return Array.from({ length: 21 }, (_, k) => [a[0] + ((b[0] - a[0]) * k) / 20, a[2] + ((b[2] - a[2]) * k) / 20] as const);
    });
  const all = [...Object.values(routes.arrive), ...routes.toSpot, ...routes.fromSpot, ...Object.values(routes.depart)];

  check(`${label}: no route crosses the building`, () => {
    for (const line of all) for (const [x, z] of samples(line)) assert.ok(!inRect(footprint, x, z, 0.5), `route point ${x},${z} inside building`);
  });

  check(`${label}: routes chain edge → entry → spot → exit → edge`, () => {
    const { main, cross } = site.roads;
    const atEdge = (p: Vec3) => [main.x0, main.x1].includes(p[0]) || [cross.z0, cross.z1].includes(p[2]);
    const same = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[2] - b[2]) < 1e-6;
    const entry = routes.toSpot[0][0];
    const exit = routes.fromSpot[0].at(-1)!;
    for (const e of MAP_EDGES) {
      assert.ok(atEdge(routes.arrive[e][0]), `arrive ${e} starts at a map edge`);
      assert.ok(same(routes.arrive[e].at(-1)!, entry), `arrive ${e} ends at the entry barrier`);
      assert.ok(same(routes.depart[e][0], exit), `depart ${e} starts at the exit barrier`);
      assert.ok(atEdge(routes.depart[e].at(-1)!), `depart ${e} ends at a map edge`);
    }
    site.spots.forEach((s, i) => {
      assert.ok(same(routes.toSpot[i][0], entry));
      assert.ok(same(routes.toSpot[i].at(-1)!, s.center));
      assert.ok(same(routes.fromSpot[i][0], s.center));
      assert.ok(same(routes.fromSpot[i].at(-1)!, exit));
    });
  });

  check(`${label}: route graph is connected edge → spot → edge`, () => {
    const g = routeGraph(routes);
    const next = new Map<number, number[]>();
    for (const [a, b] of g.edges) next.set(a, [...(next.get(a) ?? []), b]);
    const idOf = (p: Vec3) => g.nodes.findIndex((n) => Math.hypot(n[0] - p[0], n[2] - p[2]) < 0.01);
    const reach = (from: number) => {
      const seen = new Set([from]);
      const queue = [from];
      while (queue.length) {
        for (const n of next.get(queue.shift()!) ?? []) {
          if (seen.has(n)) continue;
          seen.add(n);
          queue.push(n);
        }
      }
      return seen;
    };
    for (const e of MAP_EDGES) {
      const reached = reach(idOf(routes.arrive[e][0]));
      for (const s of site.spots) assert.ok(reached.has(idOf(s.center)), `spot ${s.index} reachable from ${e}`);
    }
    for (const s of site.spots) {
      const reached = reach(idOf(s.center));
      for (const e of MAP_EDGES) assert.ok(reached.has(idOf(routes.depart[e].at(-1)!)), `${e} reachable from spot ${s.index}`);
    }
  });

  check(`${label}: reception floor has no desks, office floors have kitchens`, () => {
    assert.equal(building.floors[0].capacity, 0);
    assert.ok(building.kitchenZone.x0 >= building.sideZone.x1);
  });

  check(`${label}: every agent, desk, spot and the director's office is pickable once`, () => {
    const keys = scene.picks.map((p) => p.key);
    assert.equal(new Set(keys).size, keys.length);
    const desks = floors.reduce((n, f) => n + (f.kind === "office" ? f.capacity : 0), 0);
    assert.equal(scene.picks.filter((p) => p.target.kind === "agent" || p.target.kind === "desk").length, desks);
    for (const f of floors) for (const a of f.agents) assert.ok(keys.includes(`agent:${a.id}`), `agent ${a.id} pickable`);
    assert.equal(scene.picks.filter((p) => p.target.kind === "spot").length, site.spots.length);
    const director = scene.picks.filter((p) => p.target.kind === "director");
    assert.equal(director.length, 1);
    assert.equal(director[0].floorNumber, 3);
  });

  check(`${label}: hidden floors are not pickable`, () => {
    const lower = buildScene(floors, (n) => n <= 2);
    assert.ok(lower.picks.every((p) => p.floorNumber === null || p.floorNumber <= 2));
    assert.equal(lower.picks.filter((p) => p.target.kind === "director").length, 0);
    assert.equal(lower.picks.filter((p) => p.target.kind === "spot").length, site.spots.length);
  });

  check(`${label}: pick volumes sit inside their floor storey`, () => {
    for (const p of scene.picks) {
      if (p.floorNumber === null) continue;
      const f = building.floors.find((x) => x.number === p.floorNumber)!;
      const [, y] = p.box.position;
      const h = p.box.size[1];
      assert.ok(y - h / 2 >= f.baseY - 1e-6 && y + h / 2 <= f.baseY + building.pitch, `${p.key} within storey`);
    }
  });
}

check("presence follows the agent status; preview shows everyone", () => {
  const seen = (["off_site", "arriving", "idle", "working", "waiting_review", "leaving"] as const).map((s) => {
    const p = presence(s, false);
    return `${s}:${p.carParked ? "car" : "-"}${p.atDesk ? "+desk" : ""}`;
  });
  assert.deepEqual(seen, ["off_site:-", "arriving:car", "idle:car+desk", "working:car+desk", "waiting_review:car+desk", "leaving:car"]);
  assert.deepEqual(presence("off_site", true), { atDesk: true, carParked: true });
});

check("cars and people follow presence in the scene", () => {
  const f = floor(2, "office", 5, false, 2);
  f.agents[0] = { ...f.agents[0], atDesk: false, carParked: true };
  f.agents[1] = { ...f.agents[1], atDesk: false, carParked: false };
  const scene = buildScene([floor(1, "reception", 0), f], () => true);
  const tags = scene.labels.filter((l) => l.kind === "tag").map((l) => l.key);
  assert.deepEqual(tags, [`car-${f.agents[0].id}`]);
});

check("stage ribbon follows the task lifecycle", () => {
  assert.equal(RIBBON.length, 7);
  assert.deepEqual(ribbonState("queued", null), { current: 0, complete: false, halted: false });
  assert.equal(ribbonState("in_progress", null).current, 1);
  assert.equal(ribbonState("in_progress", "research").current, 2);
  assert.equal(ribbonState("paused", "self_check").current, 4);
  assert.equal(ribbonState("changes_requested", "draft").current, 3);
  assert.equal(ribbonState("needs_review", "self_check").current, 5);
  assert.deepEqual(ribbonState("done", "self_check"), { current: 6, complete: true, halted: false });
  assert.deepEqual(ribbonState("cancelled", null), { current: 0, complete: false, halted: true });
  assert.equal(ribbonState("failed", "draft").current, 3);
});

console.log(`\n${checks} checks passed`);
