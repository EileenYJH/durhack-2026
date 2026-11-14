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
  assert.notEqual(roomBelief(rep, 'D', 2 + PARAMS.STALE * 3 + 1).state, 'empty');
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
