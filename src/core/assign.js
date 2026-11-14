// Which room should each responder search next?
//
// There is no dispatcher. Every responder runs this same function over its own
// belief and the last positions it has heard for the others, then acts on its
// own row. Responders holding the same records therefore choose different
// rooms without exchanging a word. If their records differ they may overlap;
// claims are replicated, so that settles when they next hear each other.

import { ROOM_IDS, ROOMS, routeLength } from './building.js';

const URGENCY = { still: 100, occupied: 80, possible: 55, unknown: 30, empty: 0 };

// A heuristic for ordering searches. It is not an estimate of survival.
export function priority(b) {
  return URGENCY[b.state] ?? 0;
}

export function rankRooms(belief) {
  return ROOM_IDS.filter((id) => !ROOMS[id].hall && priority(belief[id]) > 0)
    .map((id) => ({ room: id, score: priority(belief[id]), state: belief[id].state, why: belief[id].why }))
    .sort((a, b) => b.score - a.score || a.room.localeCompare(b.room));
}

// responders: [{ id, room, x, y }] with last known positions.
export function assign(belief, responders) {
  const taken = new Set();
  const out = {};
  const ordered = [...responders].sort((a, b) => a.id.localeCompare(b.id));
  for (const r of ordered) {
    let best = null;
    for (const id of ROOM_IDS) {
      if (ROOMS[id].hall || taken.has(id)) continue;
      const p = priority(belief[id]);
      if (p <= 0) continue;
      const dist = routeLength({ x: r.x, y: r.y }, r.room, id);
      const score = p - dist / 40;
      if (!best || score > best.score || (score === best.score && id < best.room)) best = { room: id, score };
    }
    out[r.id] = best ? best.room : null;
    if (best) taken.add(best.room);
  }
  return out;
}
