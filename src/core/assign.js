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

const PEOPLE = new Set(['still', 'occupied', 'possible']);

// Priority once heat is taken into account. People believed to be in a room
// that is heating up come first. A burning room with nobody known inside is
// not searched at all: risk nothing to save nothing.
export const ATTENDED = 25; // seconds a room counts as dealt with after a firefighter has been in it

export function urgency(b, hazard) {
  // A teammate has just been in there and is bringing out whoever they found.
  if (b.attended !== null && b.attended !== undefined && b.attended < ATTENDED) return 0;
  const p = priority(b);
  if (!hazard || p <= 0) return p;
  const people = PEOPLE.has(b.state);
  if (hazard.level === 'fire') return people ? p + 30 : 0;
  if (hazard.level === 'hot') return people ? p + 20 : p;
  return p;
}

// responders: [{ id, room, x, y }] with last known positions.
// hazards: per-room heat belief. blocked: doors believed impassable.
// skip: rooms this responder has just been turned back from.
export function assign(belief, responders, { hazards = {}, blocked = new Set(), skip = new Set() } = {}) {
  const avoid = new Set(Object.keys(hazards).filter((id) => hazards[id].level === 'fire'));
  const taken = new Set();
  const out = {};
  const ordered = [...responders].sort((a, b) => a.id.localeCompare(b.id));
  for (const r of ordered) {
    let best = null;
    for (const id of ROOM_IDS) {
      if (ROOMS[id].hall || taken.has(id) || skip.has(id)) continue;
      const p = urgency(belief[id], hazards[id]);
      if (p <= 0) continue;
      const dist = routeLength({ x: r.x, y: r.y }, r.room, id, avoid, blocked);
      if (!Number.isFinite(dist)) continue; // no way in that avoids the fire
      const score = p - dist / 40;
      if (!best || score > best.score || (score === best.score && id < best.room)) best = { room: id, score };
    }
    out[r.id] = best ? best.room : null;
    if (best) taken.add(best.room);
  }
  return out;
}
