// Turn-by-turn directions over the building plan, as plain sentences that can
// be read aloud. Pure geometry: it knows where the doors are, not what is
// burning, so rooms on fire are passed in and routed around.

import { ROOMS, DOORS, roomCentre, route } from './building.js';

const V = { N: { x: 0, y: -1, name: 'north' }, S: { x: 0, y: 1, name: 'south' }, E: { x: 1, y: 0, name: 'east' }, W: { x: -1, y: 0, name: 'west' } };
const ORD = ['1st', '2nd', '3rd', '4th', '5th', '6th'];
const name = (id) => (id === 'OUT' ? 'outside' : ROOMS[id].name);

// Which wall of `room` the door sits in.
function wall(room, doorId) {
  const r = ROOMS[room];
  const d = DOORS[doorId];
  if (d.y === r.y) return 'N';
  if (d.y === r.y + r.h) return 'S';
  if (d.x === r.x) return 'W';
  return 'E';
}

// How `heading` turns into `to`, seen by the person walking.
function turn(from, to) {
  if (!from) return null;
  const dot = from.x * to.x + from.y * to.y;
  if (dot > 0) return 'straight';
  if (dot < 0) return 'around';
  return from.x * to.y - from.y * to.x > 0 ? 'right' : 'left';
}

export function directions(from, to, { avoid = new Set() } = {}) {
  if (from === to) return [`You are already in ${name(to)}.`];
  const exit = to === 'OUT' && from !== 'OUT';
  const doors = route(from, exit ? 'COR' : to, avoid);
  if (!doors.length && from !== (exit ? 'COR' : to)) return [`There is no route from ${name(from)} to ${name(to)} that avoids the fire.`];

  const out = [];
  let room = from;
  let pos = from === 'COR' ? { x: 500, y: 300 } : roomCentre(from);
  let facing = null;
  const queue = [...doors];

  if (exit) queue.push('EXIT');

  for (const id of queue) {
    if (id === 'EXIT') {
      // Choose the nearer end of the corridor.
      const west = Math.abs(pos.x - DOORS.dW.x) <= Math.abs(pos.x - DOORS.dX.x);
      const h = west ? V.W : V.E;
      const t = turn(facing, h);
      const lead = !t ? `Head ${h.name}` : t === 'straight' ? `Continue ${h.name}` : t === 'around' ? `Turn around and head ${h.name}` : `Turn ${t} and head ${h.name}`;
      out.push(`${lead} along the corridor to the ${h.name} exit.`);
      room = 'OUT';
      continue;
    }
    const d = DOORS[id];
    const next = d.a === room ? d.b : d.a;

    if (room === 'OUT') {
      const west = id === 'dW';
      out.push(`Enter by the ${west ? 'west' : 'east'} entrance.`);
      facing = west ? V.E : V.W;
    } else if (room === 'COR') {
      const dx = d.x - pos.x;
      let h = null;
      if (Math.abs(dx) >= 30) {
        h = dx > 0 ? V.E : V.W;
        const t = turn(facing, h);
        out.push(!t ? `Head ${h.name} along the corridor.` : t === 'straight' ? `Continue ${h.name} along the corridor.` : t === 'around' ? `Turn around and head ${h.name} along the corridor.` : `Turn ${t} and head ${h.name} along the corridor.`);
        facing = h;
      }
      const side = V[wall('COR', id)];
      if (next !== 'OUT') {
        const lr = turn(facing ?? side, side) === 'straight' ? null : turn(facing ?? side, side);
        if (h && lr) {
          const ahead = Object.keys(DOORS).filter((k) => wall('COR', k) === wall('COR', id) && DOORS[k].a !== 'OUT' && (dx > 0 ? DOORS[k].x > pos.x && DOORS[k].x <= d.x : DOORS[k].x < pos.x && DOORS[k].x >= d.x)).length;
          out.push(`${name(next)} is the ${ORD[ahead - 1] ?? `${ahead}th`} door on your ${lr}.`);
        } else {
          out.push(`${name(next)} is right here, in the ${side.name} wall.`);
        }
      }
      facing = side;
    } else {
      const w = wall(room, id);
      if (next === 'COR') out.push(`Leave ${name(room)} by its ${V[w].name} door.`);
      else out.push(`Go through the door in the ${V[w].name} wall into ${name(next)}.`);
      facing = V[w];
    }
    pos = { x: d.x, y: d.y };
    room = next;
  }

  out.push(to === 'OUT' ? 'You are outside, at the assembly point.' : `You are in ${name(to)}.`);
  return out;
}

// Points to draw the route on the plan.
export function routePoints(from, to, { avoid = new Set() } = {}) {
  const exit = to === 'OUT' && from !== 'OUT';
  const doors = route(from, exit ? 'COR' : to, avoid);
  const pts = [roomCentre(from)];
  for (const id of doors) pts.push({ x: DOORS[id].x, y: DOORS[id].y });
  if (exit) {
    const last = pts[pts.length - 1];
    const west = Math.abs(last.x - DOORS.dW.x) <= Math.abs(last.x - DOORS.dX.x);
    pts.push({ x: west ? DOORS.dW.x : DOORS.dX.x, y: 300 }, { x: west ? -60 : 1000, y: 300 });
  } else pts.push(roomCentre(to));
  return pts;
}
