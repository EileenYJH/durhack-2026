// Turn-by-turn directions over any building layout, as plain sentences that can
// be read aloud. Pure geometry: it knows where the doors are, not what is
// burning, so rooms on fire are passed in and routed around.

import { ROOMS, DOORS, VEC, doorsOf, exitDoors, innerRoom, isHall, roomCentre, route, outward, wallOf } from './building.js';

const NAME = { N: 'north', S: 'south', E: 'east', W: 'west' };
const V = Object.fromEntries(Object.entries(VEC).map(([k, v]) => [k, { ...v, name: NAME[k] }]));
const ORD = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th'];
const label = (id) => (id === 'OUT' ? 'outside' : ROOMS[id].name);
const noRoute = (from, to) => `There is no route from ${label(from)} to ${label(to)} that avoids the fire.`;

// How a person facing `from` turns to face `to`.
function turn(from, to) {
  if (!from) return null;
  const dot = from.x * to.x + from.y * to.y;
  if (dot > 0) return 'straight';
  if (dot < 0) return 'around';
  return from.x * to.y - from.y * to.x > 0 ? 'right' : 'left';
}

function turnLead(facing, h) {
  const t = turn(facing, h);
  if (!t) return `Head ${h.name}`;
  if (t === 'straight') return `Continue ${h.name}`;
  if (t === 'around') return `Turn around and head ${h.name}`;
  return `Turn ${t} and head ${h.name}`;
}

const heading = (dx, dy) => (Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? V.E : V.W) : dy > 0 ? V.S : V.N);

// The exit that is quickest to reach from `from`, with the doors leading to it.
function pickExit(from, avoid) {
  let best = null;
  for (const e of exitDoors()) {
    const inner = innerRoom(e);
    if (avoid.has(inner) && inner !== from) continue;
    const path = inner === from ? [] : route(from, inner, avoid);
    if (inner !== from && !path.length) continue;
    let pos = from === 'OUT' ? DOORS[e] : roomCentre(from);
    let len = 0;
    for (const d of path) {
      len += Math.hypot(DOORS[d].x - pos.x, DOORS[d].y - pos.y);
      pos = DOORS[d];
    }
    len += Math.hypot(DOORS[e].x - pos.x, DOORS[e].y - pos.y);
    if (!best || len < best.len) best = { door: e, path, len };
  }
  return best;
}

function plan(from, to, avoid) {
  if (to === 'OUT') {
    const ex = pickExit(from, avoid);
    return ex ? [...ex.path, ex.door] : [];
  }
  return route(from, to, avoid);
}

export function directions(from, to, { avoid = new Set() } = {}) {
  if (from === to) return [`You are already in ${label(to)}.`];
  const doors = plan(from, to, avoid);
  if (!doors.length) return [noRoute(from, to)];

  const out = [];
  let room = from;
  let pos = from === 'OUT' ? null : roomCentre(from);
  let facing = null;

  for (const id of doors) {
    const d = DOORS[id];
    const next = d.a === room ? d.b : d.a;

    if (room === 'OUT') {
      const w = wallOf(next, id);
      out.push(`Enter by the ${V[w].name} entrance.`);
      facing = { ...VEC[{ N: 'S', S: 'N', E: 'W', W: 'E' }[w]] };
      pos = { x: d.x, y: d.y };
      room = next;
      continue;
    }

    const w = wallOf(room, id);
    const wallV = V[w];
    const entered = room !== from;
    const dx = d.x - pos.x;
    const dy = d.y - pos.y;

    if (isHall(room)) {
      const hn = ROOMS[room].name.toLowerCase();
      const h = Math.hypot(dx, dy) >= 30 ? heading(dx, dy) : null;
      if (next === 'OUT') {
        out.push(h ? `${turnLead(facing, h)} along the ${hn} to the ${wallV.name} exit.` : `Go through the ${wallV.name} exit.`);
      } else {
        if (h) out.push(`${turnLead(facing, h)} along the ${hn}.`);
        const rel = h ? turn(h, wallV) : null;
        if (rel === 'left' || rel === 'right') {
          const axis = h.x !== 0 ? 'x' : 'y';
          const sign = h.x !== 0 ? h.x : h.y;
          const count = doorsOf(room).filter((k) => wallOf(room, k) === w && (DOORS[k][axis] - pos[axis]) * sign > 0 && (DOORS[k][axis] - d[axis]) * sign <= 0).length;
          out.push(`${label(next)} is the ${ORD[count - 1] ?? `${count}th`} door on your ${rel}.`);
        } else if (rel === 'straight') out.push(`${label(next)} is straight ahead.`);
        else out.push(`${label(next)} is right here, in the ${wallV.name} wall.`);
      }
      if (h) facing = h;
    } else if (!entered) {
      if (next === 'OUT') out.push(`Go through the ${wallV.name} exit.`);
      else if (isHall(next)) out.push(`Leave ${label(room)} by its ${wallV.name} door.`);
      else out.push(`Go through the door in the ${wallV.name} wall into ${label(next)}.`);
    } else if (next === 'OUT') out.push(`Cross ${label(room)} and leave by the ${wallV.name} exit.`);
    else out.push(`Cross ${label(room)} and go through the door in its ${wallV.name} wall into ${label(next)}.`);

    facing = wallV;
    pos = { x: d.x, y: d.y };
    room = next;
  }

  out.push(to === 'OUT' ? 'You are outside, at the assembly point.' : `You are in ${label(to)}.`);
  return out;
}

// Points to draw the route on the plan.
export function routePoints(from, to, { avoid = new Set() } = {}) {
  const doors = plan(from, to, avoid);
  const pts = [roomCentre(from)];
  for (const id of doors) pts.push({ x: DOORS[id].x, y: DOORS[id].y });
  if (to === 'OUT') {
    const last = DOORS[doors.at(-1)];
    const o = outward(doors.at(-1));
    pts.push({ x: last.x + o.x * 70, y: last.y + o.y * 70 });
  } else pts.push(roomCentre(to));
  return pts;
}
