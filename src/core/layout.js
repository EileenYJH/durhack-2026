// A building layout: rectangular rooms and the doors between them.
//
//   rooms: { id: { name, x, y, w, h, hall? } }     hall = corridor or lobby people
//                                                  pass through, not searched
//   doors: { id: { a, b, x, y } }                  b may be 'OUT' for an exit;
//                                                  exits are stored as a:'OUT'
//   scenario (optional): { people, fire, down, cutX } defaults for the simulation
//
// Coordinates are drawing units. This file is pure geometry and checking, so
// the editor, the photo import and the tests can all use it.

export const DEFAULT_LAYOUT = {
  name: 'Teaching block, ground floor',
  rooms: {
    A: { name: 'Lab 1', x: 60, y: 40, w: 280, h: 210 },
    B: { name: 'Lab 2', x: 340, y: 40, w: 280, h: 210 },
    C: { name: 'Seminar', x: 620, y: 40, w: 320, h: 210 },
    D: { name: 'Workshop', x: 60, y: 350, w: 340, h: 210 },
    E: { name: 'Store', x: 400, y: 350, w: 300, h: 210 },
    F: { name: 'Office', x: 700, y: 350, w: 240, h: 210 },
    COR: { name: 'Corridor', x: 60, y: 250, w: 880, h: 100, hall: true },
  },
  doors: {
    dA: { a: 'COR', b: 'A', x: 200, y: 250 },
    dB: { a: 'COR', b: 'B', x: 480, y: 250 },
    dC: { a: 'COR', b: 'C', x: 780, y: 250 },
    dD: { a: 'COR', b: 'D', x: 230, y: 350 },
    dE: { a: 'COR', b: 'E', x: 550, y: 350 },
    dF: { a: 'COR', b: 'F', x: 820, y: 350 },
    dAB: { a: 'A', b: 'B', x: 340, y: 145 },
    dW: { a: 'OUT', b: 'COR', x: 60, y: 300 },
    dX: { a: 'OUT', b: 'COR', x: 940, y: 300 },
  },
  scenario: { people: { A: 3, B: 2, C: 3, D: 2, E: 1, F: 2 }, fire: 'C', down: ['C', 'E'], cutX: 660 },
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function distToRect(p, r) {
  const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.w));
  const dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.h));
  return Math.hypot(dx, dy);
}

// Nearest point on the rectangle's outline, and which wall it is on.
export function snapToBoundary(p, r) {
  const cx = clamp(p.x, r.x, r.x + r.w);
  const cy = clamp(p.y, r.y, r.y + r.h);
  const walls = [
    { k: 'N', dist: Math.abs(p.y - r.y), x: cx, y: r.y },
    { k: 'S', dist: Math.abs(p.y - (r.y + r.h)), x: cx, y: r.y + r.h },
    { k: 'W', dist: Math.abs(p.x - r.x), x: r.x, y: cy },
    { k: 'E', dist: Math.abs(p.x - (r.x + r.w)), x: r.x + r.w, y: cy },
  ];
  return walls.reduce((best, w) => (w.dist < best.dist ? w : best));
}

// Accepts rooms and doors as objects keyed by id or as arrays of { id, ... }
// (the shape the photo import returns) and gives back the object form.
export function fromRaw(raw) {
  const list = (v) => (Array.isArray(v) ? v : Object.entries(v ?? {}).map(([id, item]) => ({ id, ...item })));
  const rooms = {};
  const doors = {};
  list(raw.rooms).forEach((r, i) => {
    const id = String(r.id ?? `R${i + 1}`);
    rooms[id] = { name: String(r.name ?? id), x: Number(r.x), y: Number(r.y), w: Number(r.w), h: Number(r.h), ...(r.hall ? { hall: true } : {}) };
  });
  list(raw.doors).forEach((d, i) => {
    const id = String(d.id ?? `d${i + 1}`);
    doors[id] = { a: String(d.a), b: String(d.b), x: Number(d.x), y: Number(d.y) };
  });
  return { name: String(raw.name ?? 'Imported building'), rooms, doors, ...(raw.scenario ? { scenario: raw.scenario } : {}) };
}

// A clean copy: whole numbers, exits stored as a:'OUT', doors snapped onto the
// walls they belong to. Run before validating or using a layout.
export function normalise(layout) {
  const out = fromRaw(layout);
  for (const r of Object.values(out.rooms)) for (const k of ['x', 'y', 'w', 'h']) r[k] = Math.round(r[k]);
  for (const d of Object.values(out.doors)) {
    if (d.b === 'OUT' && d.a !== 'OUT') [d.a, d.b] = [d.b, d.a];
    const p = { x: d.x, y: d.y };
    const ra = out.rooms[d.a];
    const rb = out.rooms[d.b];
    let snapped = null;
    if (d.a === 'OUT' && rb) snapped = snapToBoundary(p, rb);
    else if (d.b === 'OUT' && ra) snapped = snapToBoundary(p, ra);
    else if (ra && rb) {
      const sa = snapToBoundary(p, ra);
      const sb = snapToBoundary(p, rb);
      snapped = distToRect(sa, rb) <= distToRect(sb, ra) ? sa : sb;
    }
    if (snapped) {
      d.x = Math.round(snapped.x);
      d.y = Math.round(snapped.y);
    } else {
      d.x = Math.round(d.x);
      d.y = Math.round(d.y);
    }
  }
  if (layout.scenario) out.scenario = layout.scenario;
  return out;
}

// Returns { ok, errors, warnings }. Errors stop a layout being used.
// A room needs space for its label; a corridor only needs to be wide enough
// for a door on its long side.
export const minSize = (r) => (r.hall ? 24 : 40);

export function validateLayout(layout) {
  const errors = [];
  const warnings = [];
  const rooms = layout.rooms ?? {};
  const doors = layout.doors ?? {};
  const ids = Object.keys(rooms);

  if (ids.length < 2) errors.push('Add at least two rooms.');
  for (const id of ids) {
    const r = rooms[id];
    if (id === 'OUT') errors.push('A room cannot be called OUT.');
    if (![r.x, r.y, r.w, r.h].every(Number.isFinite)) errors.push(`${r.name || id} has no usable size.`);
    else if (Math.min(r.w, r.h) < minSize(r)) errors.push(`${r.name || id} is too small to draw (under ${minSize(r)} units).`);
    if (!String(r.name ?? '').trim()) errors.push(`Room ${id} needs a name.`);
  }
  const names = new Map();
  for (const id of ids) {
    const n = String(rooms[id].name).trim().toLowerCase();
    if (names.has(n)) warnings.push(`Two rooms are called "${rooms[id].name}". Spoken directions will be ambiguous.`);
    names.set(n, id);
  }
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const p = rooms[ids[i]];
      const q = rooms[ids[j]];
      const ox = Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x);
      const oy = Math.min(p.y + p.h, q.y + q.h) - Math.max(p.y, q.y);
      if (ox > 4 && oy > 4) warnings.push(`${p.name} and ${q.name} overlap.`);
    }
  }

  const adjacent = new Map(ids.concat('OUT').map((id) => [id, []]));
  let exits = 0;
  for (const [id, d] of Object.entries(doors)) {
    const known = (x) => x === 'OUT' || x in rooms;
    if (!known(d.a) || !known(d.b)) {
      errors.push(`Door ${id} joins a room that does not exist.`);
      continue;
    }
    if (d.a === d.b) {
      errors.push(`Door ${id} joins a room to itself.`);
      continue;
    }
    if (![d.x, d.y].every(Number.isFinite)) {
      errors.push(`Door ${id} has no position.`);
      continue;
    }
    if (d.a !== 'OUT' && d.b !== 'OUT' && (distToRect(d, rooms[d.a]) > 14 || distToRect(d, rooms[d.b]) > 14)) {
      errors.push(`Door ${id} does not sit on a wall shared by ${rooms[d.a].name} and ${rooms[d.b].name}.`);
    }
    if (d.a === 'OUT' || d.b === 'OUT') exits += 1;
    adjacent.get(d.a).push(d.b);
    adjacent.get(d.b).push(d.a);
  }
  if (!exits) errors.push('Add at least one exit (a door on an outer wall).');

  const seen = new Set(['OUT']);
  const queue = ['OUT'];
  while (queue.length) for (const n of adjacent.get(queue.shift()) ?? []) if (!seen.has(n)) (seen.add(n), queue.push(n));
  for (const id of ids) if (!seen.has(id)) errors.push(`${rooms[id].name} cannot be reached from outside. Add a door to it.`);
  if (ids.length && ids.every((id) => rooms[id].hall)) warnings.push('Every room is marked as a corridor, so there is nothing to search.');

  return { ok: errors.length === 0, errors, warnings };
}
