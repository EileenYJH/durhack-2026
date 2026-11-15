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
  STALE: 22, // seconds after which a sighting's confidence has fully decayed
  EMPTY_FRESH: 2,
  EMPTY_STALE: 6, // "nobody here" is trusted for far less time than a sighting
  HOLD: 8, // an "empty" reading must outlast the last sighting by this long
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

// Net crossings into a room by its door counters, or null if a door is unheard.
export function doorNet(rep, roomId) {
  let net = 0;
  for (const id of doorsOf(roomId)) {
    const rec = rep.doors[id];
    if (!rec) return null;
    net += DOORS[id].b === roomId ? rec.ab - rec.ba : rec.ba - rec.ab;
  }
  return net;
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
  // A responder who counted heads in the room recorded how far the counters
  // had drifted. Counters only ever grow, so that offset stays valid.
  let fix = null;
  for (const rec of Object.values(rep.reports)) {
    if (rec.room === roomId && rec.kind === 'search' && typeof rec.drift === 'number' && (!fix || rec.at > fix.at)) fix = rec;
  }
  if (fix) net -= fix.drift;
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
  const E = { FRESH: P.EMPTY_FRESH, STALE: P.EMPTY_STALE }; // horizon for "nobody here"
  // How long ago anyone last walked this room, whatever they found.
  let attended = null;
  for (const rec of Object.values(rep.reports)) {
    if (rec.room === roomId && rec.kind === 'search' && (attended === null || now - rec.at < attended)) attended = now - rec.at;
  }
  const base = { room: roomId, doorCount: doors.known ? doors.count : null, doorsAge: doors.known ? doors.age : null, attended };

  // The most recent word on this room is a sighting.
  // A sensor that misses a motionless person for a moment must not clear the
  // room, so "empty" only becomes the latest word once it has outlasted the
  // last sighting by HOLD seconds. A responder's walk-through needs no hold.
  const held = (c) => c.kind === 'search' || sight.age - c.age >= P.HOLD;
  if (sight && (!clear || !held(clear))) {
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
      // A cleared room stays cleared for as long as its door counters are still
      // being heard and show that nobody has gone in since. Without that
      // evidence the search is trusted only briefly.
      const sealed = doors.known && doors.age < P.EMPTY_STALE * 2 && doors.count === 0;
      const trustSearch = sealed ? decay(searched.age / 20, E) : decay(searched.age / 3, E);
      if (trustSearch > 0) {
        return {
          ...base,
          state: 'empty',
          count: 0,
          age: searched.age,
          conf: Math.round(100 * (searched.conf ?? 0.95) * trustSearch),
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
    const trust = decay(clear.age, E);
    if (trust === 0) {
      return { ...base, state: 'unknown', count: null, age: clear.age, conf: 0, why: `Last reading ${Math.round(clear.age)} s old` };
    }
    if (!doors.known || doors.age >= P.EMPTY_STALE) {
      return { ...base, state: 'unknown', count: null, age: clear.age, conf: 0, why: 'Sensor sees none, door counters silent' };
    }
    return {
      ...base,
      state: 'empty',
      count: 0,
      age: clear.age,
      conf: Math.round(100 * (clear.conf ?? 0.9) * trust * decay(doors.age, E)),
      why: clear.age > P.EMPTY_FRESH ? `${who(clear.writer)} saw nobody ${Math.round(clear.age)} s ago; nothing newer` : `${who(clear.writer)} and doors agree`,
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
