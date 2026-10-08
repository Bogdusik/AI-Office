/**
 * Sanity checks for the pure scene layout (no test runner):
 *   node --experimental-strip-types --no-warnings --import ./scripts/register-ts.mjs scripts/check-layout.mts
 */
import assert from "node:assert/strict";
import { RIBBON, ribbonState } from "@/lib/stages";
import { PALETTE } from "@/scene/palette";
import {
  MAP_EDGES,
  type Rect,
  type Vec3,
  WALK,
  buildScene,
  findPath,
  floorObstacles,
  greenery,
  inRect,
  type Plan,
  type TripInput,
  liftHeights,
  outdoorObstacles,
  planTrips,
  presence,
  relevantTrips,
  sample,
  samplePeople,
  tripWorld,
  windowOpen,
  routeGraph,
  routes as carRoutes,
  segmentClear,
  walkGraph,
} from "@/scene/layout";

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

const standard = [
  floor(1, "reception", 0),
  { ...floor(2, "office", 5, false, 4), has_kitchen: true },
  { ...floor(3, "office", 5, true, 2), has_server_room: true },
];
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

  const walk = walkGraph(building, site);

  check(`${label}: from the entrance a person reaches every desk, the kitchen, lounge, server room and director's office`, () => {
    const targets = building.floors.flatMap((f) => {
      if (f.kind === "reception") return [];
      const ids = Array.from({ length: f.capacity }, (_, d) => WALK.seat(f.index, d));
      if (f.hasKitchen) ids.push(WALK.kitchen(f.index));
      if (f.hasServerRoom) ids.push(WALK.serverDoor(f.index));
      ids.push(f.hasDirectorOffice ? WALK.director(f.index) : WALK.lounge(f.index));
      return ids;
    });
    assert.ok(targets.length > 10);
    for (const id of targets) assert.ok(findPath(walk, WALK.outsideDoor, id), `${id} reachable from the entrance`);
    for (const s of site.spots) assert.ok(findPath(walk, WALK.carSide(s.index), WALK.reader), `reader reachable from spot ${s.index}`);
    for (const f of building.floors) {
      assert.ok(walk.nodes.has(WALK.lift(f.index)), `lift stop on floor ${f.number}`);
      assert.ok(findPath(walk, WALK.lift(0), WALK.lift(f.index)), `stairs reach floor ${f.number}`);
    }
  });

  check(`${label}: walking paths keep clear of walls, glass rooms, partitions and furniture`, () => {
    const plants = greenery(building, site, scene.entrance).map((g): Rect => ({ x0: g.position[0] - 0.6 * g.scale, x1: g.position[0] + 0.6 * g.scale, z0: g.position[2] - 0.6 * g.scale, z1: g.position[2] + 0.6 * g.scale }));
    plants.push(...greenery(building, site, scene.entrance).filter((g) => g.kind === "flowerbed").map((g): Rect => ({ x0: g.position[0] - 1.5, x1: g.position[0] + 1.5, z0: g.position[2] - 0.7, z1: g.position[2] + 0.7 })));
    const [rx, , rz] = scene.entrance.reader;
    const outside = outdoorObstacles(building, site, [...plants, { x0: rx - 0.08, x1: rx + 0.08, z0: rz - 0.08, z1: rz + 0.08 }]);
    const byFloor = building.floors.map((f) => floorObstacles(building, f));
    let tested = 0;
    for (const e of walk.edges) {
      const a = walk.nodes.get(e.a)!;
      const c = walk.nodes.get(e.b)!;
      const floorIndex = a.floor ?? c.floor;
      const rects = a.floor === null && c.floor === null ? outside : floorIndex === null ? outside : byFloor[floorIndex];
      const hit = segmentClear(a.p, c.p, rects);
      assert.equal(hit, null, `${e.a} → ${e.b} hits ${JSON.stringify(hit)}`);
      tested++;
    }
    assert.ok(tested > 50);
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

/* ---------- trips ---------- */

{
  const scene = buildScene(standard, () => true);
  const { building, site } = scene;
  const world = tripWorld(building, site, carRoutes(site), walkGraph(building, site));
  const D = { arrive: 75, depart: 75 };
  const desks: [number, number][] = [[1, 0], [1, 1], [1, 2], [1, 3], [2, 0], [2, 1]];
  const trips = (kind: "arrive" | "depart", start = 1000, gap = 0.4): TripInput[] =>
    desks.map(([f, d], i) => ({ agentId: i + 1, kind, start: start + i * gap, floorIndex: f, deskIndex: d, spot: site.deskSpot(f, d) }));
  const ys = liftHeights(building);
  const last = (segs: Plan["car"]) => segs.filter((x) => Number.isFinite(x.t1)).at(-1)!.t1;

  /** Do two cars (1.8 × 4 m, slightly shrunk) overlap? Separating axis test in plan view. */
  const carsOverlap = (a: { pos: Vec3; yaw: number }, b: { pos: Vec3; yaw: number }) => {
    const box = (c: { pos: Vec3; yaw: number }) => {
      const [hx, hz] = [0.85, 1.9];
      const [s, k] = [Math.sin(c.yaw), Math.cos(c.yaw)];
      const ax: [number, number] = [k, -s];
      const az: [number, number] = [s, k];
      return { c: [c.pos[0], c.pos[2]] as [number, number], axes: [ax, az], h: [hx, hz] };
    };
    const [p, q] = [box(a), box(b)];
    for (const axis of [...p.axes, ...q.axes]) {
      const proj = (o: typeof p) => o.axes.reduce((n, ax, i) => n + Math.abs(ax[0] * axis[0] + ax[1] * axis[1]) * o.h[i], 0);
      const d = Math.abs((p.c[0] - q.c[0]) * axis[0] + (p.c[1] - q.c[1]) * axis[1]);
      if (d > proj(p) + proj(q)) return false;
    }
    return true;
  };

  for (const kind of ["arrive", "depart"] as const) {
    const schedule = planTrips(trips(kind), D, world);
    const { plans, props } = schedule;
    const t0 = 1000;

    check(`trips (${kind}): six at once, each lasts exactly its duration`, () => {
      for (const p of plans) {
        const end = kind === "arrive" ? last(p.person) : last(p.car);
        assert.ok(Math.abs(end - (p.trip.start + D[kind])) < 1e-6, `trip ${p.trip.agentId} ends at ${end - p.trip.start}`);
        // Six leaving at once queue for the aisle and the exit barrier; a car that got out early drives off slower.
        const [lo, hi] = kind === "arrive" ? [0.75, 1.5] : [0.4, 6];
        assert.ok(p.squeeze > lo && p.squeeze < hi, `trip ${p.trip.agentId} final stretch squeeze ${p.squeeze}`);
      }
    });

    check(`trips (${kind}): cars never overlap, people keep apart, at most ${4} in the lift`, () => {
      for (let t = t0; t < t0 + D[kind] + 2; t += 0.1) {
        const cars = plans.map((p) => sample(p.car, t)).filter((c) => c.visible);
        for (let i = 0; i < cars.length; i++) for (let j = i + 1; j < cars.length; j++) assert.ok(!carsOverlap(cars[i], cars[j]), `cars overlap at +${(t - t0).toFixed(1)} s`);
        const people = samplePeople(plans, t, { runs: props.lift, ys }).filter((x) => x.visible);
        for (let i = 0; i < people.length; i++)
          for (let j = i + 1; j < people.length; j++) {
            const [a, b] = [people[i].pos, people[j].pos];
            const apart = Math.hypot(a[0] - b[0], a[2] - b[2]) >= 0.45 || Math.abs(a[1] - b[1]) > 1;
            assert.ok(apart, `people ${i}/${j} overlap at +${(t - t0).toFixed(1)} s at ${a.map((v) => v.toFixed(1))}`);
          }
        assert.ok(people.filter((x) => x.riding).length <= 4);
      }
      assert.ok(props.lift.every((r) => r.riders <= 4));
    });

    check(`trips (${kind}): barriers are up while a car passes, doors open while a person walks through`, () => {
      const gate = kind === "arrive" ? props.entry : props.exit;
      const laneX = kind === "arrive" ? site.entryLaneX : site.exitLaneX;
      for (const p of plans) {
        let crossed = false;
        for (let t = t0; t < t0 + D[kind]; t += 0.05) {
          const c = sample(p.car, t);
          if (c.visible && Math.abs(c.pos[0] - laneX) < 1.5 && Math.abs(c.pos[2] - site.barrierZ) < 0.3) {
            crossed = true;
            assert.ok(windowOpen(gate, t, 0.9) > 0.95, `barrier down under car ${p.trip.agentId}`);
          }
          const person = sample(p.person, t, { runs: props.lift, ys });
          if (person.visible && Math.abs(person.pos[0] - building.width / 2) < 1.2 && Math.abs(person.pos[2] - building.depth) < 0.15) assert.ok(windowOpen(props.door, t, 0.7) > 0.9, `door shut on ${p.trip.agentId}`);
        }
        assert.ok(crossed, `car ${p.trip.agentId} passes its barrier`);
      }
    });

    check(`trips (${kind}): a new trip never changes earlier ones; planning is deterministic`, () => {
      const all = trips(kind);
      const later: TripInput = { ...all[0], agentId: 99, start: t0 + 3, floorIndex: 2, deskIndex: 2, spot: site.deskSpot(2, 2) };
      const without = planTrips(all, D, world);
      const withLater = planTrips([...all, later], D, world);
      assert.deepEqual(withLater.plans.slice(0, all.length), without.plans);
      assert.deepEqual(planTrips(all, D, world), without);
    });
  }

  check("trips: finished trips drop out only when nothing in progress queued behind them", () => {
    const old = trips("arrive", 0, 0.4);
    const recent = trips("depart", 500, 0.4);
    assert.deepEqual(relevantTrips([...old, ...recent], D, 520), recent);
    const overlapping: TripInput = { ...old[0], agentId: 50, start: 60 };
    assert.equal(relevantTrips([...old, overlapping], D, 100).length, old.length + 1);
    const alone = planTrips(recent, D, world).plans;
    assert.deepEqual(planTrips(relevantTrips([...old, ...recent], D, 520), D, world).plans, alone);
  });
}

check("presence follows the agent status; preview shows everyone", () => {
  const seen = (["off_site", "arriving", "idle", "working", "waiting_review", "leaving"] as const).map((s) => {
    const p = presence(s, false);
    return `${s}:${p.carParked ? "car" : "-"}${p.atDesk ? "+desk" : ""}`;
  });
  assert.deepEqual(seen, ["off_site:-", "arriving:car", "idle:car+desk", "working:car+desk", "waiting_review:car+desk", "leaving:car"]);
  assert.deepEqual(presence("off_site", true), { atDesk: true, carParked: true });
  assert.deepEqual(presence("arriving", false, true), { atDesk: false, carParked: false }, "an animated trip draws the car and person itself");
  assert.deepEqual(presence("leaving", false, true), { atDesk: false, carParked: false });
});

check("cars and people follow presence in the scene", () => {
  const f = floor(2, "office", 5, false, 2);
  f.agents[0] = { ...f.agents[0], atDesk: false, carParked: true };
  f.agents[1] = { ...f.agents[1], atDesk: false, carParked: false };
  const scene = buildScene([floor(1, "reception", 0), f], () => true);
  const tags = scene.labels.filter((l) => l.kind === "tag").map((l) => l.key);
  assert.deepEqual(tags, [`car-${f.agents[0].id}`]);
});

check("one server room on its floor, one kitchen with a partition, racks light up when the model is busy", () => {
  const idle = buildScene(standard, () => true);
  const busy = buildScene(standard, () => true, { serverBusy: true });
  const servers = idle.picks.filter((p) => p.target.kind === "server");
  assert.equal(servers.length, 1);
  assert.equal(servers[0].floorNumber, 3);
  assert.deepEqual(idle.walls.filter((w) => w.key.startsWith("partition-")).map((w) => w.key), ["partition-2"]);
  assert.equal(idle.walls.filter((w) => w.key.startsWith("server-")).length, 3);
  const leds = (scene: typeof idle, color: string) => scene.parts.filter((p) => p.finish === "screen" && p.color === color).length;
  assert.ok(leds(idle, PALETTE.ledIdle) >= 20 && leds(idle, PALETTE.ledBusy) === 0);
  assert.ok(leds(busy, PALETTE.ledBusy) >= 20 && leds(busy, PALETTE.ledIdle) === 0);
  const fridges = idle.parts.filter((p) => p.color === PALETTE.appliance && p.scale.join() === "0.75,1.9,0.7").length;
  assert.equal(fridges, 1, "a single kitchen in the building");
  const b = idle.building;
  const room = servers[0].box;
  assert.ok(room.position[0] - room.size[0] / 2 >= b.kitchenZone.x0 && room.position[0] + room.size[0] / 2 <= b.kitchenZone.x1, "server room inside the kitchen zone");
  assert.equal(buildScene(standard, (n) => n <= 2).picks.filter((p) => p.target.kind === "server").length, 0);
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
