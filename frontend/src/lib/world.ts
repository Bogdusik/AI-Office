import type { AgentState, FloorState, WorldState } from "@/lib/api";
import type { Selection } from "@/scene/layout";

export type LocatedAgent = { agent: AgentState; floor: FloorState };

export function allAgents(world: WorldState | null): LocatedAgent[] {
  return (world?.floors ?? []).flatMap((floor) => floor.agents.map((agent) => ({ agent, floor })));
}

export function findAgent(world: WorldState | null, id: number): LocatedAgent | null {
  return allAgents(world).find((a) => a.agent.id === id) ?? null;
}

export const directorFloor = (world: WorldState | null): FloorState | null =>
  world?.floors.find((f) => f.has_director_office) ?? null;

/** Floor number to show when flying to a selection; parking spots live outside the building. */
export function floorOf(world: WorldState | null, s: Selection): number | null {
  switch (s.kind) {
    case "agent":
      return findAgent(world, s.id)?.floor.number ?? null;
    case "desk":
      return world?.floors.find((f) => f.id === s.floorId)?.number ?? null;
    case "director":
      return directorFloor(world)?.number ?? null;
    case "spot":
      return null;
  }
}
