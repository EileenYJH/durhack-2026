// One node's copy of the shared state.
//
// Every record has exactly one writer and a sequence number that only that
// writer increases, so "keep the higher sequence" is a safe merge: it gives the
// same result whatever order messages arrive in, and however often they repeat.
//
// Clocks are never compared between nodes. A record travels with its age and
// the receiver converts that into its own clock (`at`).

export function createReplica(id) {
  return {
    id,
    doors: {}, // doorId -> { seq, at, ab, ba }
    reports: {}, // `${room}|${writer}` -> { seq, at, room, writer, state, count, conf, kind }
    claims: {}, // responderId -> { seq, at, target, room, x, y }
  };
}

const KINDS = ['doors', 'reports', 'claims'];

export function writeDoor(rep, doorId, ab, ba, now) {
  const prev = rep.doors[doorId];
  rep.doors[doorId] = { seq: (prev?.seq ?? 0) + 1, at: now, ab, ba };
}

export function writeReport(rep, room, writer, fields, now) {
  const key = `${room}|${writer}`;
  const prev = rep.reports[key];
  rep.reports[key] = { seq: (prev?.seq ?? 0) + 1, at: now, room, writer, ...fields };
}

export function writeClaim(rep, responderId, fields, now) {
  const prev = rep.claims[responderId];
  rep.claims[responderId] = { seq: (prev?.seq ?? 0) + 1, at: now, ...fields };
}

// What a node sends to a neighbour: every record, with age in place of time.
export function snapshot(rep, now) {
  const out = { from: rep.id };
  for (const kind of KINDS) {
    out[kind] = {};
    for (const [key, rec] of Object.entries(rep[kind])) {
      const { at, ...rest } = rec;
      out[kind][key] = { ...rest, age: now - at };
    }
  }
  return out;
}

// Merge a received snapshot. `transit` is how long the message was in flight.
// Returns the number of records that were news to this node.
export function merge(rep, snap, now, transit = 0) {
  let news = 0;
  for (const kind of KINDS) {
    for (const [key, incoming] of Object.entries(snap[kind] ?? {})) {
      const local = rep[kind][key];
      if (local && local.seq >= incoming.seq) continue;
      const { age, ...rest } = incoming;
      rep[kind][key] = { ...rest, at: now - age - transit };
      news += 1;
    }
  }
  return news;
}

// A stable fingerprint of what a node knows, ignoring local timestamps.
export function fingerprint(rep) {
  const parts = [];
  for (const kind of KINDS) {
    for (const key of Object.keys(rep[kind]).sort()) parts.push(`${kind}:${key}:${rep[kind][key].seq}`);
  }
  return parts.join(',');
}
