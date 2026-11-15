// The simulated world. Ground truth lives here: fire, smoke, people, and the
// radio network. Nodes never read it directly. Each node owns a separate
// replica, senses only its own room or door through a noisy sensor, and
// learns everything else from messages that the network may delay or drop.

import { ROOMS, DOORS, ROOM_IDS, DOOR_IDS, route, routeLength, roomCentre, exitDoors, innerRoom, isHall, searchRooms, outward, assemblyOf, bounds, getBuilding, doorsOf } from '../core/building.js';
import { createReplica, writeDoor, writeReport, writeClaim, writeEnv, snapshot, merge } from '../core/replica.js';
import { buildingBelief, doorNet } from '../core/belief.js';
import { assign, urgency } from '../core/assign.js';
import { HEAT, buildingHazard, blockedDoors, fireRooms } from '../core/hazard.js';

export const RANGE = 265; // radio range in drawing units
const CLAIM_TTL = 20; // seconds before a silent teammate's claim stops counting
const PRESUMED_DOWN = 40; // seconds of silence inside before a teammate is presumed down
const LOW_AIR = 30; // percent of air at which a firefighter must withdraw
const FORCE_SECONDS = 10; // to force open a collapsed doorway to reach a downed teammate
const FORCE_COST = 10 * 70; // the same time, as distance, when choosing who is nearest

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
    fireSpeed: 1,
    jamUntil: 0,
    people: [],
    nodes: [],
    queue: [],
    log: [],
    rooms: {}, // truth: roomId -> { heat, smoke, rate, burning, flashed }
    blocked: new Set(), // truth: doors that cannot be used
    severed: new Set(), // "a|b" radio links cut by hand
    linkNews: {}, // "a|b" -> time news last crossed that link
    stats: { rescued: 0, lost: 0, searches: 0, duplicateSearches: 0, maydays: 0, crewRecovered: 0, crewLost: 0, dropped: 0, delivered: 0, reconverge: null },
  };
  for (const id of ROOM_IDS) sim.rooms[id] = { heat: 20, smoke: 0, rate: 0, burning: false, flashed: false };

  const layout = getBuilding();
  const sc = layout.scenario ?? {};
  const search = searchRooms();
  const known = (id) => id in ROOMS && !ROOMS[id].hall;
  const counts = {};
  if (sc.people) for (const [r, n] of Object.entries(sc.people)) if (known(r)) counts[r] = n;
  if (!Object.keys(counts).length) for (const r of search) counts[r] = 1 + Math.floor(rand() * 3);
  const farFirst = [...search].sort((a, b) => routeLength(roomCentre('OUT'), 'OUT', b) - routeLength(roomCentre('OUT'), 'OUT', a));
  const fireRoom = known(sc.fire) ? sc.fire : farFirst[0];
  const downRoom = (sc.down ?? []).filter((r) => known(r) && r !== fireRoom)[0] ?? farFirst.find((r) => r !== fireRoom) ?? fireRoom;
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
    sim.logN = (sim.logN ?? 0) + 1;
    sim.log.unshift({ n: sim.logN, t: sim.t, text, kind });
    if (sim.log.length > 80) sim.log.pop();
  };
  const name = (id) => (id === 'OUT' ? 'outside' : ROOMS[id].name);

  // ---- people -------------------------------------------------------------
  let pid = 0;
  for (const [room, n] of Object.entries(counts)) {
    for (let i = 0; i < n; i++) {
      sim.people.push({ id: `p${++pid}`, room, ...pointIn(room), path: [], mode: 'wander', speed: 42 + rand() * 16, wait: 2 + rand() * 8, dose: 0, tolerance: 4 + rand() * 7, burn: 0 });
    }
  }

  // ---- movement -----------------------------------------------------------
  function setPath(mover, doors, exitDoor) {
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

  function goTo(mover, toRoom, avoid, blocked) {
    const doors = route(mover.room, toRoom, avoid, blocked);
    if (!doors.length && mover.room !== toRoom) return false;
    setPath(mover, doors);
    return true;
  }

  // The quickest way out that avoids the given rooms and doors.
  function goOut(mover, avoid, blocked) {
    let best = null;
    for (const e of exitDoors()) {
      if (blocked.has(e)) continue;
      const inner = innerRoom(e);
      if (avoid.has(inner) && inner !== mover.room) continue;
      const doors = inner === mover.room ? [] : route(mover.room, inner, avoid, blocked);
      if (inner !== mover.room && !doors.length) continue;
      let pos = mover;
      let len = 0;
      for (const d of [...doors, e]) {
        len += Math.hypot(DOORS[d].x - pos.x, DOORS[d].y - pos.y);
        pos = DOORS[d];
      }
      if (!best || len < best.len) best = { doors: [...doors, e], exit: e, len };
    }
    if (!best) return false;
    setPath(mover, best.doors, best.exit);
    return true;
  }

  // gate(wp) is asked at each door: return false to stop there.
  function advance(mover, dt, { gate, onCross, factor = 1 } = {}) {
    let budget = mover.speed * factor * dt;
    while (budget > 0 && mover.path.length) {
      const wp = mover.path[0];
      const d = Math.hypot(wp.x - mover.x, wp.y - mover.y);
      if (d > budget) {
        mover.x += ((wp.x - mover.x) / d) * budget;
        mover.y += ((wp.y - mover.y) / d) * budget;
        return;
      }
      mover.x = wp.x;
      mover.y = wp.y;
      budget -= d;
      if (wp.door && gate && !gate(wp)) return;
      mover.path.shift();
      if (wp.door) {
        mover.room = wp.to;
        onCross?.(wp);
      }
    }
  }

  // ---- nodes --------------------------------------------------------------
  const addNode = (n) => {
    const node = { alive: true, next: rand(), ...n, rep: createReplica(n.id) };
    sim.nodes.push(node);
    return node;
  };
  for (const d of DOOR_IDS) addNode({ id: d, kind: 'door', label: `Door ${d.replace(/^d/, '')}`, x: DOORS[d].x, y: DOORS[d].y, ab: 0, ba: 0 });
  for (const r of ROOM_IDS) {
    const c = roomCentre(r);
    addNode({ id: `room-${r}`, kind: 'room', room: r, label: `${ROOMS[r].name} sensor`, x: c.x, y: isHall(r) ? c.y + 30 : c.y - Math.min(70, ROOMS[r].h / 3), emptyStreak: 0, lastTemp: 20 });
  }
  const at = (along, across) => ({ x: DOORS[exit0].x + out0.x * along + asm0.perp.x * across, y: DOORS[exit0].y + out0.y * along + asm0.perp.y * across });
  addNode({ id: 'POST', kind: 'post', label: 'Command post', ...at(60, 0) });
  [[40, -55], [40, 55], [85, -40]].forEach(([along, across], i) => {
    const home = at(along, across);
    addNode({ id: `R${i + 1}`, kind: 'responder', label: `Responder ${i + 1}`, room: 'OUT', ...home, home, path: [], speed: 70, target: null, mission: null, searching: 0, air: 100 - i * 9, status: 'ok', refused: {}, checked: {}, manual: false, escort: null, forcing: null });
  });

  const byId = Object.fromEntries(sim.nodes.map((n) => [n.id, n]));
  const responders = sim.nodes.filter((n) => n.kind === 'responder');
  sim.node = (id) => byId[id];

  // The day starts with people already inside: they came in through an
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
  const pairKey = (a, b) => (sim.nodes.indexOf(a) < sim.nodes.indexOf(b) ? `${a.id}|${b.id}` : `${b.id}|${a.id}`);
  const smokeAt = (n) => {
    if (n.kind === 'door') return Math.max(...[DOORS[n.id].a, DOORS[n.id].b].map((r) => sim.rooms[r]?.smoke ?? 0));
    return sim.rooms[n.room]?.smoke ?? 0;
  };
  const inRange = (a, b) => a.alive && b.alive && Math.hypot(a.x - b.x, a.y - b.y) <= RANGE;
  sim.linked = (a, b) => {
    if (!inRange(a, b)) return false;
    if (sim.cut && (a.x - sim.cutX) * (b.x - sim.cutX) < 0) return false;
    return !sim.severed.has(pairKey(a, b));
  };
  // Chance a message gets through: smoke attenuates the signal, jamming kills it.
  sim.quality = (a, b) => (sim.t < sim.jamUntil ? 0 : Math.max(0.08, 1 - 0.85 * Math.max(smokeAt(a), smokeAt(b))));
  sim.links = () => {
    const out = [];
    for (let i = 0; i < sim.nodes.length; i++) {
      for (let j = i + 1; j < sim.nodes.length; j++) {
        const a = sim.nodes[i];
        const b = sim.nodes[j];
        if (!inRange(a, b)) continue;
        const key = `${a.id}|${b.id}`;
        const severed = sim.severed.has(key);
        if (!severed && !sim.linked(a, b)) continue;
        out.push({ a, b, key, severed, q: severed ? 0 : sim.quality(a, b), hot: sim.t - (sim.linkNews[key] ?? -99) < 0.6 });
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
      if (!sim.linked(from, to) || rand() > sim.quality(from, to)) {
        sim.stats.dropped += 1;
        continue;
      }
      sim.stats.delivered += 1;
      if (merge(to.rep, m.snap, sim.t, sim.t - m.sent) > 0) sim.linkNews[pairKey(from, to)] = sim.t;
    }
    sim.queue = waiting;
  }

  // ---- fire (truth) ---------------------------------------------------------
  function kill(node, why) {
    if (!node.alive) return;
    node.alive = false;
    say(`${node.label} ${why}`, 'warn');
  }

  const burnt = new Set();
  function flashover(id) {
    const room = sim.rooms[id];
    room.flashed = true;
    say(`Flashover in ${ROOMS[id].name}. Its doors are lost.`, 'warn');
    for (const d of doorsOf(id)) {
      sim.blocked.add(d);
      burnt.add(d);
      kill(byId[d], 'destroyed in the flashover');
    }
    kill(byId[`room-${id}`], 'destroyed in the flashover');
    for (const p of sim.people) {
      if (p.room === id && p.mode !== 'lost') {
        p.mode = 'lost';
        p.path = [];
        sim.stats.lost += 1;
      }
    }
    for (const r of responders) {
      if (r.room === id && r.alive) {
        r.status = 'mayday';
        r.path = [];
        r.alive = false;
        sim.stats.crewLost += 1;
        say(`Contact lost with ${r.label} in ${ROOMS[id].name}`, 'warn');
      }
    }
  }

  const size = (id) => Math.min(2.4, Math.max(0.7, (ROOMS[id].w * ROOMS[id].h) / 60000));
  function stepFire(dt) {
    const fs = sim.fireSpeed;
    const before = {};
    for (const id of ROOM_IDS) before[id] = sim.rooms[id].heat;
    for (const id of ROOM_IDS) {
      const r = sim.rooms[id];
      if (r.burning) {
        r.heat += ((850 - r.heat) * 0.022 * fs * dt) / Math.sqrt(size(id)); // a big space takes longer to go up
        r.smoke += (1 - r.smoke) * 0.09 * fs * dt;
      } else {
        r.heat -= (r.heat - 20) * 0.02 * dt; // walls and air carry heat away
      }
    }
    // Heat and smoke move through doorways; a lost door still leaks a little.
    for (const d of DOOR_IDS) {
      const { a, b } = DOORS[d];
      // A doorway burnt out by a flashover is a hole; one collapsed by hand is rubble.
      const open = burnt.has(d) ? 1.6 : sim.blocked.has(d) ? 0.35 : 1;
      if (a === 'OUT' || b === 'OUT') {
        const inner = sim.rooms[innerRoom(d)];
        inner.smoke = Math.max(0, inner.smoke - 0.004 * open * dt); // an exit vents a little smoke
        continue;
      }
      const ra = sim.rooms[a];
      const rb = sim.rooms[b];
      const heat = (before[a] - before[b]) * 0.02 * fs * open * dt;
      // A burning room is a source: it heats its neighbours without cooling itself.
      if (!(ra.burning && heat > 0)) ra.heat -= heat / size(a);
      if (!(rb.burning && heat < 0)) rb.heat += heat / size(b);
      const smoke = (ra.smoke - rb.smoke) * 0.13 * fs * open * dt;
      ra.smoke -= smoke / size(a);
      rb.smoke += smoke / size(b);
    }
    for (const id of ROOM_IDS) {
      const r = sim.rooms[id];
      r.smoke = Math.min(1, Math.max(0, r.smoke));
      r.rate = r.rate * 0.8 + ((r.heat - before[id]) / dt) * 0.2;
      if (!r.burning && r.heat > HEAT.FIRE) {
        r.burning = true;
        say(`Fire has spread to ${ROOMS[id].name}`, 'warn');
      }
      if (!r.flashed && r.heat > HEAT.FLASH) flashover(id);
      const sensor = byId[`room-${id}`];
      if (sensor.alive && r.heat > HEAT.SENSOR) kill(sensor, 'destroyed by heat');
    }
    for (const d of DOOR_IDS) {
      const hot = Math.max(...[DOORS[d].a, DOORS[d].b].map((r) => sim.rooms[r]?.heat ?? 0));
      if (byId[d].alive && hot > HEAT.DOOR) kill(byId[d], 'destroyed by heat');
    }
  }

  // ---- civilians (truth) ------------------------------------------------------
  const doorFree = {}; // doorId -> time the doorway is next clear
  const tooHot = (self) => new Set(ROOM_IDS.filter((r) => r !== self && sim.rooms[r].heat > HEAT.LETHAL + 20));

  function stepPeople(dt) {
    for (const p of sim.people) {
      if (p.mode === 'lost') continue;
      if (p.room === 'OUT') {
        advance(p, dt);
        continue;
      }
      const here = sim.rooms[p.room];
      // exposure
      p.dose += here.smoke * dt;
      // Someone being brought out by a firefighter is shielded on the way.
      p.burn = here.heat > HEAT.LETHAL && p.mode !== 'assisted' ? p.burn + dt : Math.max(0, p.burn - dt);
      if (p.burn > 4) {
        p.mode = 'lost';
        p.path = [];
        sim.stats.lost += 1;
        continue;
      }
      if (p.mode !== 'down' && p.mode !== 'assisted' && p.dose > p.tolerance) {
        p.mode = 'down';
        p.path = [];
      }
      if (p.mode === 'down') continue;

      if (!p.path.length) {
        p.wait -= dt;
        if (p.wait <= 0) {
          if (p.mode === 'wander') {
            const options = ROOM_IDS.filter((r) => r !== p.room);
            goTo(p, options[Math.floor(rand() * options.length)]);
            p.wait = 4 + rand() * 10;
          } else if (!goOut(p, tooHot(p.room), sim.blocked)) {
            p.wait = 1.5; // no way out right now: stay put and try again
          }
        }
      }
      advance(p, dt, {
        factor: 1 - 0.5 * here.smoke,
        gate: (wp) => {
          if (p.mode !== 'wander') {
            // Fire may have moved since the route was chosen.
            if (sim.blocked.has(wp.door) || (wp.to !== 'OUT' && sim.rooms[wp.to].heat > HEAT.LETHAL + 20)) {
              p.path = [];
              p.wait = 0.4;
              return false;
            }
            // Only one person fits through a doorway at a time.
            if (sim.t < (doorFree[wp.door] ?? 0)) return false;
            doorFree[wp.door] = sim.t + 0.45;
          }
          return true;
        },
        onCross: (wp) => {
          if (wp.to === 'OUT') sim.stats.rescued += 1;
          const node = byId[wp.door];
          const smoke = Math.max(sim.rooms[wp.from]?.smoke ?? 0, sim.rooms[wp.to]?.smoke ?? 0);
          if (!node.alive || rand() < 0.03 + 0.2 * smoke) return; // a missed crossing
          if (wp.to === DOORS[wp.door].b) node.ab += 1;
          else node.ba += 1;
        },
      });
    }
  }

  // ---- node behaviour, once a second each ---------------------------------
  function doorTick(node) {
    writeDoor(node.rep, node.id, node.ab, node.ba, sim.t);
  }

  function roomTick(node) {
    const r = sim.rooms[node.room];
    const temp = r.heat + (rand() - 0.5) * 4;
    writeEnv(node.rep, node.room, node.id, { room: node.room, temp, rate: temp - node.lastTemp, smoke: r.smoke }, sim.t);
    node.lastTemp = temp;

    const inside = sim.people.filter((p) => p.room === node.room && p.mode !== 'lost');
    const sight = 1 - 0.7 * r.smoke; // smoke blinds the camera
    let seen = 0;
    let moving = false;
    for (const p of inside) {
      const isMoving = p.path.length > 0;
      if (rand() < (isMoving ? 0.98 : 0.85) * sight) {
        seen += 1;
        moving = moving || isMoving;
      }
    }
    if (seen > 0) {
      node.emptyStreak = 0;
      writeReport(node.rep, node.room, node.id, { state: moving ? 'moving' : 'still', count: seen, conf: 0.9 * sight, kind: 'sensor' }, sim.t);
    } else if (r.smoke > 0.45) {
      node.emptyStreak = 0; // blinded by smoke: seeing nobody proves nothing, so say nothing
    } else if (++node.emptyStreak >= 3) {
      writeReport(node.rep, node.room, node.id, { state: 'empty', count: 0, conf: 0.9, kind: 'sensor' }, sim.t);
    }
  }

  // What this responder believes about each teammate, from its own records.
  function peersOf(node) {
    return responders
      .filter((n) => n !== node)
      .map((n) => {
        const c = node.rep.claims[n.id];
        if (!c) return { id: n.id, room: 'OUT', x: n.home.x, y: n.home.y, status: 'ok', age: 0 };
        return { id: n.id, room: c.room, x: c.x, y: c.y, status: c.status ?? 'ok', age: sim.t - c.at, manual: Boolean(c.manual), target: c.target };
      });
  }

  function mayday(node, why) {
    if (node.status === 'mayday') return;
    node.status = 'mayday';
    node.path = [];
    node.target = null;
    node.mission = null;
    node.searching = 0;
    sim.stats.maydays += 1;
    say(`MAYDAY. ${node.label} is down in ${name(node.room)}: ${why}`, 'warn');
  }

  function withdraw(node, hazards, blocked) {
    node.target = null;
    node.mission = null;
    node.searching = 0;
    if (!goOut(node, fireRooms(hazards), blocked) && !goOut(node, new Set(), blocked)) mayday(node, 'no way out');
  }

  // A firefighter can see the doorways of the room they are in. If a collapse
  // has left no way out, that is a mayday now, not when the air runs low.
  function trapped(node) {
    if (node.room === 'OUT' || node.status === 'mayday' || node.escort) return false;
    const blocked = blockedDoors(node.rep);
    for (const d of doorsOf(node.room)) {
      if (sim.blocked.has(d) && !blocked.has(d)) {
        writeEnv(node.rep, `door:${d}`, node.id, { door: d, blocked: true }, sim.t);
        blocked.add(d);
        say(`${node.label} reports the doorway from ${name(node.room)} has collapsed`, 'warn');
      }
    }
    const wayOut = exitDoors().some((e) => !blocked.has(e) && (innerRoom(e) === node.room || route(node.room, innerRoom(e), new Set(), blocked).length));
    if (wayOut) return false;
    mayday(node, 'trapped, the doorway has collapsed');
    node.trapped = true;
    return true;
  }

  function responderTick(node) {
    const here = sim.rooms[node.room];
    if (here) writeEnv(node.rep, node.room, node.id, { room: node.room, temp: here.heat, rate: here.rate, smoke: here.smoke }, sim.t);
    writeClaim(node.rep, node.id, { target: node.target, room: node.room, x: node.x, y: node.y, status: node.status, air: Math.round(node.air), manual: node.manual }, sim.t);
    // Trapped, not hurt: once someone has forced the way open, get out with them.
    if (node.status === 'mayday' && node.trapped && !node.escort) {
      const open = blockedDoors(node.rep);
      const free = exitDoors().some((e) => !open.has(e) && (innerRoom(e) === node.room || route(node.room, innerRoom(e), new Set(), open).length));
      if (free) {
        node.trapped = false;
        node.status = 'low-air';
        say(`${node.label} has a way out again and is withdrawing`, 'ok');
        withdraw(node, buildingHazard(node.rep, ROOM_IDS, sim.t), open);
      }
      return;
    }
    if (sim.alarm && trapped(node)) return;
    if (!sim.alarm || node.status === 'mayday' || node.searching > 0) return;

    if (node.status === 'refill') {
      if (sim.t < node.refillUntil) return;
      const entry = innerRoom(exit0);
      if ((buildingHazard(node.rep, ROOM_IDS, sim.t)[entry]?.est ?? 0) >= 200) {
        node.refillUntil = sim.t + 5; // the way in is too hot: hold outside
        return;
      }
      node.air = 100;
      node.status = 'ok';
      say(node.manual ? `To ${node.label}: Fresh cylinder. Waiting for your orders.` : `${node.label} has fresh air and is going back in`, 'ok');
    }
    const hazards = buildingHazard(node.rep, ROOM_IDS, sim.t);
    const blocked = blockedDoors(node.rep);
    if (node.status === 'low-air') {
      if (!node.escort && !node.path.length && node.room !== 'OUT') withdraw(node, hazards, blocked);
      return;
    }

    const belief = buildingBelief(node.rep, sim.t);
    const peers = peersOf(node);
    const avoid = fireRooms(hazards);

    // Get out while there is still a way out. If the room, or any room on the
    // way to the nearest exit, is heading for 240°C, leave now.
    if (node.room !== 'OUT') {
      const danger = (r) => (hazards[r]?.est ?? 0) >= 240;
      let wayOut = null;
      for (const e of exitDoors()) {
        if (blocked.has(e)) continue;
        const doors = route(node.room, innerRoom(e), new Set(), blocked);
        if (!doors.length && innerRoom(e) !== node.room) continue;
        if (!wayOut || doors.length < wayOut.length) wayOut = doors;
      }
      const onWay = new Set([node.room]);
      let cur = node.room;
      for (const d of wayOut ?? []) {
        cur = DOORS[d].a === cur ? DOORS[d].b : DOORS[d].a;
        onWay.add(cur);
      }
      if ([...onWay].some(danger) && !node.mission) {
        node.status = 'low-air';
        say(`${node.label} is pulling out: the way out is about to be lost`, 'warn');
        withdraw(node, hazards, blocked);
        return;
      }
    }

    // Under the phone's control: self-preservation above still applies, but
    // tasking is left to the person holding the phone.
    if (node.manual) return;

    // A teammate in trouble comes before any search.
    const down = peers.filter((p) => (p.status === 'mayday' || (p.age > PRESUMED_DOWN && p.room !== 'OUT')) && sim.t - (node.checked[p.id] ?? -999) > 60 && p.room !== 'OUT');
    // Teammates under manual control are not counted on for rescue or searches,
    // and the room they were sent to is theirs.
    const team = [{ id: node.id, room: node.room, x: node.x, y: node.y }, ...peers.filter((p) => p.status === 'ok' && p.age < CLAIM_TTL && !p.manual)];
    if (down.length) {
      const victim = down[0];
      // To reach a downed teammate a crew will force a collapsed doorway, so
      // collapsed doors do not rule a rescuer out; each one costs time instead.
      const reach = (r) => routeLength({ x: r.x, y: r.y }, r.room, victim.room, avoid, new Set()) + FORCE_COST * route(r.room, victim.room, avoid, new Set()).filter((d) => blocked.has(d)).length;
      const nearest = [...team].sort((a, b) => reach(a) - reach(b) || a.id.localeCompare(b.id))[0];
      if (nearest.id === node.id && Number.isFinite(reach(nearest))) {
        if (node.mission !== victim.id) {
          node.mission = victim.id;
          node.target = victim.room;
          goTo(node, victim.room, avoid, new Set());
          say(`${node.label} breaks off to reach ${byId[victim.id].label} in ${name(victim.room)}${victim.status === 'mayday' ? '' : ` (silent ${Math.round(victim.age)} s)`}`, 'act');
        }
        return;
      }
    }
    if (node.mission) {
      node.mission = null;
      node.target = null;
    }

    const skip = new Set(Object.keys(node.refused).filter((r) => sim.t - node.refused[r] < 30));
    for (const p of peers) if (p.manual && p.target && p.age < CLAIM_TTL) skip.add(p.target);
    let target = assign(belief, team, { hazards, blocked, skip })[node.id];
    // Keep going to the current room unless it no longer needs a search or
    // something more urgent has come up. Stops responders dithering.
    const u = (id) => urgency(belief[id], hazards[id]);
    if (node.target && target && !skip.has(node.target) && u(node.target) > 0 && u(target) <= u(node.target)) target = node.target;
    if (target !== node.target) {
      node.target = target;
      if (target) {
        if (goTo(node, target, avoid, blocked)) say(`${node.label} heads for ${ROOMS[target].name}. ${belief[target].why}.`, 'act');
        else node.target = null;
      } else {
        const hall = ROOM_IDS.find((r) => isHall(r) && !avoid.has(r));
        if (hall && node.room !== hall) goTo(node, hall, avoid, blocked);
      }
    }
  }

  const searched = {}; // room -> { t, by }
  function arrive(node) {
    if (node.mission) {
      const mate = byId[node.mission];
      // In the right room is not the same as beside them: in a big hall, cross it first.
      if (mate.room === node.room && mate.status === 'mayday' && mate.alive && Math.hypot(mate.x - node.x, mate.y - node.y) > 18) {
        node.path = [{ x: mate.x, y: mate.y }];
        return;
      }
      if (mate.room === node.room && mate.status === 'mayday' && mate.alive) {
        // The rescuer brings the casualty out: one route, together, at the
        // casualty's pace, on the rescuer's spare air.
        mate.status = 'low-air';
        mate.air = Math.max(mate.air, 50);
        mate.path = [];
        mate.escort = node.id;
        mate.trapped = false;
        say(`${node.label} has reached ${mate.label} and is bringing them out.`, 'ok');
        sim.stats.crewRecovered += 1;
        node.status = 'low-air';
        node.speed = 45;
        withdraw(node, buildingHazard(node.rep, ROOM_IDS, sim.t), blockedDoors(node.rep));
      } else {
        node.checked[node.mission] = sim.t;
        say(`${node.label} found no one from the crew in ${name(node.room)}`, 'info');
        node.mission = null;
        node.target = null;
      }
      return;
    }
    const inside = sim.people.filter((p) => p.room === node.room && p.mode !== 'lost');
    const down = inside.filter((p) => p.mode === 'down');
    sim.stats.searches += 1;
    const prev = searched[node.room];
    if (prev && prev.by !== node.id && sim.t - prev.t < 45) sim.stats.duplicateSearches += 1;
    searched[node.room] = { t: sim.t, by: node.id };
    // A head count by someone standing in the room also tells everyone how far
    // the door counters have drifted, so the correction outlives the search.
    const net = doorNet(node.rep, node.room);
    const drift = net === null ? undefined : net - inside.length;
    if (inside.length === 0) {
      writeReport(node.rep, node.room, node.id, { state: 'empty', count: 0, conf: 0.98, kind: 'search', drift }, sim.t);
      say(`${node.label} searched ${ROOMS[node.room].name}: clear`, 'ok');
    } else {
      writeReport(node.rep, node.room, node.id, { state: down.length ? 'still' : 'moving', count: inside.length, conf: 0.98, kind: 'search', drift }, sim.t);
      say(`${node.label} found ${inside.length} in ${ROOMS[node.room].name}`, 'warn');
      for (const p of down) {
        p.mode = 'assisted';
        p.speed = 34;
        p.dose = Math.min(p.dose, p.tolerance - 3); // on the firefighter's air
        p.tolerance += 30;
        p.wait = 0;
      }
    }
    node.target = null;
  }

  // A casualty being brought out stays at the rescuer's side, whoever is stepped first.
  function followLead(node) {
    const lead = byId[node.escort];
    if (!lead.alive || lead.status === 'mayday') {
      node.escort = null;
      mayday(node, `lost contact with ${lead.label}`);
      return;
    }
    node.room = lead.room;
    node.x = lead.x - 9;
    node.y = lead.y + 9;
    // together all the way to the assembly point, not just over the threshold
    if (lead.room === 'OUT' && !lead.path.length) {
      node.escort = null;
      node.status = 'refill';
      node.speed = 70;
      node.refillUntil = sim.t + 6;
      say(`${lead.label} and ${node.label} are out`, 'ok');
    }
  }

  function stepResponder(node, dt) {
    if (node.room !== 'OUT' && node.status !== 'refill') {
      node.air = Math.max(0, node.air - (0.4 + 0.5 * sim.rooms[node.room].smoke) * dt);
      if (node.air <= 0) mayday(node, 'out of air');
      else if (node.status === 'ok' && sim.rooms[node.room].heat > 330) {
        // Too hot to stay, whatever the board says.
        node.status = 'low-air';
        say(`${node.label} is driven out of ${name(node.room)} by the heat`, 'warn');
        withdraw(node, buildingHazard(node.rep, ROOM_IDS, sim.t), blockedDoors(node.rep));
      } else if (node.air < LOW_AIR && node.status === 'ok') {
        node.status = 'low-air';
        say(`${node.label} is low on air and withdrawing`, 'act');
        withdraw(node, buildingHazard(node.rep, ROOM_IDS, sim.t), blockedDoors(node.rep));
      }
    }
    if (node.status === 'mayday') return;
    if (node.escort) {
      followLead(node);
      return;
    }
    if (node.searching > 0) {
      node.searching -= dt;
      if (node.searching <= 0) arrive(node);
      return;
    }
    if (node.forcing) {
      if (sim.t < node.forcing.until) return;
      const d = node.forcing.door;
      node.forcing = null;
      sim.blocked.delete(d);
      writeEnv(node.rep, `door:${d}`, node.id, { door: d, blocked: false }, sim.t);
      say(`${node.label} has forced the doorway open`, 'ok');
    }
    const had = node.path.length > 0;
    advance(node, dt, {
      gate: (wp) => {
        // On the way to a downed teammate, a collapsed doorway is forced open.
        if (sim.blocked.has(wp.door) && node.mission && byId[node.mission].status === 'mayday') {
          writeEnv(node.rep, `door:${wp.door}`, node.id, { door: wp.door, blocked: true }, sim.t);
          node.forcing = { door: wp.door, until: sim.t + FORCE_SECONDS };
          say(`${node.label} is forcing the collapsed doorway to reach ${byId[node.mission].label}`, 'act');
          return false; // stays at the doorway, path kept
        }
        // What the firefighter finds at the doorway is the truth, and it goes
        // straight into the shared record for everyone else.
        if (sim.blocked.has(wp.door)) {
          writeEnv(node.rep, `door:${wp.door}`, node.id, { door: wp.door, blocked: true }, sim.t);
          say(`${node.label} reports the way from ${name(wp.from)} to ${name(wp.to)} is impassable`, 'warn');
        } else if (wp.to !== 'OUT' && sim.rooms[wp.to].heat > HEAT.REFUSE) {
          writeEnv(node.rep, wp.to, node.id, { room: wp.to, temp: sim.rooms[wp.to].heat, rate: sim.rooms[wp.to].rate, smoke: sim.rooms[wp.to].smoke }, sim.t);
          say(`${node.label} will not enter ${name(wp.to)}: ${Math.round(sim.rooms[wp.to].heat)}°C`, 'warn');
        } else return true;
        if (node.target) node.refused[node.target] = sim.t;
        if (node.mission) node.checked[node.mission] = sim.t;
        node.path = [];
        node.target = null;
        node.mission = null;
        return false;
      },
    });
    if (had && !node.path.length) {
      if (node.room === 'OUT' && node.status === 'low-air') {
        node.status = 'refill';
        node.speed = 70;
        node.refillUntil = sim.t + 6;
      } else if (node.target && node.room === node.target) node.searching = node.mission ? 1 : 3;
    }
    for (const m of sim.nodes) if (m.escort === node.id) followLead(m);
  }

  // ---- step ---------------------------------------------------------------
  let healAt = null;
  let secondAcc = 0;
  function agreed() {
    // Do the nodes that can reach the command post all hold the same view?
    const seen = new Set([byId.POST]);
    const queue = [byId.POST];
    while (queue.length) {
      const cur = queue.shift();
      for (const n of sim.nodes) if (!seen.has(n) && sim.linked(cur, n)) (seen.add(n), queue.push(n));
    }
    const key = (n) => {
      const b = buildingBelief(n.rep, sim.t);
      return ROOM_IDS.map((r) => b[r].state).join();
    };
    const first = key(byId.POST);
    return [...seen].every((n) => key(n) === first);
  }

  sim.step = (dt) => {
    sim.t += dt;
    if (sim.alarm) stepFire(dt);
    stepPeople(dt);
    for (const node of sim.nodes) {
      if (!node.alive) continue;
      if (node.kind === 'responder') stepResponder(node, dt);
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

    secondAcc += dt;
    if (secondAcc >= 1) {
      secondAcc = 0;
      if (healAt !== null && sim.t >= sim.jamUntil && agreed()) {
        sim.stats.reconverge = sim.t - healAt;
        healAt = null;
      }
    }
  };

  // ---- actions (the chaos controls) -------------------------------------------
  sim.raiseAlarm = () => {
    if (sim.alarm) return;
    sim.alarm = true;
    sim.fire = { room: fireRoom };
    sim.rooms[fireRoom].burning = true;
    sim.rooms[fireRoom].heat = Math.max(sim.rooms[fireRoom].heat, 110);
    say(`Alarm raised. Fire reported in ${ROOMS[fireRoom].name}.`, 'warn');
    const hurt = sim.people.find((p) => p.room === downRoom && p.mode === 'wander') ?? sim.people.find((q) => q.mode === 'wander' && q.room !== 'OUT' && q.room !== fireRoom && !isHall(q.room));
    if (hurt) {
      hurt.mode = 'down';
      hurt.path = [];
    }
    for (const p of sim.people) {
      if (p.mode === 'wander') {
        p.mode = 'evac';
        p.wait = rand() < 0.25 ? 10 + rand() * 14 : 1 + rand() * 7; // some people are slow to believe an alarm
        p.speed *= 1.5;
        if (p.path.length && !p.path[0].door) p.path = [];
      }
    }
  };
  sim.ignite = (roomId) => {
    const r = sim.rooms[roomId];
    if (!r || r.burning) return;
    if (!sim.alarm) sim.raiseAlarm();
    r.burning = true;
    r.heat = Math.max(r.heat, 120);
    say(`A second fire has started in ${ROOMS[roomId].name}`, 'warn');
  };
  sim.setFireSpeed = (x) => {
    sim.fireSpeed = x;
    say(`Fire is now spreading at ${x}x`, 'warn');
  };
  sim.setCut = (on) => {
    if (sim.cut === on) return;
    sim.cut = on;
    if (!on) healAt = sim.t;
    say(on ? 'The link between the two halves of the building is down' : 'The link between the two halves is back', on ? 'warn' : 'ok');
  };
  sim.sever = (key) => {
    if (sim.severed.has(key)) {
      sim.severed.delete(key);
      healAt = sim.t;
    } else sim.severed.add(key);
    const [a, b] = key.split('|').map((id) => byId[id].label);
    say(`Radio link ${a} to ${b} ${sim.severed.has(key) ? 'severed' : 'restored'}`, sim.severed.has(key) ? 'warn' : 'ok');
  };
  sim.jam = (seconds = 10) => {
    sim.jamUntil = sim.t + seconds;
    healAt = sim.jamUntil;
    say(`Radio jammed for ${seconds} s. Nothing gets through.`, 'warn');
  };
  sim.blockDoor = (doorId) => {
    if (!DOORS[doorId] || sim.blocked.has(doorId)) return;
    sim.blocked.add(doorId);
    kill(byId[doorId], 'crushed as the doorway collapsed');
  };
  sim.toggleNode = (id) => {
    const n = byId[id];
    if (!n || n.kind === 'responder' || n.kind === 'post') return;
    n.alive = !n.alive;
    say(`${n.label} ${n.alive ? 'restarted' : 'failed'}`, n.alive ? 'ok' : 'warn');
  };
  // Command speaking to one firefighter (shown on their radio).
  sim.tell = (id, text) => {
    if (byId[id]?.kind === 'responder') say(`To ${byId[id].label}: ${text}`, 'act');
  };
  // A firefighter's own report from where they stand: written to their record,
  // which then spreads to everyone they can reach.
  sim.report = (id, what) => {
    const n = byId[id];
    if (n?.kind !== 'responder' || !n.alive || n.room === 'OUT' || isHall(n.room)) return false;
    if (what === 'clear') writeReport(n.rep, n.room, n.id, { state: 'empty', count: 0, conf: 0.98, kind: 'search' }, sim.t);
    else writeReport(n.rep, n.room, n.id, { state: 'still', count: 1, conf: 0.95, kind: 'search' }, sim.t);
    say(what === 'clear' ? `${n.label} searched ${ROOMS[n.room].name}: clear` : `${n.label} found 1 in ${ROOMS[n.room].name}`, what === 'clear' ? 'ok' : 'warn');
    return true;
  };

  // An order from the firefighter's phone: go to a room (or 'OUT'), or 'AUTO'
  // to hand control back. Returns what happened, in words.
  sim.command = (id, room) => {
    const n = byId[id];
    if (n?.kind !== 'responder') return 'No such firefighter.';
    const tell = (text) => {
      sim.tell(id, text);
      return text;
    };
    if (!n.alive) return 'No contact with that firefighter.';
    if (room === 'AUTO') {
      if (!n.manual) return tell('Already on automatic tasking.');
      n.manual = false;
      n.target = null;
      return tell('Back on automatic tasking.');
    }
    if (n.status === 'mayday') return tell('You are down. Stay where you are, help is coming.');
    if (n.escort) return tell(`Order refused: stay with ${byId[n.escort].label}, they are bringing you out.`);
    if (n.status === 'refill') return tell('Order refused: you are changing your cylinder at the entrance.');
    if (n.status === 'low-air') return tell(n.air < 30 ? 'Order refused: you are withdrawing on low air.' : 'Order refused: you are pulling out, your way out is at risk.');
    if (room !== 'OUT' && !(room in ROOMS)) return tell('That place is not on the plan.');
    const hazards = buildingHazard(n.rep, ROOM_IDS, sim.t);
    const blocked = blockedDoors(n.rep);
    const avoid = fireRooms(hazards);
    if (room !== 'OUT' && hazards[room]?.level === 'fire' && room !== n.room) return tell(`Order refused: ${ROOMS[room].name} is believed to be burning.`);
    avoid.delete(room);
    if (n.room !== 'OUT') avoid.delete(n.room);
    if (room === n.room) {
      n.manual = true;
      n.target = room === 'OUT' ? null : room;
      n.path = [];
      if (n.target) n.searching = 3;
      return tell(room === 'OUT' ? 'You are already outside. Holding.' : `You are already in ${ROOMS[room].name}. Searching it.`);
    }
    n.manual = true;
    n.mission = null;
    n.searching = 0;
    const ok = room === 'OUT' ? goOut(n, avoid, blocked) : goTo(n, room, avoid, blocked);
    if (!ok) {
      n.target = null;
      return tell(`Order refused: no safe way to ${room === 'OUT' ? 'an exit' : ROOMS[room].name} avoiding the fire.`);
    }
    n.target = room === 'OUT' ? null : room;
    say(room === 'OUT' ? `To ${n.label}: Leave by the nearest safe exit. Ordered from your phone.` : `${n.label} heads for ${ROOMS[room].name}. Ordered from your phone.`, 'act');
    return 'ok';
  };

  sim.mayday = (id) => {
    const n = byId[id];
    if (n?.kind === 'responder' && n.alive && n.room !== 'OUT') mayday(n, 'not moving');
  };

  // ---- truth, for the display and the evaluation only --------------------------
  sim.truth = () => {
    const out = Object.fromEntries(ROOM_IDS.map((r) => [r, 0]));
    for (const p of sim.people) if (p.room !== 'OUT' && p.mode !== 'lost') out[p.room] += 1;
    return out;
  };
  sim.metrics = () => {
    const sensors = sim.nodes.filter((n) => n.kind === 'door' || n.kind === 'room');
    const inside = sim.people.filter((p) => p.room !== 'OUT' && p.mode !== 'lost');
    return {
      total: sim.people.length,
      safe: sim.stats.rescued,
      inside: inside.length,
      down: inside.filter((p) => p.mode === 'down').length,
      lost: sim.stats.lost,
      sensorsAlive: sensors.filter((n) => n.alive).length,
      sensorsTotal: sensors.length,
      crewDown: responders.filter((r) => r.status === 'mayday').length,
      burning: ROOM_IDS.filter((r) => sim.rooms[r].burning).length,
      dropRate: sim.stats.delivered + sim.stats.dropped ? sim.stats.dropped / (sim.stats.delivered + sim.stats.dropped) : 0,
      ...sim.stats,
    };
  };

  say('Normal day. Sensors are counting.');
  return sim;
}
