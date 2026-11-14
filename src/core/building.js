// Static description of the floor. Coordinates are in drawing units (viewBox).
// OUT is "outside the building" and is treated as a room with no sensor.

export const ROOMS = {
  A: { name: 'Lab 1', x: 60, y: 40, w: 280, h: 210 },
  B: { name: 'Lab 2', x: 340, y: 40, w: 280, h: 210 },
  C: { name: 'Seminar', x: 620, y: 40, w: 320, h: 210 },
  D: { name: 'Workshop', x: 60, y: 350, w: 340, h: 210 },
  E: { name: 'Store', x: 400, y: 350, w: 300, h: 210 },
  F: { name: 'Office', x: 700, y: 350, w: 240, h: 210 },
  COR: { name: 'Corridor', x: 60, y: 250, w: 880, h: 100 },
};

// A door joins rooms a and b. Counters record crossings a->b (ab) and b->a (ba).
export const DOORS = {
  dA: { a: 'COR', b: 'A', x: 200, y: 250 },
  dB: { a: 'COR', b: 'B', x: 480, y: 250 },
  dC: { a: 'COR', b: 'C', x: 780, y: 250 },
  dD: { a: 'COR', b: 'D', x: 230, y: 350 },
  dE: { a: 'COR', b: 'E', x: 550, y: 350 },
  dF: { a: 'COR', b: 'F', x: 820, y: 350 },
  dAB: { a: 'A', b: 'B', x: 340, y: 145 },
  dW: { a: 'OUT', b: 'COR', x: 60, y: 300 },
  dX: { a: 'OUT', b: 'COR', x: 940, y: 300 },
};

export const ROOM_IDS = Object.keys(ROOMS);
export const DOOR_IDS = Object.keys(DOORS);

export function doorsOf(roomId) {
  return DOOR_IDS.filter((d) => DOORS[d].a === roomId || DOORS[d].b === roomId);
}

export function otherSide(doorId, roomId) {
  const d = DOORS[doorId];
  return d.a === roomId ? d.b : d.a;
}

export function roomCentre(roomId) {
  if (roomId === 'OUT') return { x: 0, y: 300 };
  const r = ROOMS[roomId];
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

// Shortest door-to-door route between rooms, as a list of door ids.
export function route(from, to) {
  if (from === to) return [];
  const prev = { [from]: null };
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift();
    const candidates = cur === 'OUT' ? ['dW', 'dX'] : doorsOf(cur);
    for (const d of candidates) {
      const nxt = otherSide(d, cur);
      if (nxt in prev) continue;
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
