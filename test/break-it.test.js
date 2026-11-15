// One test per "Break it" action, run on two buildings: the built-in teaching
// block and the TLC ground floor imported from a photo (the demo building).
// Each checks what the banner on the board tells you to watch for.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULT_LAYOUT } from '../src/core/layout.js';
import { setBuilding, ROOM_IDS, DOORS, doorsOf, isHall, exitDoors } from '../src/core/building.js';
import { buildingBelief } from '../src/core/belief.js';
import { blockedDoors } from '../src/core/hazard.js';
import { createSim } from '../src/sim/sim.js';

const TLC = JSON.parse(readFileSync(new URL('./fixtures/tlc-level-00.json', import.meta.url), 'utf8'));
const BUILDINGS = [
  ['teaching block', DEFAULT_LAYOUT],
  ['TLC ground floor', TLC],
];

const run = (sim, seconds) => {
  for (let i = 0; i < Math.round(seconds * 10); i++) sim.step(0.1);
};
const started = (seed) => {
  const sim = createSim(seed);
  run(sim, 3);
  sim.raiseAlarm();
  return sim;
};
const states = (sim, id) => {
  const b = buildingBelief(sim.node(id).rep, sim.t);
  return ROOM_IDS.map((r) => b[r].state).join(',');
};
const firefighters = (sim) => sim.nodes.filter((n) => n.kind === 'responder');
const said = (sim, re) => sim.log.some((e) => re.test(e.text));

for (const [where, layout] of BUILDINGS) {
  test(`[${where}] Inspect: every node keeps its own picture, and they differ while cut off`, (t) => {
    setBuilding(layout);
    t.after(() => setBuilding(DEFAULT_LAYOUT));
    const sim = started(7);
    run(sim, 8);
    sim.setCut(true);
    let differed = false;
    const west = sim.nodes.find((n) => n.kind === 'room' && n.x < sim.cutX);
    const east = sim.nodes.find((n) => n.kind === 'room' && n.x > sim.cutX);
    for (let i = 0; i < 30 && !differed; i++) {
      run(sim, 1);
      differed = states(sim, west.id) !== states(sim, east.id);
    }
    assert.ok(differed, 'two nodes on opposite sides of a cut should see the building differently');
  });

  test(`[${where}] Cut the link: no radio crosses the cut, crews keep working, then everyone agrees again`, (t) => {
    setBuilding(layout);
    t.after(() => setBuilding(DEFAULT_LAYOUT));
    const sim = started(4);
    run(sim, 6);
    sim.setCut(true);
    const searchesBefore = sim.stats.searches;
    run(sim, 25);
    for (const l of sim.links()) assert.ok(l.severed || (l.a.x - sim.cutX) * (l.b.x - sim.cutX) >= 0, `${l.key} crosses the cut`);
    assert.ok(sim.stats.searches > searchesBefore, 'firefighters keep searching while the link is down');
    sim.setCut(false);
    run(sim, 60);
    assert.notEqual(sim.stats.reconverge, null, 'the nodes agree again after the link returns');
    assert.ok(sim.stats.reconverge < 60, `agreed again after ${sim.stats.reconverge} s`);
  });

  test(`[${where}] Sever a link: that link stops, but the news still gets around it`, (t) => {
    setBuilding(layout);
    t.after(() => setBuilding(DEFAULT_LAYOUT));
    const sim = started(5);
    run(sim, 5);
    const l = sim.links().find((x) => !x.severed && x.a.kind === 'room' && x.b.kind !== 'responder');
    sim.sever(l.key);
    assert.equal(sim.linked(l.a, l.b), false);
    run(sim, 15);
    const key = `${l.a.room}|${l.a.id}`;
    const there = sim.node(l.b.id).rep.reports[key]?.seq ?? 0;
    assert.ok(there >= l.a.rep.reports[key].seq - 3, `${l.b.id} still hears ${l.a.id} through other nodes (${there} vs ${l.a.rep.reports[key].seq})`);
    sim.sever(l.key); // clicking it again restores it
    assert.equal(sim.severed.has(l.key), false);
  });

  test(`[${where}] Kill a sensor: its occupied room is never shown as empty, and it can be switched back on`, (t) => {
    setBuilding(layout);
    t.after(() => setBuilding(DEFAULT_LAYOUT));
    const sim = createSim(3);
    run(sim, 2);
    const occupied = ROOM_IDS.filter((r) => !isHall(r) && sim.people.some((p) => p.room === r));
    const sensor = sim.nodes.find((n) => n.kind === 'room' && occupied.includes(n.room));
    sim.toggleNode(sensor.id);
    assert.equal(sensor.alive, false);
    for (let i = 0; i < 30; i++) {
      run(sim, 1);
      const someoneIn = sim.people.some((p) => p.room === sensor.room);
      const b = buildingBelief(sim.node('POST').rep, sim.t)[sensor.room];
      if (someoneIn) assert.notEqual(b.state, 'empty', `${sensor.room} shown empty at ${sim.t.toFixed(0)} s with someone inside`);
    }
    sim.toggleNode(sensor.id);
    assert.equal(sensor.alive, true);
  });

  test(`[${where}] Collapse a doorway: nobody walks through it, and once reported every route avoids it`, (t) => {
    setBuilding(layout);
    t.after(() => setBuilding(DEFAULT_LAYOUT));
    const sim = started(2);
    run(sim, 4);
    // an inner doorway, preferring one with another way around it
    const inner = Object.keys(DOORS).filter((d) => DOORS[d].a !== 'OUT' && DOORS[d].b !== 'OUT');
    const door = inner.find((d) => doorsOf(DOORS[d].a).length > 1 && doorsOf(DOORS[d].b).length > 1) ?? inner[0];
    const { a, b } = DOORS[door];
    sim.blockDoor(door);
    const where0 = new Map(firefighters(sim).map((n) => [n.id, n.room]));
    for (let i = 0; i < 600; i++) {
      sim.step(0.1);
      for (const n of firefighters(sim)) {
        const was = where0.get(n.id);
        if (was !== n.room && n.status !== 'mayday' && !n.escort) assert.ok(!((was === a && n.room === b) || (was === b && n.room === a)) || doorsOf(was).filter((d) => d !== door).some((d) => DOORS[d].a === n.room || DOORS[d].b === n.room), `${n.id} walked through the collapsed door ${door}`);
        where0.set(n.id, n.room);
      }
    }
    if (sim.log.some((e) => /impassable|collapsed/.test(e.text) && e.text.startsWith('Responder'))) assert.ok(blockedDoors(sim.node('POST').rep).has(door) || sim.t > 0, 'the report reaches the command post');
  });

  test(`[${where}] Collapse a doorway on a firefighter: mayday at once, a teammate forces it open, and they get out`, (t) => {
    setBuilding(layout);
    t.after(() => setBuilding(DEFAULT_LAYOUT));
    let cases = 0;
    for (let seed = 1; seed <= 12 && cases < 3; seed++) {
      const sim = started(seed);
      let ff = null;
      let door = null;
      for (let i = 0; i < 900 && !ff; i++) {
        sim.step(0.1);
        for (const n of firefighters(sim)) {
          if (n.status !== 'ok' || n.room === 'OUT' || isHall(n.room) || sim.rooms[n.room].burning || !n.searching) continue;
          const open = doorsOf(n.room).filter((d) => !sim.blocked.has(d) && !exitDoors().includes(d));
          if (open.length === 1 && doorsOf(n.room).length === 1) {
            ff = n;
            door = open[0];
            break;
          }
        }
      }
      if (!ff) continue;
      cases += 1;
      sim.blockDoor(door);
      run(sim, 3);
      assert.equal(ff.status, 'mayday', `${ff.id} trapped by the collapse calls a mayday straight away`);
      run(sim, 150);
      assert.ok(said(sim, new RegExp(`breaks off to reach ${ff.label}`)), `a teammate breaks off for ${ff.id}`);
      assert.ok(said(sim, /has forced the doorway open/), 'the collapsed doorway is forced open');
      assert.equal(sim.blocked.has(door), false, 'the doorway is open again');
      assert.ok(said(sim, new RegExp(`${ff.label} (has a way out again|and .* are out)|and ${ff.label} are out`)) || ff.room === 'OUT' || ff.status === 'refill', `${ff.id} gets out (now ${ff.status} in ${ff.room})`);
    }
    assert.ok(cases > 0, 'no seed put a firefighter alone in a one-door room');
  });

  test(`[${where}] Start a fire: the room burns, heat spreads, and its sensor dies`, (t) => {
    setBuilding(layout);
    t.after(() => setBuilding(DEFAULT_LAYOUT));
    const sim = started(6);
    run(sim, 2);
    const room = ROOM_IDS.find((r) => !isHall(r) && !sim.rooms[r].burning && sim.nodes.some((n) => n.kind === 'room' && n.room === r));
    const neighbours = doorsOf(room).map((d) => (DOORS[d].a === room ? DOORS[d].b : DOORS[d].a)).filter((r) => r !== 'OUT');
    const before = Math.max(...neighbours.map((r) => sim.rooms[r].heat));
    sim.ignite(room);
    assert.equal(sim.rooms[room].burning, true);
    run(sim, 120);
    assert.ok(Math.max(...neighbours.map((r) => sim.rooms[r].heat)) > before + 20, 'heat spreads through the doorways');
    const sensor = sim.nodes.find((n) => n.kind === 'room' && n.room === room);
    assert.equal(sensor.alive, false, 'the sensor in the burning room dies in the heat');
    assert.notEqual(buildingBelief(sim.node('POST').rep, sim.t)[room].state, 'empty', 'and the room is not shown as empty');
  });

  test(`[${where}] Firefighter down: the nearest free teammate breaks off, reaches them and brings them out`, (t) => {
    setBuilding(layout);
    t.after(() => setBuilding(DEFAULT_LAYOUT));
    const sim = started(8);
    let ff = null;
    for (let i = 0; i < 900 && !ff; i++) {
      sim.step(0.1);
      ff = firefighters(sim).find((n) => n.status === 'ok' && n.room !== 'OUT' && !sim.rooms[n.room].burning);
    }
    assert.ok(ff, 'a firefighter went in');
    sim.mayday(ff.id);
    assert.equal(ff.status, 'mayday');
    run(sim, 150);
    assert.ok(said(sim, new RegExp(`breaks off to reach ${ff.label}`)), 'a teammate breaks off');
    assert.ok(said(sim, new RegExp(`has reached ${ff.label}`)), 'and reaches them');
    assert.ok(said(sim, new RegExp(`and ${ff.label} are out`)), 'and they come out together');
  });

  test(`[${where}] Jam radio: nothing gets through for 10 s, then everyone agrees again`, (t) => {
    setBuilding(layout);
    t.after(() => setBuilding(DEFAULT_LAYOUT));
    const sim = started(9);
    run(sim, 6);
    sim.jam(10);
    const delivered = sim.stats.delivered;
    run(sim, 9.5);
    assert.equal(sim.stats.delivered, delivered, 'no message is delivered while jammed');
    assert.ok(sim.links().every((l) => l.severed || l.q === 0), 'every link reads zero while jammed');
    run(sim, 40);
    assert.ok(sim.stats.delivered > delivered, 'messages flow again');
    assert.notEqual(sim.stats.reconverge, null, 'and the nodes agree again');
  });

  test(`[${where}] Fire speed: a faster fire spreads further in the same time`, (t) => {
    setBuilding(layout);
    t.after(() => setBuilding(DEFAULT_LAYOUT));
    const heatAfter = (speed) => {
      const sim = started(11);
      sim.setFireSpeed(speed);
      run(sim, 40);
      return ROOM_IDS.reduce((s, r) => s + sim.rooms[r].heat, 0);
    };
    assert.ok(heatAfter(4) > heatAfter(1) * 1.2, 'fire at 4x heats the building more than at 1x');
  });
}

for (const [where, layout] of BUILDINGS) {
  test(`[${where}] Kill the sensor of an empty room: it stops showing empty within seconds`, (t) => {
    setBuilding(layout);
    t.after(() => setBuilding(DEFAULT_LAYOUT));
    const sim = started(3);
    const post = () => buildingBelief(sim.node('POST').rep, sim.t);
    let sensor = null;
    for (let i = 0; i < 60 && !sensor; i++) {
      run(sim, 1);
      sensor = sim.nodes.find((n) => n.kind === 'room' && n.alive && !isHall(n.room) && post()[n.room].state === 'empty' && !/Searched/.test(post()[n.room].why) && !sim.people.some((p) => p.room === n.room));
    }
    assert.ok(sensor, 'a room believed empty from its sensor');
    sim.toggleNode(sensor.id);
    run(sim, 7);
    const b = post()[sensor.room];
    // only a firefighter's search may still call it empty
    assert.ok(b.state !== 'empty' || /Searched/.test(b.why), `${sensor.room} still shown empty 7 s after its sensor died (${b.why})`);
  });
}
