// Belief: what a node concludes about each room from the records it holds.
// A pure function of (records, local clock), so two nodes holding the same
// records always agree.
//
// The rules are deliberately lopsided. Wrongly saying "empty" can cost a life;
// wrongly saying "occupied" costs a search. So:
//   - a sighting never turns into "empty" by getting old, only into "possibly";
//   - "empty" needs a recent sensor reading AND agreeing, recent door counters;
//   - silence is never treated as evidence that nobody is there.

import { DOORS, ROOMS, ROOM_IDS, doorsOf } from './building.js';

export const PARAMS = {
  FRESH: 6, // seconds a reading counts as current
  STALE: 22, // seconds after which a reading is no longer trusted
};

export const STATES = ['still', 'occupied', 'possible', 'unknown', 'empty'];

export const STATE_LABEL = {
  still: 'Occupied, still',
  occupied: 'Occupied',
  possible: 'Possibly occupied',
  unknown: 'Unknown',
  empty: 'Confirmed empty',
};

function who(writer) {
  if (writer.startsWith('room-')) return `${ROOMS[writer.slice(5)]?.name ?? writer} sensor`;
  if (/^R\d+$/.test(writer)) return `Responder ${writer.slice(1)}`;
  return writer;
}

function doorView(rep, roomId, now) {
  let net = 0;
  let known = true;
  let oldest = 0;
  for (const id of doorsOf(roomId)) {
    const rec = rep.doors[id];
    if (!rec) {
      known = false;
      continue;
    }
    const d = DOORS[id];
    net += d.b === roomId ? rec.ab - rec.ba : rec.ba - rec.ab;
    oldest = Math.max(oldest, now - rec.at);
  }
  return { known, count: Math.max(0, net), drift: net < 0, age: oldest };
}

function decay(age, P) {
  if (age <= P.FRESH) return 1;
  if (age >= P.STALE) return 0;
  return 1 - (age - P.FRESH) / (P.STALE - P.FRESH);
}

export function roomBelief(rep, roomId, now, P = PARAMS) {
  const doors = doorView(rep, roomId, now);
  let sight = null;
  let clear = null;
  let searched = null; // most recent walk-through by a responder that found nobody
  for (const rec of Object.values(rep.reports)) {
    if (rec.room !== roomId) continue;
    const age = now - rec.at;
    if (rec.state === 'empty') {
      if (rec.kind === 'search' && (!searched || age < searched.age)) searched = { ...rec, age };
      if (!clear || age < clear.age) clear = { ...rec, age };
    } else if (!sight || age < sight.age) {
      sight = { ...rec, age };
    }
  }

  const doorsFresh = doors.known && doors.age < P.STALE;
  const base = { room: roomId, doorCount: doors.known ? doors.count : null, doorsAge: doors.known ? doors.age : null };

  // The most recent word on this room is a sighting.
  if (sight && (!clear || sight.age <= clear.age)) {
    const count = Math.max(sight.count ?? 1, doorsFresh ? doors.count : 0);
    if (sight.age < P.FRESH) {
      return {
        ...base,
        state: sight.state === 'still' ? 'still' : 'occupied',
        count,
        age: sight.age,
        conf: Math.round(100 * (sight.conf ?? 0.9)),
        why: `${who(sight.writer)} sees ${sight.state === 'still' ? 'someone not moving' : 'movement'}`,
      };
    }
    return {
      ...base,
      state: 'possible',
      count,
      age: sight.age,
      lastSeen: sight.state,
      conf: Math.round(100 * Math.max(0.25, 0.8 * decay(sight.age, P))),
      why: `Last sighting ${Math.round(sight.age)} s ago, nothing newer`,
    };
  }

  // The most recent word is "nobody here".
  if (clear) {
    // A responder who walked the room is stronger evidence than a sensor, and
    // overrides door counters that have drifted. It still decays.
    if (searched && (!sight || searched.age < sight.age)) {
      const held = decay(searched.age / 3, P);
      if (held > 0) {
        return {
          ...base,
          state: 'empty',
          count: 0,
          age: searched.age,
          conf: Math.round(100 * (searched.conf ?? 0.95) * held),
          why: `Searched by ${who(searched.writer)} ${Math.round(searched.age)} s ago`,
        };
      }
    }
    if (doorsFresh && doors.count > 0) {
      return {
        ...base,
        state: 'possible',
        count: doors.count,
        age: clear.age,
        conf: 50,
        why: `Doors count ${doors.count} inside, ${who(clear.writer)} sees none`,
      };
    }
    const trust = decay(clear.age, P);
    if (trust === 0) {
      return { ...base, state: 'unknown', count: null, age: clear.age, conf: 0, why: `Last reading ${Math.round(clear.age)} s old` };
    }
    if (!doorsFresh) {
      return { ...base, state: 'unknown', count: null, age: clear.age, conf: 0, why: 'Sensor sees none, door counters silent' };
    }
    return {
      ...base,
      state: 'empty',
      count: 0,
      age: clear.age,
      conf: Math.round(100 * (clear.conf ?? 0.9) * trust * decay(doors.age, P)),
      why: `${who(clear.writer)} and doors agree`,
    };
  }

  // No report from inside the room at all.
  if (doorsFresh && doors.count > 0) {
    return { ...base, state: 'possible', count: doors.count, age: doors.age, conf: 40, why: `Doors count ${doors.count} inside, no sensor report` };
  }
  return { ...base, state: 'unknown', count: null, age: null, conf: 0, why: 'No reading from this room' };
}

export function buildingBelief(rep, now, P = PARAMS) {
  const out = {};
  for (const id of ROOM_IDS) out[id] = roomBelief(rep, id, now, P);
  return out;
}

// People believed to be inside, as a range: definite sightings to worst case.
export function headcount(belief) {
  let low = 0;
  let high = 0;
  let unknown = 0;
  for (const b of Object.values(belief)) {
    if (b.state === 'still' || b.state === 'occupied') {
      low += b.count;
      high += b.count;
    } else if (b.state === 'possible') {
      high += b.count;
    } else if (b.state === 'unknown') {
      unknown += 1;
    }
  }
  return { low, high, unknown };
}
