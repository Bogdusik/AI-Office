import type { AgentStatus } from "@/lib/api";

/** What the scene shows of an agent: the car on its spot and/or the person at the desk. */
export type Presence = { atDesk: boolean; carParked: boolean };

const BY_STATUS: Record<AgentStatus, Presence> = {
  off_site: { atDesk: false, carParked: false },
  arriving: { atDesk: false, carParked: true },
  idle: { atDesk: true, carParked: true },
  working: { atDesk: true, carParked: true },
  waiting_review: { atDesk: true, carParked: true },
  leaving: { atDesk: false, carParked: true },
};

/**
 * `?preview=1` puts everyone in place without touching the data. `onTrip`: the agent is arriving or leaving
 * and the trip is animated, so the moving car and person are drawn instead of the static ones.
 */
export function presence(status: AgentStatus, preview: boolean, onTrip = false): Presence {
  if (preview) return { atDesk: true, carParked: true };
  return onTrip ? { atDesk: false, carParked: false } : BY_STATUS[status];
}
