import type { AgentStatus } from "@/lib/api";

/** What the scene shows of an agent: the car on its spot and/or the person at the desk. */
/** `drawn` false: the agent is at work (monitors on) but office life draws the person, not the static scene. */
export type Presence = { atDesk: boolean; carParked: boolean; drawn?: boolean };

const BY_STATUS: Record<AgentStatus, Presence> = {
  off_site: { atDesk: false, carParked: false },
  arriving: { atDesk: false, carParked: true },
  idle: { atDesk: true, carParked: true },
  working: { atDesk: true, carParked: true },
  waiting_review: { atDesk: true, carParked: true },
  leaving: { atDesk: false, carParked: true },
  returning: { atDesk: false, carParked: true },
};

/**
 * `?preview=1` puts everyone in place without touching the data. `onTrip`: the agent is arriving, leaving or
 * returning and the trip is animated, so the moving car and person are drawn instead of the static ones.
 */
export function presence(status: AgentStatus, preview: boolean, onTrip = false, inLife = false): Presence {
  if (preview) return { atDesk: true, carParked: true };
  if (onTrip) return { atDesk: false, carParked: false };
  return inLife && BY_STATUS[status].atDesk ? { ...BY_STATUS[status], drawn: false } : BY_STATUS[status];
}
