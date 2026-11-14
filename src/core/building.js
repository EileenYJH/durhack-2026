// The building the whole system is working on. The tables below are filled in
// place by setBuilding(), so every module that imported them sees a change.
// The built-in teaching block is used unless the page finds a layout the user
// saved from the editor.

import { DEFAULT_LAYOUT, normalise, validateLayout, snapToBoundary } from './layout.js';

export const ROOMS = {};
export const DOORS = {};
export const ROOM_IDS = [];
export const DOOR_IDS = [];
export const VEC = { N: { x: 0, y: -1 }, S: { x: 0, y: 1 }, E: { x: 1, y: 0 }, W: { x: -1, y: 0 } };

let current = null;

export function setBuilding(layout) {
  const n = normalise(layout);
  for (const k of Object.keys(ROOMS)) delete ROOMS[k];
  for (const k of Object.keys(DOORS)) delete DOORS[k];
  Object.assign(ROOMS, n.rooms);
  Object.assign(DOORS, n.doors);
  ROOM_IDS.length = 0;
  ROOM_IDS.push(...Object.keys(n.rooms));
  DOOR_IDS.length = 0;
  DOOR_IDS.push(...Object.keys(n.doors));
  current = n;
}

export const getBuilding = () => current;

// Browser pages call this first. Returns 'custom' when a saved layout was used.
export function initBuilding() {
  try {
    const raw = globalThis.localStorage?.getItem('rollcall:layout');
    if (raw) {
      const saved = normalise(JSON.parse(raw));
      if (validateLayout(saved).ok) {
        setBuilding(saved);
        return 'custom';
      }
    }
  } catch {
    // a damaged save is ignored and the built-in building is used
  }
  setBuilding(DEFAULT_LAYOUT);
  return 'default';
}

setBuilding(DEFAULT_LAYOUT);

// ---- questions about the layout ------------------------------------------------

export const isHall = (id) => Boolean(ROOMS[id]?.hall);
export const searchRooms = () => ROOM_IDS.filter((id) => !ROOMS[id].hall);
export const exitDoors = () => DOOR_IDS.filter((d) => DOORS[d].a === 'OUT' || DOORS[d].b === 'OUT');
export const doorsOf = (roomId) => DOOR_IDS.filter((d) => DOORS[d].a === roomId || DOORS[d].b === roomId);
export const otherSide = (doorId, roomId) => (DOORS[doorId].a === roomId ? DOORS[doorId].b : DOORS[doorId].a);
export const innerRoom = (doorId) => (DOORS[doorId].a === 'OUT' ? DOORS[doorId].b : DOORS[doorId].a);

// Which wall of the room the door is in: 'N', 'S', 'E' or 'W'.
export const wallOf = (roomId, doorId) => snapToBoundary(DOORS[doorId], ROOMS[roomId]).k;

// Direction pointing away from the building at an exit.
export const outward = (doorId) => VEC[wallOf(innerRoom(doorId), doorId)];

// Where people gather after leaving by this exit: a point outside it, set to
// one side so it does not sit in front of the door, plus its two directions.
export function assemblyOf(doorId) {
  const out = outward(doorId);
  let perp = { x: out.y, y: -out.x };
  if (perp.y < 0 || (perp.y === 0 && perp.x < 0)) perp = { x: -perp.x, y: -perp.y };
  const d = DOORS[doorId];
  return { x: d.x + out.x * 110 + perp.x * 84, y: d.y + out.y * 110 + perp.y * 84, out, perp };
}

export function bounds() {
  const rs = Object.values(ROOMS);
  return {
    minX: Math.min(...rs.map((r) => r.x)),
    maxX: Math.max(...rs.map((r) => r.x + r.w)),
    minY: Math.min(...rs.map((r) => r.y)),
    maxY: Math.max(...rs.map((r) => r.y + r.h)),
  };
}

export function roomCentre(roomId) {
  if (roomId === 'OUT') {
    const e = exitDoors()[0];
    const o = outward(e);
    return { x: DOORS[e].x + o.x * 60, y: DOORS[e].y + o.y * 60 };
  }
  const r = ROOMS[roomId];
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

// Shortest door-to-door route between rooms, as a list of door ids.
// `avoid` is a set of rooms the route must not pass through (a room on fire).
export function route(from, to, avoid = new Set()) {
  if (from === to) return [];
  const prev = { [from]: null };
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift();
    for (const d of doorsOf(cur)) {
      const nxt = otherSide(d, cur);
      if (nxt in prev) continue;
      if (avoid.has(nxt) && nxt !== to) continue;
      prev[nxt] = { room: cur, door: d };
      if (nxt === to) {
        const path = [];
        let at = to;
        while (prev[at]) {
          path.unshift(prev[at].door);
          at = prev[at].room;
        }
        return path;
      }
      queue.push(nxt);
    }
  }
  return [];
}

export function routeLength(fromPos, fromRoom, toRoom) {
  let pos = fromPos;
  let len = 0;
  for (const d of route(fromRoom, toRoom)) {
    const p = DOORS[d];
    len += Math.hypot(p.x - pos.x, p.y - pos.y);
    pos = p;
  }
  const c = roomCentre(toRoom);
  return len + Math.hypot(c.x - pos.x, c.y - pos.y);
}
