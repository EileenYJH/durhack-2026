// Follows people across camera frames and reports when one crosses the
// doorway line. Pure logic, no camera or model in here, so it can be tested.
//
// Positions are normalised: x and y run 0 to 1 across the frame. The line is
// vertical at x = 0.5. Crossing left to right counts as +1, right to left -1.
// A person must clear a margin either side of the line, so someone standing
// on it and swaying is not counted over and over.

export function createTracker({ margin = 0.06, reach = 0.22, forget = 1.2, stillWindow = 2.5, stillMove = 0.05 } = {}) {
  let nextId = 1;
  let tracks = [];

  function side(x) {
    if (x < 0.5 - margin) return -1;
    if (x > 0.5 + margin) return 1;
    return 0;
  }

  // detections: [{ x, y }], t: seconds. Returns { crossings: [+1|-1,...], tracks }.
  function update(detections, t) {
    const crossings = [];
    const free = new Set(detections.map((_, i) => i));

    // Match each track to its nearest unclaimed detection, closest pairs first.
    const pairs = [];
    tracks.forEach((tr, ti) => {
      detections.forEach((d, di) => {
        const dist = Math.hypot(d.x - tr.x, d.y - tr.y);
        if (dist <= reach) pairs.push({ ti, di, dist });
      });
    });
    pairs.sort((a, b) => a.dist - b.dist);
    const used = new Set();
    for (const { ti, di } of pairs) {
      if (used.has(ti) || !free.has(di)) continue;
      used.add(ti);
      free.delete(di);
      const tr = tracks[ti];
      const d = detections[di];
      tr.x = d.x;
      tr.y = d.y;
      tr.seen = t;
      tr.trail.push({ x: d.x, y: d.y, t });
      while (tr.trail.length && t - tr.trail[0].t > stillWindow) tr.trail.shift();
      const now = side(d.x);
      if (now !== 0 && tr.side !== 0 && now !== tr.side) crossings.push(now);
      if (now !== 0) tr.side = now;
    }

    for (const di of free) {
      const d = detections[di];
      tracks.push({ id: nextId++, x: d.x, y: d.y, seen: t, born: t, side: side(d.x), trail: [{ x: d.x, y: d.y, t }] });
    }
    tracks = tracks.filter((tr) => t - tr.seen <= forget);

    return {
      crossings,
      tracks: tracks.map((tr) => {
        const xs = tr.trail.map((p) => p.x);
        const ys = tr.trail.map((p) => p.y);
        const moved = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
        return { id: tr.id, x: tr.x, y: tr.y, moving: moved > stillMove || t - tr.born < 1 };
      }),
    };
  }

  return { update };
}
