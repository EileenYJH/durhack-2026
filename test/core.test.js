import test from 'node:test';
import assert from 'node:assert/strict';
import { createReplica, writeDoor, writeReport, writeClaim, snapshot, merge, fingerprint } from '../src/core/replica.js';
import { roomBelief, buildingBelief, headcount, PARAMS } from '../src/core/belief.js';
import { assign } from '../src/core/assign.js';
import { DOOR_IDS, ROOM_IDS, route } from '../src/core/building.js';

function allDoors(rep, now, counts = {}) {
  for (const d of DOOR_IDS) {
    const [ab, ba] = counts[d] ?? [0, 0];
    writeDoor(rep, d, ab, ba, now);
  }
}

test('merge gives the same result in any order, and repeating is harmless', () => {
  const a = createReplica('a');
  const b = createReplica('b');
  const c = createReplica('c');
  writeDoor(a, 'dA', 2, 0, 10);
  writeDoor(a, 'dA', 3, 1, 11);
  writeReport(b, 'A', 'room-A', { state: 'moving', count: 2, conf: 0.9 }, 12);
  writeClaim(c, 'R1', { target: 'A', room: 'COR', x: 1, y: 2 }, 13);
  const snaps = [snapshot(a, 20), snapshot(b, 20), snapshot(c, 20)];

  const x = createReplica('x');
  const y = createReplica('y');
  for (const s of snaps) merge(x, s, 20);
  for (const s of [...snaps].reverse()) merge(y, s, 20);
  for (const s of snaps) merge(y, s, 21);
  assert.equal(fingerprint(x), fingerprint(y));
  assert.equal(x.doors.dA.ab, 3);
});

test('an older record never overwrites a newer one', () => {
  const door = createReplica('door');
  writeDoor(door, 'dA', 1, 0, 1);
  const old = snapshot(door, 1);
  writeDoor(door, 'dA', 2, 0, 2);
  const fresh = snapshot(door, 2);
  const x = createReplica('x');
  merge(x, fresh, 3);
  assert.equal(merge(x, old, 4), 0);
  assert.equal(x.doors.dA.ab, 2);
});

test('age survives a relay, with no shared clock', () => {
  const src = createReplica('src');
  writeReport(src, 'A', 'room-A', { state: 'empty', count: 0 }, 100);
  const relay = createReplica('relay');
  merge(relay, snapshot(src, 104), 5000); // relay's clock is unrelated
  const dst = createReplica('dst');
  merge(dst, snapshot(relay, 5010), 77, 1); // held 10 s, 1 s in flight
  assert.equal(77 - dst.reports['A|room-A'].at, 15);
});

test('a person who changes room during a partition is counted once after merge', () => {
  // Two people enter Lab 1. During a partition one walks Lab 1 -> Lab 2.
  const west = createReplica('west');
  const east = createReplica('east');
  allDoors(west, 0, { dW: [2, 0], dA: [2, 0] });
  merge(east, snapshot(west, 0), 0);
  // Partition. The internal door's node is on the east side.
  writeDoor(east, 'dAB', 1, 0, 5);
  writeDoor(west, 'dA', 2, 0, 5); // heartbeat only
  // Heal.
  merge(west, snapshot(east, 6), 6);
  merge(east, snapshot(west, 6), 6);
  for (const rep of [west, east]) {
    const a = roomBelief(rep, 'A', 6);
    const b = roomBelief(rep, 'B', 6);
    assert.equal(a.doorCount, 1);
    assert.equal(b.doorCount, 1);
    assert.equal(a.doorCount + b.doorCount, 2);
  }
});

test('confirmed empty needs a fresh sensor reading and fresh, agreeing doors', () => {
  const rep = createReplica('n');
  allDoors(rep, 0);
  writeReport(rep, 'A', 'room-A', { state: 'empty', count: 0, conf: 0.9 }, 0);
  assert.equal(roomBelief(rep, 'A', 1).state, 'empty');

  const noDoors = createReplica('n2');
  writeReport(noDoors, 'A', 'room-A', { state: 'empty', count: 0 }, 0);
  assert.equal(roomBelief(noDoors, 'A', 1).state, 'unknown');
});

test('an empty claim decays to unknown on its own', () => {
  const rep = createReplica('n');
  allDoors(rep, 0);
  writeReport(rep, 'A', 'room-A', { state: 'empty', count: 0 }, 0);
  assert.equal(roomBelief(rep, 'A', PARAMS.STALE + 1).state, 'unknown');
});

test('a sighting never becomes empty by ageing', () => {
  const rep = createReplica('n');
  allDoors(rep, 0);
  writeReport(rep, 'A', 'room-A', { state: 'still', count: 1 }, 0);
  assert.equal(roomBelief(rep, 'A', 1).state, 'still');
  for (const t of [PARAMS.FRESH + 1, PARAMS.STALE + 1, 10000]) {
    assert.equal(roomBelief(rep, 'A', t).state, 'possible');
  }
});

test('one sighting outweighs an older empty report from another writer', () => {
  const rep = createReplica('n');
  allDoors(rep, 9);
  writeReport(rep, 'A', 'R1', { state: 'empty', count: 0 }, 5);
  writeReport(rep, 'A', 'room-A', { state: 'still', count: 1 }, 9);
  assert.equal(roomBelief(rep, 'A', 10).state, 'still');
});

test('doors and sensor disagreeing gives possibly occupied, with the reason', () => {
  const rep = createReplica('n');
  allDoors(rep, 0, { dW: [1, 0], dA: [1, 0] });
  writeReport(rep, 'A', 'room-A', { state: 'empty', count: 0 }, 0);
  const b = roomBelief(rep, 'A', 1);
  assert.equal(b.state, 'possible');
  assert.match(b.why, /Doors count 1/);
});

test('a responder search overrides drifted door counters, then decays', () => {
  const rep = createReplica('n');
  allDoors(rep, 0, { dW: [1, 0], dD: [1, 0] }); // a missed exit left the count at 1
  writeReport(rep, 'D', 'room-D', { state: 'empty', count: 0, kind: 'sensor' }, 0);
  assert.equal(roomBelief(rep, 'D', 1).state, 'possible');
  writeReport(rep, 'D', 'R1', { state: 'empty', count: 0, conf: 0.98, kind: 'search' }, 2);
  allDoors(rep, 3, { dW: [1, 0], dD: [1, 0] });
  writeReport(rep, 'D', 'room-D', { state: 'empty', count: 0, kind: 'sensor' }, 3); // the sensor keeps reporting after the search
  const b = roomBelief(rep, 'D', 3);
  assert.equal(b.state, 'empty');
  assert.match(b.why, /Searched by Responder 1/);
  assert.notEqual(roomBelief(rep, 'D', 2 + PARAMS.EMPTY_STALE * 3 + 1).state, 'empty');
});

test('a brief sensor miss does not clear a room where someone was just seen', () => {
  const rep = createReplica('n');
  allDoors(rep, 10);
  writeReport(rep, 'A', 'room-A', { state: 'still', count: 1, kind: 'sensor' }, 5);
  writeReport(rep, 'A', 'room-A2', { state: 'empty', count: 0, kind: 'sensor' }, 9);
  assert.notEqual(roomBelief(rep, 'A', 10).state, 'empty');
  writeReport(rep, 'A', 'room-A2', { state: 'empty', count: 0, kind: 'sensor' }, 5 + PARAMS.HOLD + 1);
  allDoors(rep, 5 + PARAMS.HOLD + 1);
  assert.equal(roomBelief(rep, 'A', 5 + PARAMS.HOLD + 1).state, 'empty');
});

test('no records means unknown everywhere, never empty', () => {
  const belief = buildingBelief(createReplica('n'), 0);
  for (const id of ROOM_IDS) assert.equal(belief[id].state, 'unknown');
  assert.equal(headcount(belief).unknown, ROOM_IDS.length);
});

test('responders with the same belief choose different rooms without talking', () => {
  const rep = createReplica('n');
  allDoors(rep, 0);
  writeReport(rep, 'C', 'room-C', { state: 'still', count: 1 }, 0);
  writeReport(rep, 'F', 'room-F', { state: 'moving', count: 2 }, 0);
  const belief = buildingBelief(rep, 1);
  const team = [
    { id: 'R1', room: 'COR', x: 100, y: 300 },
    { id: 'R2', room: 'COR', x: 120, y: 300 },
  ];
  const mine = assign(belief, team).R1;
  const theirs = assign(belief, [...team].reverse()).R2;
  assert.notEqual(mine, theirs);
  assert.deepEqual(new Set([mine, theirs]), new Set(['C', 'F']));
});

test('routes go through doors', () => {
  assert.deepEqual(route('A', 'B'), ['dAB']);
  assert.deepEqual(route('OUT', 'A'), ['dW', 'dA']);
});

import { directions } from '../src/core/directions.js';

test('directions from the entrance to the Seminar', () => {
  const text = directions('OUT', 'C').join(' ');
  assert.match(text, /west entrance/);
  assert.match(text, /east along the corridor/);
  assert.match(text, /Seminar is the 3rd door on your left/);
});

test('directions turn the right way when leaving a room', () => {
  // Workshop is south of the corridor; leaving it you face north, so east is a right turn.
  const text = directions('D', 'C').join(' ');
  assert.match(text, /Leave Workshop by its north door/);
  assert.match(text, /Turn right and head east/);
  assert.match(text, /Seminar is the (\d)(st|nd|rd|th) door on your left/);
});

test('exit directions pick the nearer end', () => {
  assert.match(directions('D', 'OUT').join(' '), /west exit/);
  assert.match(directions('F', 'OUT').join(' '), /east exit/);
});

test('rooms on fire are routed around, or reported as unreachable', () => {
  assert.match(directions('A', 'B').join(' '), /Go through the door in the east wall into Lab 2/);
  assert.match(directions('OUT', 'C', { avoid: new Set(['COR']) }).join(' '), /no route/);
});

import { DEFAULT_LAYOUT, normalise, validateLayout, fromRaw } from '../src/core/layout.js';
import { setBuilding, DOORS, ROOMS } from '../src/core/building.js';
import { createSim } from '../src/sim/sim.js';

// A second, very different building: an L-shaped ground floor with a lobby,
// one exit on the north wall, and a room reached only through another room.
const SECOND = {
  name: 'Library wing',
  rooms: {
    L: { name: 'Lobby', x: 0, y: 0, w: 200, h: 120, hall: true },
    R1: { name: 'Reading room', x: 200, y: 0, w: 240, h: 200 },
    R2: { name: 'Archive', x: 200, y: 200, w: 240, h: 160 },
    S: { name: 'Study', x: 0, y: 120, w: 200, h: 240 },
  },
  doors: {
    x1: { a: 'OUT', b: 'L', x: 100, y: 0 },
    x2: { a: 'L', b: 'R1', x: 200, y: 60 },
    x3: { a: 'R1', b: 'R2', x: 320, y: 200 },
    x4: { a: 'L', b: 'S', x: 100, y: 120 },
  },
};

test('validation catches a room nobody can reach, and a layout with no exit', () => {
  const noDoor = JSON.parse(JSON.stringify(SECOND));
  delete noDoor.doors.x3;
  const v = validateLayout(normalise(noDoor));
  assert.equal(v.ok, false);
  assert.match(v.errors.join(' '), /Archive cannot be reached/);

  const noExit = JSON.parse(JSON.stringify(SECOND));
  delete noExit.doors.x1;
  assert.match(validateLayout(normalise(noExit)).errors.join(' '), /at least one exit/);
});

test('normalise snaps a loose door onto the wall it belongs to and orients exits', () => {
  const loose = JSON.parse(JSON.stringify(SECOND));
  loose.doors.x2 = { a: 'R1', b: 'L', x: 207, y: 66 };
  loose.doors.x1 = { a: 'L', b: 'OUT', x: 96, y: 9 };
  const n = normalise(loose);
  assert.deepEqual([n.doors.x2.x, n.doors.x2.y], [200, 66]);
  assert.deepEqual([n.doors.x1.a, n.doors.x1.b, n.doors.x1.y], ['OUT', 'L', 0]);
  assert.equal(validateLayout(n).ok, true);
});

test('arrays from the photo import become a layout', () => {
  const l = fromRaw({ name: 'x', rooms: [{ id: 'a', name: 'A', x: 0, y: 0, w: 100, h: 100 }], doors: [{ id: 'd', a: 'a', b: 'OUT', x: 50, y: 0 }] });
  assert.equal(l.rooms.a.w, 100);
  assert.equal(l.doors.d.b, 'OUT');
});

test('the whole system runs on a different building', (t) => {
  t.after(() => setBuilding(DEFAULT_LAYOUT));
  assert.equal(validateLayout(normalise(SECOND)).ok, true);
  setBuilding(SECOND);
  assert.deepEqual(route('OUT', 'R2'), ['x1', 'x2', 'x3']);
  assert.match(directions('OUT', 'R2').join(' '), /Enter by the north entrance/);
  assert.match(directions('R2', 'OUT').join(' '), /Lobby/);
  const sim = createSim(3);
  for (let i = 0; i < 600; i++) sim.step(0.1);
  sim.raiseAlarm();
  for (let i = 0; i < 900; i++) sim.step(0.1);
  assert.ok(sim.people.length > 0);
  const post = sim.node('POST').rep;
  assert.ok(Object.keys(post.doors).length >= 4, 'the command post heard the door nodes');
  assert.ok(Object.keys(post.reports).length >= 3, 'and the room sensors');
});

test('the built-in building is restored after that', () => {
  assert.ok(ROOMS.COR && DOORS.dW);
  assert.match(directions('OUT', 'C').join(' '), /Seminar is the 3rd door on your left/);
});

import { roomHazard, blockedDoors } from '../src/core/hazard.js';
import { writeEnv } from '../src/core/replica.js';

test('a counted search corrects door drift for good', () => {
  const rep = createReplica('n');
  allDoors(rep, 0, { dW: [1, 0], dD: [1, 0] }); // one exit was missed: counters say 1 inside
  writeReport(rep, 'D', 'R1', { state: 'empty', count: 0, conf: 0.98, kind: 'search', drift: 1 }, 1);
  // long after the search itself has expired, the sensor alone can confirm empty
  allDoors(rep, 200, { dW: [1, 0], dD: [1, 0] });
  writeReport(rep, 'D', 'room-D', { state: 'empty', count: 0, kind: 'sensor' }, 200);
  assert.equal(roomBelief(rep, 'D', 200).state, 'empty');
  // and a new arrival is still counted on top of the correction
  allDoors(rep, 210, { dW: [2, 0], dD: [2, 0] });
  writeReport(rep, 'D', 'room-D', { state: 'empty', count: 0, kind: 'sensor' }, 210);
  assert.equal(roomBelief(rep, 'D', 210).state, 'possible');
});

test('a sensor that goes silent while hot is presumed burning', () => {
  const rep = createReplica('n');
  writeEnv(rep, 'C', 'room-C', { room: 'C', temp: 240, rate: 12, smoke: 0.5 }, 0);
  assert.equal(roomHazard(rep, 'C', 1).level, 'hot');
  const later = roomHazard(rep, 'C', 30);
  assert.equal(later.level, 'fire');
  assert.match(later.why, /Sensor lost at 240/);
  // a cool sensor going silent is not treated as fire
  writeEnv(rep, 'A', 'room-A', { room: 'A', temp: 24, rate: 0, smoke: 0 }, 0);
  assert.equal(roomHazard(rep, 'A', 30).level, 'ok');
  assert.equal(roomHazard(rep, 'B', 30).level, 'unknown');
});

test('a rising reading is projected forward', () => {
  const rep = createReplica('n');
  writeEnv(rep, 'C', 'room-C', { room: 'C', temp: 90, rate: 20, smoke: 0.2 }, 0);
  assert.equal(roomHazard(rep, 'C', 0).level, 'ok');
  assert.equal(roomHazard(rep, 'C', 3).level, 'hot'); // 90 + 20 x 3 = 150
});

test('responders route around fire and blocked doors, and leave an empty burning room alone', () => {
  const rep = createReplica('n');
  allDoors(rep, 0);
  writeReport(rep, 'B', 'room-B', { state: 'still', count: 1 }, 0);
  writeEnv(rep, 'door:dB', 'R2', { door: 'dB', blocked: true }, 0);
  assert.deepEqual([...blockedDoors(rep)], ['dB']);
  assert.deepEqual(route('OUT', 'B', new Set(), blockedDoors(rep)), ['dW', 'dA', 'dAB']);
  assert.deepEqual(route('OUT', 'B', new Set(['A']), blockedDoors(rep)), []);

  const belief = buildingBelief(rep, 1);
  const team = [{ id: 'R1', room: 'OUT', x: 0, y: 300 }];
  assert.equal(assign(belief, team, { blocked: blockedDoors(rep) }).R1, 'B');
  // Lab 1 burning cuts the only way left into Lab 2
  assert.notEqual(assign(belief, team, { blocked: blockedDoors(rep), hazards: { A: { level: 'fire' } } }).R1, 'B');
  // a burning room with nobody known inside is never chosen
  const fire = { C: { level: 'fire' } };
  for (let i = 0; i < 3; i++) assert.notEqual(assign(belief, team, { hazards: fire }).R1, 'C');
});

test('fire spreads, destroys sensors and blocks doors; a downed firefighter is reached', () => {
  const sim = createSim(5);
  const run = (s) => { for (let i = 0; i < s * 10; i++) sim.step(0.1); };
  run(5);
  sim.raiseAlarm();
  sim.setFireSpeed(3);
  run(25);
  sim.mayday('R2');
  run(120);
  const m = sim.metrics();
  assert.ok(m.sensorsAlive < m.sensorsTotal, 'heat destroyed at least one sensor');
  assert.ok(sim.blocked.size > 0, 'a flashover took out doors');
  assert.ok(m.burning >= 2, 'the fire spread to another room');
  assert.equal(m.safe + m.inside + m.lost, m.total, 'every person is accounted for');
  const r2 = sim.node('R2');
  assert.ok(m.maydays >= 1);
  assert.ok(m.crewRecovered >= 1 || !r2.alive || r2.status === 'mayday', 'the mayday was answered or is still open');
});

import { fromBoxes, repairLayout, sharedWall, photoFrame } from '../src/core/planfit.js';

test('photo boxes map onto the drawing area keeping the photo proportions', () => {
  const f = photoFrame(1200, 800);
  assert.equal(Math.round(f.w), 780); // limited by height: 520 / 800 x 1200
  const l = fromBoxes({ rooms: [{ id: 'A', name: 'A', box_2d: [0, 0, 500, 500] }], doors: [] }, 1200, 800);
  assert.equal(Math.round(l.rooms.A.w), 390);
  assert.equal(Math.round(l.rooms.A.h), 260);
});

test('repair closes small gaps, puts doors on shared walls and adds a missing exit', () => {
  const messy = {
    name: 'messy',
    rooms: {
      H: { name: 'Hall', x: 100, y: 200, w: 600, h: 80, hall: true },
      A: { name: 'Room A', x: 100, y: 60, w: 290, h: 132 }, // 8 short of the hall
      B: { name: 'Room B', x: 396, y: 52, w: 304, h: 143 }, // 5 short, and 6 apart from A
      C: { name: 'Room C', x: 100, y: 289, w: 600, h: 150 }, // 9 below the hall, and no door at all
    },
    doors: {
      d1: { a: 'H', b: 'A', x: 240, y: 230 }, // point in the middle of the hall
      d2: { a: 'B', b: 'H', x: 500, y: 196 },
    },
  };
  const before = validateLayout(normalise(messy));
  assert.equal(before.ok, false);
  const { layout, notes } = repairLayout(messy);
  const after = validateLayout(layout);
  assert.deepEqual(after.errors, []);
  assert.ok(sharedWall(layout.rooms.A, layout.rooms.H), 'A now touches the hall');
  assert.ok(sharedWall(layout.rooms.C, layout.rooms.H), 'C now touches the hall');
  assert.ok(Object.values(layout.doors).some((d) => d.a === 'OUT'), 'an exit was added');
  assert.match(notes.join(' '), /No exit was found/);
  assert.match(notes.join(' '), /Room C, which had no way in/);
});

test('repair drops doors between rooms that do not touch and says so', () => {
  const l = {
    rooms: { A: { name: 'A', x: 0, y: 0, w: 100, h: 100 }, B: { name: 'B', x: 400, y: 0, w: 100, h: 100 } },
    doors: { x: { a: 'OUT', b: 'A', x: 0, y: 50 }, d: { a: 'A', b: 'B', x: 250, y: 50 } },
  };
  const { layout, notes } = repairLayout(l);
  assert.equal(layout.doors.d, undefined);
  assert.match(notes.join(' '), /do not touch/);
  // the clear floor between them gets a corridor, flagged for checking
  assert.match(notes.join(' '), /Added corridor 1" from A to B across clear floor/);
  assert.deepEqual(validateLayout(layout).errors, []);
});

test('repair leaves a room unconnected, and says so, when it is too far from anything', () => {
  const l = {
    rooms: {
      A: { name: 'A', x: 0, y: 0, w: 100, h: 300 },
      W: { name: 'Wall room', x: 100, y: 0, w: 100, h: 300 },
      B: { name: 'B', x: 800, y: 0, w: 100, h: 300 }, // 600 away: too far for a corridor
    },
    doors: { x: { a: 'OUT', b: 'A', x: 0, y: 50 } },
  };
  const { notes } = repairLayout(l);
  assert.match(notes.join(' '), /B could not be connected/);
});

import { toRadio } from '../src/ui/radio.js';

test('the event log becomes radio traffic between command and each firefighter', () => {
  const r = (text) => toRadio({ n: 1, t: 30, text });
  assert.deepEqual(r('Responder 2 heads for Store. Store sensor sees someone not moving.').map((x) => [x.from, x.ff]), [['command', 'R2']]);
  assert.match(r('Responder 2 heads for Store. Store sensor sees someone not moving.')[0].text, /^Search Store\. /);
  assert.deepEqual(r('Responder 1 found 2 in Lab 1').map((x) => [x.from, x.ff, x.text]), [['ff', 'R1', 'Found 2 in Lab 1. Bringing them out.']]);
  const both = r('Responder 3 breaks off to reach Responder 1 in Seminar (silent 41 s)');
  assert.deepEqual(both.map((x) => x.ff), ['R3', 'R1']);
  assert.ok(both.every((x) => x.urgent));
  assert.equal(r('Fire has spread to Corridor')[0].ff, null);
  assert.equal(r('Door A destroyed by heat').length, 0, 'sensor losses are not read out');
  assert.equal(r('To Responder 1: You are already outside.')[0].text, 'You are already outside.');
});

test('firefighters can report and be spoken to from the simulation', () => {
  const sim = createSim(2);
  for (let i = 0; i < 50; i++) sim.step(0.1);
  sim.tell('R1', 'Test message.');
  assert.match(sim.log[0].text, /^To Responder 1: Test message\.$/);
  assert.ok(sim.log[0].n > 0, 'entries are numbered for the radio feed');
  assert.equal(sim.report('R1', 'clear'), false, 'cannot report a room from outside');
});

test('a firefighter can be steered from the phone, refuses a burning room, and goes back to auto', () => {
  const sim = createSim(6);
  const run = (sec) => { for (let i = 0; i < sec * 10; i++) sim.step(0.1); };
  run(5);
  sim.raiseAlarm();
  run(2);
  assert.equal(sim.command('R1', 'B'), 'ok');
  const r1 = sim.node('R1');
  assert.equal(r1.manual, true);
  run(25);
  assert.equal(r1.room, 'B', 'walked to Lab 2 and stayed there');
  assert.equal(r1.target === null || r1.target === 'B', true);
  run(10);
  assert.equal(r1.room, 'B', 'does not wander off while under control');
  // a room it believes is burning is refused, with the reason on its radio
  sim.ignite('E');
  run(15);
  const reply = sim.command('R1', 'E');
  assert.match(reply, /refused|burning|no safe way/i);
  assert.match(sim.log.find((e) => /^To Responder 1:/.test(e.text)).text, /refused/i);
  assert.equal(sim.command('R1', 'AUTO'), 'Back on automatic tasking.');
  assert.equal(r1.manual, false);
});

test('a rescued firefighter is brought out with the rescuer, not on their own', () => {
  for (const seed of [3, 6, 11]) {
    const sim = createSim(seed);
    const step = () => sim.step(0.1);
    for (let i = 0; i < 50; i++) step();
    sim.raiseAlarm();
    // wait until R1 is inside, then down
    for (let i = 0; i < 600 && !(sim.node('R1').room !== 'OUT' && sim.node('R1').status === 'ok'); i++) step();
    if (sim.node('R1').room === 'OUT') continue;
    sim.mayday('R1');
    const downAt = { x: sim.node('R1').x, y: sim.node('R1').y };
    let rescuer = null;
    for (let i = 0; i < 1500 && !rescuer; i++) {
      step();
      const e = sim.log.find((x) => /has reached Responder 1/.test(x.text));
      if (e) rescuer = sim.nodes.find((n) => e.text.startsWith(n.label));
    }
    if (!rescuer) continue;
    const r1 = sim.node('R1');
    assert.ok(Math.hypot(rescuer.x - downAt.x, rescuer.y - downAt.y) < 25, `seed ${seed}: R1 was "reached" from across the room`);
    // from here until they are out, R1 is always in the rescuer's room, beside them
    for (let i = 0; i < 1500 && r1.escort; i++) {
      step();
      assert.equal(r1.room, rescuer.room, `seed ${seed}: R1 left the rescuer`);
      assert.ok(Math.hypot(r1.x - rescuer.x, r1.y - rescuer.y) < 20, `seed ${seed}: R1 is not beside the rescuer`);
    }
    assert.equal(r1.escort, null, `seed ${seed}: never got out`);
    assert.equal(r1.room, 'OUT');
    assert.equal(rescuer.room, 'OUT');
    assert.equal(rescuer.path.length, 0, `seed ${seed}: the rescuer still had somewhere to go`);
    assert.ok(Math.hypot(r1.x - rescuer.x, r1.y - rescuer.y) < 20, `seed ${seed}: R1 stopped short of the assembly point`);
    assert.match(sim.command('R1', 'OUT'), /outside|Holding|refused|low air|cylinder/i);
    return;
  }
  assert.fail('no seed produced a rescue to check');
});

test('a thin corridor drawn over rooms is cut back to their walls, and keeps its doors', () => {
  // Two rooms above a 30-unit corridor that Gemini drew 5 units into them,
  // and a side corridor drawn right over a third room.
  const l = {
    name: 'overlap',
    rooms: {
      A: { name: 'Room A', x: 100, y: 100, w: 100, h: 100 },
      B: { name: 'Room B', x: 200, y: 100, w: 100, h: 100 },
      H: { name: 'Corridor', hall: true, x: 100, y: 195, w: 200, h: 35 },
      C: { name: 'Room C', x: 340, y: 120, w: 60, h: 60 },
      S: { name: 'Side corridor', hall: true, x: 300, y: 100, w: 100, h: 130 },
    },
    doors: {
      d1: { a: 'A', b: 'H', x: 150, y: 200 },
      d2: { a: 'B', b: 'H', x: 250, y: 200 },
      d3: { a: 'OUT', b: 'H', x: 100, y: 215 },
      d4: { a: 'C', b: 'S', x: 340, y: 150 },
      d5: { a: 'H', b: 'S', x: 300, y: 215 },
    },
  };
  const { layout, notes } = repairLayout(l);
  const v = validateLayout(layout);
  assert.equal(v.ok, true, v.errors.join('; '));
  assert.equal(v.warnings.filter((w) => /overlap/.test(w)).length, 0, v.warnings.join('; '));
  assert.ok(Object.values(layout.doors).some((d) => [d.a, d.b].sort().join() === 'A,H'), 'Room A keeps its door to the corridor');
  assert.ok(Object.values(layout.doors).some((d) => [d.a, d.b].sort().join() === 'B,H'), 'Room B keeps its door to the corridor');
  assert.ok(notes.some((n) => /Cut back/.test(n)));
});
