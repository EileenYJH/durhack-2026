// Turns what Gemini reads off a floor plan photo into a usable layout.
//
// Gemini gives rooms as boxes in its own 0-1000 grid ([ymin, xmin, ymax, xmax])
// and doors as a point plus the two rooms they join. Its boxes are close but
// rarely exact: neighbouring rooms leave small gaps, doors miss the wall, and
// exits get forgotten. repairLayout() fixes what can be fixed with geometry
// and reports everything it changed, so the person checking it knows where
// to look.

import { normalise } from './layout.js';

// Drawing area used by the editor and the plan views.
export const CANVAS = { x: 60, y: 40, w: 880, h: 520 };

// How the photo maps onto the drawing area (also used to draw it underneath).
export function photoFrame(imgW, imgH) {
  const s = Math.min(CANVAS.w / imgW, CANVAS.h / imgH);
  return { x: CANVAS.x, y: CANVAS.y, w: imgW * s, h: imgH * s, s };
}

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : NaN);

// Gemini's boxes and points (0-1000 of the whole photo) to drawing units.
export function fromBoxes(raw, imgW = 1000, imgH = 1000) {
  const f = photoFrame(imgW, imgH);
  const X = (xn) => f.x + (num(xn) / 1000) * f.w;
  const Y = (yn) => f.y + (num(yn) / 1000) * f.h;
  const rooms = {};
  const doors = {};
  (raw.rooms ?? []).forEach((r, i) => {
    const id = String(r.id ?? `R${i + 1}`);
    if (Array.isArray(r.box_2d) && r.box_2d.length === 4) {
      const [y1, x1, y2, x2] = r.box_2d.map(num);
      rooms[id] = { name: String(r.name ?? id), x: X(Math.min(x1, x2)), y: Y(Math.min(y1, y2)), w: Math.abs(X(x2) - X(x1)), h: Math.abs(Y(y2) - Y(y1)), ...(r.hall ? { hall: true } : {}) };
    } else {
      rooms[id] = { name: String(r.name ?? id), x: num(r.x), y: num(r.y), w: num(r.w), h: num(r.h), ...(r.hall ? { hall: true } : {}) };
    }
  });
  (raw.doors ?? []).forEach((d, i) => {
    const id = String(d.id ?? `d${i + 1}`);
    const p = Array.isArray(d.point) ? { x: X(d.point[1]), y: Y(d.point[0]) } : { x: num(d.x), y: num(d.y) };
    doors[id] = { a: String(d.a), b: String(d.b), ...p };
  });
  return { name: String(raw.name || 'Imported building'), rooms, doors };
}

// The stretch of wall two rooms share, or null.
export function sharedWall(a, b, tol = 2, min = 24) {
  const ox1 = Math.max(a.x, b.x);
  const ox2 = Math.min(a.x + a.w, b.x + b.w);
  const oy1 = Math.max(a.y, b.y);
  const oy2 = Math.min(a.y + a.h, b.y + b.h);
  if (oy2 - oy1 >= min) {
    if (Math.abs(a.x + a.w - b.x) <= tol) return { x1: b.x, y1: oy1, x2: b.x, y2: oy2 };
    if (Math.abs(b.x + b.w - a.x) <= tol) return { x1: a.x, y1: oy1, x2: a.x, y2: oy2 };
  }
  if (ox2 - ox1 >= min) {
    if (Math.abs(a.y + a.h - b.y) <= tol) return { x1: ox1, y1: b.y, x2: ox2, y2: b.y };
    if (Math.abs(b.y + b.h - a.y) <= tol) return { x1: ox1, y1: a.y, x2: ox2, y2: a.y };
  }
  return null;
}

const overlaps = (a, b) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 4 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 4;

// Nearest point to p on a wall segment, kept away from the corners.
function onSegment(seg, p, margin = 14) {
  const len = Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1);
  const mid = { x: (seg.x1 + seg.x2) / 2, y: (seg.y1 + seg.y2) / 2 };
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || len < margin * 2) return mid;
  const t = ((p.x - seg.x1) * (seg.x2 - seg.x1) + (p.y - seg.y1) * (seg.y2 - seg.y1)) / (len * len);
  const k = Math.min(1 - margin / len, Math.max(margin / len, t));
  return { x: seg.x1 + k * (seg.x2 - seg.x1), y: seg.y1 + k * (seg.y2 - seg.y1) };
}

// The edges of a room, as segments, with which side they face.
const edges = (r) => [
  { side: 'N', x1: r.x, y1: r.y, x2: r.x + r.w, y2: r.y },
  { side: 'S', x1: r.x, y1: r.y + r.h, x2: r.x + r.w, y2: r.y + r.h },
  { side: 'W', x1: r.x, y1: r.y, x2: r.x, y2: r.y + r.h },
  { side: 'E', x1: r.x + r.w, y1: r.y, x2: r.x + r.w, y2: r.y + r.h },
];

// Line up edge values that are within `tol` of each other.
function alignValues(values, tol) {
  const sorted = [...new Set(values)].sort((a, b) => a - b);
  const map = new Map();
  let group = [];
  const flush = () => {
    if (!group.length) return;
    const mean = Math.round(group.reduce((s, v) => s + v, 0) / group.length);
    for (const v of group) map.set(v, mean);
    group = [];
  };
  for (const v of sorted) {
    if (group.length && v - group[group.length - 1] > tol) flush();
    group.push(v);
  }
  flush();
  return map;
}

export function repairLayout(input, { snap = 14 } = {}) {
  const l = { name: input.name, rooms: {}, doors: {} };
  const notes = [];
  for (const [id, r] of Object.entries(input.rooms ?? {})) {
    if (![r.x, r.y, r.w, r.h].every(Number.isFinite) || r.w <= 0 || r.h <= 0) {
      notes.push(`Left out "${r.name}": no usable size.`);
      continue;
    }
    l.rooms[id] = { ...r };
  }
  const R = l.rooms;
  const name = (id) => (id === 'OUT' ? 'outside' : R[id]?.name ?? id);

  // 1. Walls that nearly meet are made to meet.
  const xs = alignValues(Object.values(R).flatMap((r) => [r.x, r.x + r.w]), snap);
  const ys = alignValues(Object.values(R).flatMap((r) => [r.y, r.y + r.h]), snap);
  for (const r of Object.values(R)) {
    const x1 = xs.get(r.x);
    const x2 = xs.get(r.x + r.w);
    const y1 = ys.get(r.y);
    const y2 = ys.get(r.y + r.h);
    if (x2 - x1 >= 20) [r.x, r.w] = [x1, x2 - x1];
    if (y2 - y1 >= 20) [r.y, r.h] = [y1, y2 - y1];
  }
  // Rooms too small to draw are grown to the minimum around their centre.
  for (const r of Object.values(R)) {
    if (r.w < 40 || r.h < 40) {
      notes.push(`Enlarged "${r.name}" to the smallest drawable size.`);
      if (r.w < 40) [r.x, r.w] = [Math.round(r.x + r.w / 2 - 20), 40];
      if (r.h < 40) [r.y, r.h] = [Math.round(r.y + r.h / 2 - 20), 40];
    }
  }

  // 2. Each door is put on the wall it belongs to, or dropped.
  // When Gemini says two spaces connect but a strip of wall or a small
  // unlisted room sits between them, stretch one of them to close the gap,
  // unless that would push it into another room.
  let bridged = 0;
  const bridge = (a, b, maxGap = 90) => {
    const A = R[a];
    const B = R[b];
    if (sharedWall(A, B) || overlaps(A, B)) return true;
    const ox = Math.min(A.x + A.w, B.x + B.w) - Math.max(A.x, B.x);
    const oy = Math.min(A.y + A.h, B.y + B.h) - Math.max(A.y, B.y);
    let axis = null;
    if (ox >= 24) axis = 'y';
    else if (oy >= 24) axis = 'x';
    if (!axis) return false;
    const [lo, hi] = axis === 'y' ? (A.y < B.y ? [A, B] : [B, A]) : A.x < B.x ? [A, B] : [B, A];
    const gap = axis === 'y' ? hi.y - (lo.y + lo.h) : hi.x - (lo.x + lo.w);
    if (gap <= 0 || gap > maxGap) return false;
    const order = [A, B].sort((p, q) => Number(Boolean(p.hall)) - Number(Boolean(q.hall)) || p.w * p.h - q.w * q.h);
    for (const mover of order) {
      const before = { ...mover };
      if (axis === 'y') {
        if (mover === lo) mover.h += gap;
        else [mover.y, mover.h] = [mover.y - gap, mover.h + gap];
      } else if (mover === lo) mover.w += gap;
      else [mover.x, mover.w] = [mover.x - gap, mover.w + gap];
      if (!Object.values(R).some((r) => r !== mover && overlaps(r, mover))) {
        bridged += 1;
        return true;
      }
      Object.assign(mover, before);
    }
    return false;
  };
  for (const d of Object.values(input.doors ?? {})) {
    if (d.a in R && d.b in R && d.a !== d.b) bridge(d.a, d.b);
  }

  const doorOn = (a, b, hint) => {
    if (a === 'OUT' || b === 'OUT') {
      const inner = R[a === 'OUT' ? b : a];
      const outer = outerEdges(inner, R);
      const pool = outer.length ? outer : edges(inner);
      const best = pool.reduce((m, e) => (dist(hint, e) < dist(hint, m) ? e : m), pool[0]);
      return onSegment(best, hint);
    }
    const wall = sharedWall(R[a], R[b]);
    if (wall) return onSegment(wall, hint);
    if (overlaps(R[a], R[b])) {
      // One room drawn over another (often a corridor): use the smaller room's
      // edge that lies inside the bigger one.
      const [small, big] = R[a].w * R[a].h <= R[b].w * R[b].h ? [R[a], R[b]] : [R[b], R[a]];
      const inside = edges(small).filter((e) => midInside(e, big));
      if (inside.length) return onSegment(inside.reduce((m, e) => (dist(hint, e) < dist(hint, m) ? e : m), inside[0]), hint);
    }
    return null;
  };
  let exits = 0;
  for (const [id, d0] of Object.entries(input.doors ?? {})) {
    const d = { ...d0 };
    if (d.b === 'OUT' && d.a !== 'OUT') [d.a, d.b] = [d.b, d.a];
    const known = (x) => x === 'OUT' || x in R;
    if (!known(d.a) || !known(d.b) || d.a === d.b) {
      notes.push(`Dropped a door that named a room that is not on the plan.`);
      continue;
    }
    const p = doorOn(d.a, d.b, d);
    if (!p) {
      notes.push(`Dropped the door between ${name(d.a)} and ${name(d.b)}: they do not touch on the plan.`);
      continue;
    }
    l.doors[id] = { a: d.a, b: d.b, x: Math.round(p.x), y: Math.round(p.y) };
    if (d.a === 'OUT') exits += 1;
  }
  if (bridged) notes.push(`Closed the gap between ${bridged} pair${bridged === 1 ? '' : 's'} of spaces that the plan shows as connected, so their doors sit on a shared wall.`);
  let n = 1;
  const newDoorId = () => {
    while (l.doors[`fix${n}`]) n += 1;
    return `fix${n}`;
  };

  // 3. A building needs a way out.
  if (!exits && Object.keys(R).length) {
    const candidates = Object.entries(R).filter(([, r]) => r.hall);
    const pool = (candidates.length ? candidates : Object.entries(R)).flatMap(([id, r]) => outerEdges(r, R).map((e) => ({ id, e, len: Math.hypot(e.x2 - e.x1, e.y2 - e.y1) })));
    if (pool.length) {
      const best = pool.reduce((m, c) => (c.len > m.len ? c : m));
      const p = onSegment(best.e);
      l.doors[newDoorId()] = { a: 'OUT', b: best.id, x: Math.round(p.x), y: Math.round(p.y) };
      notes.push(`No exit was found, so one was added on the outer wall of ${name(best.id)}. Move it to the real entrance.`);
    }
  }

  let corridors = 0;
  const addCorridor = (id, reach) => {
    const room = R[id];
    const targets = Object.keys(R)
      .filter((o) => reach.has(o) && o !== id)
      .sort((p, q) => Number(Boolean(R[q].hall)) - Number(Boolean(R[p].hall)) || gapBetween(room, R[p]) - gapBetween(room, R[q]));
    for (const t of targets) {
      const T = R[t];
      let rect = null;
      const y1 = Math.max(room.y, T.y);
      const y2 = Math.min(room.y + room.h, T.y + T.h);
      const x1 = Math.max(room.x, T.x);
      const x2 = Math.min(room.x + room.w, T.x + T.w);
      if (y2 - y1 >= 40) {
        const band = Math.min(70, y2 - y1);
        const cy = (y1 + y2) / 2 - band / 2;
        if (T.x + T.w <= room.x) rect = { x: T.x + T.w, y: cy, w: room.x - (T.x + T.w), h: band };
        else if (room.x + room.w <= T.x) rect = { x: room.x + room.w, y: cy, w: T.x - (room.x + room.w), h: band };
      } else if (x2 - x1 >= 40) {
        const band = Math.min(70, x2 - x1);
        const cx = (x1 + x2) / 2 - band / 2;
        if (T.y + T.h <= room.y) rect = { x: cx, y: T.y + T.h, w: band, h: room.y - (T.y + T.h) };
        else if (room.y + room.h <= T.y) rect = { x: cx, y: room.y + room.h, w: band, h: T.y - (room.y + room.h) };
      }
      if (!rect || rect.w < 40 || rect.h < 40 || rect.w > 500 || rect.h > 500) continue;
      if (Object.values(R).some((r) => overlaps(r, rect))) continue;
      corridors += 1;
      let k = corridors;
      while (R[`C${k}`]) k += 1;
      const cid = `C${k}`;
      R[cid] = { name: `Added corridor ${corridors}`, ...Object.fromEntries(Object.entries(rect).map(([key, v]) => [key, Math.round(v)])), hall: true };
      const p1 = onSegment(sharedWall(T, R[cid]));
      const p2 = onSegment(sharedWall(R[cid], room));
      l.doors[newDoorId()] = { a: t, b: cid, x: Math.round(p1.x), y: Math.round(p1.y) };
      l.doors[newDoorId()] = { a: cid, b: id, x: Math.round(p2.x), y: Math.round(p2.y) };
      notes.push(`Added "Added corridor ${corridors}" from ${name(t)} to ${name(id)} across clear floor: the plan's corridor there was not picked up. Check it.`);
      return true;
    }
    return false;
  };

  // 4. Every room must be reachable: add a door to a reachable neighbour.
  for (let pass = 0; pass < Object.keys(R).length; pass++) {
    const reach = reachable(l);
    const stranded = Object.keys(R).filter((id) => !reach.has(id));
    if (!stranded.length) break;
    let added = false;
    for (const id of stranded) {
      // Nothing touches it: try stretching it to meet the nearest reachable corridor.
      const halls = Object.keys(R)
        .filter((o) => reach.has(o) && R[o].hall)
        .sort((p, q) => gapBetween(R[id], R[p]) - gapBetween(R[id], R[q]));
      let joined = false;
      for (const h of halls) if (!sharedWall(R[id], R[h]) && !overlaps(R[id], R[h]) && bridge(id, h)) { joined = true; break; }
      // Still nothing: a corridor Gemini did not report probably runs through
      // the clear floor between this room and a reachable space.
      if (!joined && !Object.keys(R).some((o) => reach.has(o) && (sharedWall(R[id], R[o]) || overlaps(R[id], R[o]))) && addCorridor(id, reach)) {
        added = true;
        continue;
      }
      const options = Object.keys(R)
        .filter((o) => reach.has(o) && o !== id)
        .map((o) => ({ o, wall: sharedWall(R[id], R[o]), over: overlaps(R[id], R[o]) }))
        .filter((c) => c.wall || c.over)
        .sort((p, q) => Number(Boolean(R[q.o].hall)) - Number(Boolean(R[p.o].hall)) || Number(Boolean(q.wall)) - Number(Boolean(p.wall)));
      if (!options.length) continue;
      const p = doorOn(id, options[0].o);
      if (!p) continue;
      l.doors[newDoorId()] = { a: options[0].o, b: id, x: Math.round(p.x), y: Math.round(p.y) };
      notes.push(`Added a door from ${name(options[0].o)} to ${name(id)}, which had no way in. Check where it really is.`);
      added = true;
    }
    if (!added) {
      for (const id of stranded) notes.push(`${name(id)} could not be connected automatically. Add its door in the editor.`);
      break;
    }
  }

  return { layout: normalise(l), notes };
}

function gapBetween(a, b) {
  const dx = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w));
  const dy = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h));
  return Math.hypot(dx, dy);
}

function dist(p, e) {
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return 0;
  const mx = Math.max(Math.min(p.x, Math.max(e.x1, e.x2)), Math.min(e.x1, e.x2));
  const my = Math.max(Math.min(p.y, Math.max(e.y1, e.y2)), Math.min(e.y1, e.y2));
  return Math.hypot(p.x - mx, p.y - my);
}

function midInside(e, r) {
  const mx = (e.x1 + e.x2) / 2;
  const my = (e.y1 + e.y2) / 2;
  return mx > r.x + 2 && mx < r.x + r.w - 2 && my > r.y + 2 && my < r.y + r.h - 2;
}

// Edges of a room that face outside: no other room sits against their middle.
function outerEdges(room, rooms) {
  return edges(room).filter((e) => {
    const mx = (e.x1 + e.x2) / 2;
    const my = (e.y1 + e.y2) / 2;
    const step = 6;
    const probe = { N: [mx, my - step], S: [mx, my + step], W: [mx - step, my], E: [mx + step, my] }[e.side];
    return !Object.values(rooms).some((r) => r !== room && probe[0] > r.x && probe[0] < r.x + r.w && probe[1] > r.y && probe[1] < r.y + r.h);
  });
}

function reachable(l) {
  const seen = new Set(['OUT']);
  const queue = ['OUT'];
  while (queue.length) {
    const cur = queue.shift();
    for (const d of Object.values(l.doors)) {
      const next = d.a === cur ? d.b : d.b === cur ? d.a : null;
      if (next && !seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}
