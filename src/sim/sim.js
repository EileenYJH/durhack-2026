// The simulated world: people (ground truth), nodes with noisy sensors, and a
// radio network whose links can be cut. Every node owns a separate replica and
// only learns about the others through messages on that network.

import { ROOMS, DOORS, ROOM_IDS, DOOR_IDS, route, routeLength, roomCentre, exitDoors, innerRoom, isHall, searchRooms, outward, assemblyOf, bounds, getBuilding } from '../core/building.js';
import { createReplica, writeDoor, writeReport, writeClaim, snapshot, merge } from '../core/replica.js';
import { buildingBelief } from '../core/belief.js';
import { assign, priority } from '../core/assign.js';

export const RANGE = 265; // radio range in drawing units

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createSim(seed = 7) {
  const rand = rng(seed);
  const sim = {
    t: 0,
    alarm: false,
    cut: false,
    fire: null,
    people: [],
    nodes: [],
    queue: [],
    log: [],
    linkNews: {}, // "a|b" -> time news last crossed that link
  };

  const layout = getBuilding();
  const sc = layout.scenario ?? {};
  const search = searchRooms();
  const known = (id) => id in ROOMS && !ROOMS[id].hall;
  const counts = {};
  if (sc.people) for (const [r, n] of Object.entries(sc.people)) if (known(r)) counts[r] = n;
  if (!Object.keys(counts).length) for (const r of search) counts[r] = 1 + Math.floor(rand() * 3);
  const farFirst = [...search].sort((a, b) => routeLength(roomCentre('OUT'), 'OUT', b) - routeLength(roomCentre('OUT'), 'OUT', a));
  const fireRoom = known(sc.fire) ? sc.fire : farFirst[0];
  const downRooms = (sc.down ?? []).filter(known).length ? sc.down.filter(known) : [fireRoom, farFirst[1] ?? fireRoom];
  const bb = bounds();
  sim.cutX = Number.isFinite(sc.cutX) ? sc.cutX : (bb.minX + bb.maxX) / 2;
  const exit0 = exitDoors()[0];
  const out0 = outward(exit0);
  const asm0 = assemblyOf(exit0);

  const pointIn = (roomId, exitDoor) => {
    if (roomId === 'OUT') {
      const a = assemblyOf(exitDoor ?? exit0);
      const across = 20 + rand() * 110;
      const along = (rand() - 0.5) * 60;
      return { x: a.x + a.perp.x * across + a.out.x * along, y: a.y + a.perp.y * across + a.out.y * along };
    }
    const r = ROOMS[roomId];
    return { x: r.x + 28 + rand() * (r.w - 56), y: r.y + 30 + rand() * (r.h - 60) };
  };
  const say = (text, kind = 'info') => {
    sim.log.unshift({ t: sim.t, text, kind });
    if (sim.log.length > 60) sim.log.pop();
  };

  // ---- people -------------------------------------------------------------
  let pid = 0;
  for (const [room, n] of Object.entries(counts)) {
    for (let i = 0; i < n; i++) {
      sim.people.push({ id: `p${++pid}`, room, ...pointIn(room), path: [], mode: 'wander', speed: 42 + rand() * 16, wait: 2 + rand() * 8 });
    }
  }

  function sendTo(mover, toRoom, exitDoor) {
    const doors = exitDoor ? [...route(mover.room, innerRoom(exitDoor)), exitDoor] : route(mover.room, toRoom);
    let room = mover.room;
    const path = [];
    for (const d of doors) {
      const next = DOORS[d].a === room ? DOORS[d].b : DOORS[d].a;
      path.push({ x: DOORS[d].x, y: DOORS[d].y, door: d, from: room, to: next });
      room = next;
    }
    path.push(pointIn(room, exitDoor));
    mover.path = path;
  }

  function nearestExit(p) {
    return exitDoors().reduce((best, e) => (Math.hypot(p.x - DOORS[e].x, p.y - DOORS[e].y) < Math.hypot(p.x - DOORS[best].x, p.y - DOORS[best].y) ? e : best));
  }

  function advance(mover, dt, onCross) {
    let budget = mover.speed * dt;
    while (budget > 0 && mover.path.length) {
      const wp = mover.path[0];
      const d = Math.hypot(wp.x - mover.x, wp.y - mover.y);
      if (d <= budget) {
        mover.x = wp.x;
        mover.y = wp.y;
        budget -= d;
        mover.path.shift();
        if (wp.door) {
          mover.room = wp.to;
          onCross?.(wp);
        }
      } else {
        mover.x += ((wp.x - mover.x) / d) * budget;
        mover.y += ((wp.y - mover.y) / d) * budget;
        budget = 0;
      }
    }
  }

  // ---- nodes --------------------------------------------------------------
  const addNode = (n) => {
    const node = { alive: true, phase: rand(), next: rand(), ...n, rep: createReplica(n.id) };
    sim.nodes.push(node);
    return node;
  };
  for (const d of DOOR_IDS) addNode({ id: d, kind: 'door', label: `Door ${d.replace(/^d/, '')}`, x: DOORS[d].x, y: DOORS[d].y, ab: 0, ba: 0 });
  for (const r of ROOM_IDS) {
    const c = roomCentre(r);
    addNode({ id: `room-${r}`, kind: 'room', room: r, label: `${ROOMS[r].name} sensor`, x: c.x, y: isHall(r) ? c.y + 30 : c.y - Math.min(70, ROOMS[r].h / 3), emptyStreak: 0 });
  }
  const at = (along, across) => ({ x: DOORS[exit0].x + out0.x * along + asm0.perp.x * across, y: DOORS[exit0].y + out0.y * along + asm0.perp.y * across });
  const home1 = at(40, -55);
  const home2 = at(40, 55);
  addNode({ id: 'POST', kind: 'post', label: 'Command post', ...at(60, 0) });
  addNode({ id: 'R1', kind: 'responder', label: 'Responder 1', room: 'OUT', ...home1, path: [], speed: 70, target: null, searching: 0, home: { ...home1 } });
  addNode({ id: 'R2', kind: 'responder', label: 'Responder 2', room: 'OUT', ...home2, path: [], speed: 70, target: null, searching: 0, home: { ...home2 } });

  const byId = Object.fromEntries(sim.nodes.map((n) => [n.id, n]));
  sim.node = (id) => byId[id];

  // The day starts with people already inside: they came in through the main
  // entrance and their room's door, and the counters recorded it.
  for (const [room, n] of Object.entries(counts)) {
    const path = route('OUT', room);
    for (let k = 0; k < n; k++) {
      let prev = 'OUT';
      for (const d of path) {
        if (DOORS[d].a === prev) byId[d].ab += 1;
        else byId[d].ba += 1;
        prev = DOORS[d].a === prev ? DOORS[d].b : DOORS[d].a;
      }
    }
  }

  // ---- network ------------------------------------------------------------
  sim.linked = (a, b) => {
    if (!a.alive || !b.alive) return false;
    if (Math.hypot(a.x - b.x, a.y - b.y) > RANGE) return false;
    if (sim.cut && (a.x - sim.cutX) * (b.x - sim.cutX) < 0) return false;
    return true;
  };
  sim.links = () => {
    const out = [];
    for (let i = 0; i < sim.nodes.length; i++) {
      for (let j = i + 1; j < sim.nodes.length; j++) {
        const a = sim.nodes[i];
        const b = sim.nodes[j];
        if (sim.linked(a, b)) out.push({ a, b, hot: sim.t - (sim.linkNews[`${a.id}|${b.id}`] ?? -99) < 0.6 });
      }
    }
    return out;
  };

  function gossip(node) {
    const snap = snapshot(node.rep, sim.t);
    for (const other of sim.nodes) {
      if (other === node || !sim.linked(node, other)) continue;
      sim.queue.push({ due: sim.t + 0.1 + rand() * 0.3, sent: sim.t, from: node.id, to: other.id, snap });
    }
  }

  function deliver() {
    const waiting = [];
    for (const m of sim.queue) {
      if (m.due > sim.t) {
        waiting.push(m);
        continue;
      }
      const from = byId[m.from];
      const to = byId[m.to];
      if (!sim.linked(from, to)) continue; // lost: the link dropped in flight
      if (merge(to.rep, m.snap, sim.t, sim.t - m.sent) > 0) {
        const pair = sim.nodes.indexOf(from) < sim.nodes.indexOf(to) ? [from, to] : [to, from];
        sim.linkNews[`${pair[0].id}|${pair[1].id}`] = sim.t;
      }
    }
    sim.queue = waiting;
  }

  // ---- node behaviour, once a second each ---------------------------------
  function doorTick(node) {
    writeDoor(node.rep, node.id, node.ab, node.ba, sim.t);
  }

  function roomTick(node) {
    const inside = sim.people.filter((p) => p.room === node.room);
    let seen = 0;
    let moving = false;
    for (const p of inside) {
      const isMoving = p.path.length > 0;
      if (rand() < (isMoving ? 0.98 : 0.85)) {
        seen += 1;
        moving = moving || isMoving;
      }
    }
    if (seen > 0) {
      node.emptyStreak = 0;
      writeReport(node.rep, node.room, node.id, { state: moving ? 'moving' : 'still', count: seen, conf: 0.9, kind: 'sensor' }, sim.t);
    } else if (++node.emptyStreak >= 3) {
      writeReport(node.rep, node.room, node.id, { state: 'empty', count: 0, conf: 0.9, kind: 'sensor' }, sim.t);
    }
  }

  function responderTick(node) {
    writeClaim(node.rep, node.id, { target: node.target, room: node.room, x: node.x, y: node.y }, sim.t);
    if (!sim.alarm || node.searching > 0) return;
    const belief = buildingBelief(node.rep, sim.t);
    const team = sim.nodes
      .filter((n) => n.kind === 'responder')
      .map((n) => {
        if (n === node) return { id: n.id, room: n.room, x: n.x, y: n.y };
        const c = node.rep.claims[n.id];
        return c ? { id: n.id, room: c.room, x: c.x, y: c.y } : { id: n.id, room: 'OUT', x: n.home.x, y: n.home.y };
      });
    let target = assign(belief, team)[node.id];
    // Keep going to the current room unless it no longer needs a search or
    // something more urgent has come up. Stops responders dithering.
    if (node.target && target && priority(belief[node.target]) > 0 && priority(belief[target]) <= priority(belief[node.target])) {
      target = node.target;
    }
    if (target !== node.target) {
      node.target = target;
      if (target) {
        sendTo(node, target);
        say(`${node.label} heads for ${ROOMS[target].name}. ${belief[target].why}.`, 'act');
      } else {
        const hall = ROOM_IDS.find(isHall);
        if (hall && node.room !== hall) sendTo(node, hall);
      }
    }
  }

  function finishSearch(node) {
    const inside = sim.people.filter((p) => p.room === node.room);
    const down = inside.filter((p) => p.mode === 'down');
    if (inside.length === 0) {
      writeReport(node.rep, node.room, node.id, { state: 'empty', count: 0, conf: 0.98, kind: 'search' }, sim.t);
      say(`${node.label} searched ${ROOMS[node.room].name}: clear`, 'ok');
    } else {
      writeReport(node.rep, node.room, node.id, { state: down.length ? 'still' : 'moving', count: inside.length, conf: 0.98, kind: 'search' }, sim.t);
      say(`${node.label} found ${inside.length} in ${ROOMS[node.room].name}`, 'warn');
      for (const p of down) {
        p.mode = 'assisted';
        p.speed = 30;
        sendTo(p, 'OUT', nearestExit(p));
      }
    }
    node.target = null;
  }

  // ---- step ---------------------------------------------------------------
  sim.step = (dt) => {
    sim.t += dt;

    for (const p of sim.people) {
      if (p.mode === 'down' || p.room === 'OUT') {
        if (p.room === 'OUT') advance(p, dt);
        continue;
      }
      if (!p.path.length) {
        if (p.mode === 'wander') {
          p.wait -= dt;
          if (p.wait <= 0) {
            const options = ROOM_IDS.filter((r) => r !== p.room);
            sendTo(p, options[Math.floor(rand() * options.length)]);
            p.wait = 4 + rand() * 10;
          }
        } else if (p.mode === 'evac') {
          p.wait -= dt;
          if (p.wait <= 0) sendTo(p, 'OUT', nearestExit(p));
        }
      }
      advance(p, dt, (wp) => {
        const node = byId[wp.door];
        if (!node.alive || rand() < 0.03) return; // a missed crossing
        if (wp.to === DOORS[wp.door].b) node.ab += 1;
        else node.ba += 1;
      });
    }

    for (const node of sim.nodes) {
      if (!node.alive) continue;
      if (node.kind === 'responder') {
        if (node.searching > 0) {
          node.searching -= dt;
          if (node.searching <= 0) finishSearch(node);
        } else {
          const had = node.path.length > 0;
          advance(node, dt);
          if (had && !node.path.length && node.target && node.room === node.target) node.searching = 3;
        }
      }
      node.next -= dt;
      if (node.next <= 0) {
        node.next += 1;
        if (node.kind === 'door') doorTick(node);
        else if (node.kind === 'room') roomTick(node);
        else if (node.kind === 'responder') responderTick(node);
        gossip(node);
      }
    }
    deliver();

    if (sim.fire && sim.t >= sim.fire.burnAt && byId[`room-${sim.fire.room}`].alive) {
      byId[`room-${sim.fire.room}`].alive = false;
      say(`${ROOMS[sim.fire.room].name} sensor has stopped reporting`, 'warn');
    }
  };

  // ---- actions ------------------------------------------------------------
  sim.raiseAlarm = () => {
    if (sim.alarm) return;
    sim.alarm = true;
    sim.fire = { room: fireRoom, burnAt: sim.t + 14 };
    say(`Alarm raised. Fire reported in ${ROOMS[fireRoom].name}.`, 'warn');
    const pick = (room) => sim.people.find((p) => p.room === room && p.mode === 'wander');
    for (const room of downRooms) {
      const p = pick(room) ?? sim.people.find((q) => q.mode === 'wander' && q.room !== 'OUT' && !isHall(q.room));
      if (p) {
        p.mode = 'down';
        p.path = [];
      }
    }
    for (const p of sim.people) {
      if (p.mode === 'wander') {
        p.mode = 'evac';
        p.wait = rand() * 4;
        p.speed *= 1.5;
        if (p.path.length && !p.path[0].door) p.path = [];
      }
    }
  };
  sim.setCut = (on) => {
    if (sim.cut === on) return;
    sim.cut = on;
    say(on ? 'The link between the two halves of the building is down' : 'The link between the two halves is back', on ? 'warn' : 'ok');
  };
  sim.toggleNode = (id) => {
    const n = byId[id];
    if (!n || n.kind === 'responder' || n.kind === 'post') return;
    n.alive = !n.alive;
    say(`${n.label} ${n.alive ? 'restarted' : 'failed'}`, n.alive ? 'ok' : 'warn');
  };
  sim.truth = () => {
    const out = Object.fromEntries(ROOM_IDS.map((r) => [r, 0]));
    for (const p of sim.people) if (p.room !== 'OUT') out[p.room] += 1;
    return out;
  };

  say('Normal day. Sensors are counting.');
  return sim;
}
