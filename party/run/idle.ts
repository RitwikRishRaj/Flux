// Deleting a room once nobody has been in it for ROOM_IDLE_MINUTES (default 2). The alarm is set when the last person
// leaves (and on every load, as a safety net) and cancelled when someone connects; this decides what it does when it fires.
export const DEFAULT_IDLE_MINUTES = 2;

// ROOM_IDLE_MINUTES from the Worker's vars: a positive number (fractions allowed, e.g. 0.1 for testing), else 2.
export const parseIdleMinutes = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_IDLE_MINUTES;
};

export type IdleAction = "keep" | "later" | "delete";

// keep: someone is here, or there is nothing stored to delete (also ends the alarm's retry after a delete).
// later: nobody is here but a run is still finishing; look again after another idle period.
export const idleAction = (room: { connections: number; running: boolean; hasData: boolean }): IdleAction =>
  room.connections > 0 || !room.hasData ? "keep" : room.running ? "later" : "delete";
