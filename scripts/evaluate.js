// Runs the simulation many times with random failures and measures how the
// design behaves. Usage: node scripts/evaluate.js [runs]
//
// The number that matters most is "unsafe empty": a node shows a room as
// confirmed empty while someone is really in it.

import { createSim } from '../src/sim/sim.js';
import { buildingBelief } from '../src/core/belief.js';
import { ROOM_IDS, ROOMS } from '../src/core/building.js';

const RUNS = Number(process.argv[2] ?? 200);
const SETTLE = 2.5; // seconds a person may have been in a room before a miss counts

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

const total = { checks: 0, unsafe: 0, unsafeStill: 0, unknownWhenOccupied: 0, falseAlarm: 0, emptyChecks: 0, heals: 0, healTime: 0, healMax: 0, finalWrong: 0, runsWithUnsafe: 0 };

for (let run = 0; run < RUNS; run++) {
  const rand = rng(1000 + run);
  const sim = createSim(1 + run);
  const since = {}; // room -> time it last became occupied
  const plan = {
    alarm: 8 + rand() * 12,
    cutOn: 4 + rand() * 20,
    cutOff: 30 + rand() * 30,
    fireSpeed: [1, 1, 2, 3][Math.floor(rand() * 4)],
    jamAt: 15 + rand() * 60,
    fails: Array.from({ length: Math.floor(rand() * 3) }, () => ({ at: 5 + rand() * 40, id: sim.nodes.filter((n) => n.kind === 'door' || n.kind === 'room')[Math.floor(rand() * sim.nodes.filter((n) => n.kind === 'door' || n.kind === 'room').length)].id })),
  };
  let healedAt = null;
  let unsafeThisRun = 0;
  let prevTruth = sim.truth();

  for (let step = 0; step < 1100; step++) {
    sim.step(0.1);
    const t = sim.t;
    if (!sim.alarm && t >= plan.alarm) sim.raiseAlarm();
    if (!sim.cut && t >= plan.cutOn && t < plan.cutOff) sim.setCut(true);
    if (sim.cut && t >= plan.cutOff) {
      sim.setCut(false);
      healedAt = t;
    }
    if (plan.fireSpeed !== 1 && sim.alarm && sim.fireSpeed === 1) sim.setFireSpeed(plan.fireSpeed);
    if (!plan.jammed && t >= plan.jamAt) {
      plan.jammed = true;
      sim.jam(8);
    }
    for (const f of plan.fails) {
      if (!f.done && t >= f.at) {
        f.done = true;
        sim.toggleNode(f.id);
      }
    }

    const truth = sim.truth();
    for (const r of ROOM_IDS) {
      if (truth[r] > 0 && prevTruth[r] === 0) since[r] = t;
    }
    prevTruth = truth;
    if (step % 5 !== 0) continue;

    const still = {};
    for (const p of sim.people) if (p.mode === 'down') still[p.room] = true;

    const views = sim.nodes.filter((n) => n.alive).map((n) => buildingBelief(n.rep, t));
    for (const view of views) {
      for (const r of ROOM_IDS) {
        if (ROOMS[r].hall) continue; // people only pass through; not a search target
        const b = view[r];
        if (truth[r] > 0 && t - (since[r] ?? 0) > SETTLE) {
          total.checks += 1;
          if (b.state === 'empty') {
            total.unsafe += 1;
            unsafeThisRun += 1;
            if (still[r]) total.unsafeStill += 1;
          } else if (b.state === 'unknown') total.unknownWhenOccupied += 1;
        } else if (truth[r] === 0) {
          total.emptyChecks += 1;
          if (b.state === 'still' || b.state === 'occupied') total.falseAlarm += 1;
        }
      }
    }

    // After the link is restored, how long until every live node agrees?
    if (healedAt !== null) {
      const key = (v) => ROOM_IDS.map((r) => v[r].state).join();
      if (views.every((v) => key(v) === key(views[0]))) {
        const took = t - healedAt;
        total.heals += 1;
        total.healTime += took;
        total.healMax = Math.max(total.healMax, took);
        healedAt = null;
      }
    }
  }

  if (unsafeThisRun) total.runsWithUnsafe += 1;
  const mm = sim.metrics();
  total.people = (total.people ?? 0) + mm.total;
  total.safe = (total.safe ?? 0) + mm.safe;
  total.lostPeople = (total.lostPeople ?? 0) + mm.lost;
  total.sensorsDead = (total.sensorsDead ?? 0) + (mm.sensorsTotal - mm.sensorsAlive);
  total.sensorsAll = (total.sensorsAll ?? 0) + mm.sensorsTotal;
  total.maydays = (total.maydays ?? 0) + mm.maydays;
  total.recovered = (total.recovered ?? 0) + mm.crewRecovered;
  total.crewLost = (total.crewLost ?? 0) + mm.crewLost;
  total.dup = (total.dup ?? 0) + mm.duplicateSearches;
  total.searches = (total.searches ?? 0) + mm.searches;
  const end = buildingBelief(sim.node('POST').rep, sim.t);
  const truth = sim.truth();
  for (const r of ROOM_IDS) if (truth[r] > 0 && end[r].state === 'empty') total.finalWrong += 1;
}

const pct = (a, b) => (b ? ((100 * a) / b).toFixed(3) + '%' : 'n/a');
console.log(`Runs: ${RUNS}, each 110 s: spreading fire at 1x to 3x, a link cut, an 8 s radio jam, up to 2 extra sensor failures`);
console.log(`Checks of an occupied room, per node:         ${total.checks}`);
console.log(`  shown as confirmed empty (unsafe):           ${total.unsafe}  (${pct(total.unsafe, total.checks)}) in ${total.runsWithUnsafe} runs`);
console.log(`    of which the person was not moving:        ${total.unsafeStill}`);
console.log(`  shown as unknown:                            ${total.unknownWhenOccupied}  (${pct(total.unknownWhenOccupied, total.checks)})`);
console.log(`Checks of an empty room shown as occupied:     ${total.falseAlarm} of ${total.emptyChecks}  (${pct(total.falseAlarm, total.emptyChecks)})`);
console.log(`Agreement after the link returns:              mean ${(total.healTime / Math.max(1, total.heals)).toFixed(1)} s, worst ${total.healMax.toFixed(1)} s over ${total.heals} heals`);
console.log(`Rooms wrongly empty on the command post at end: ${total.finalWrong}`);
console.log(`People out: ${total.safe} of ${total.people} (${pct(total.safe, total.people)}), lost to the fire: ${total.lostPeople}`);
console.log(`Sensors destroyed by the end: ${total.sensorsDead} of ${total.sensorsAll} (${pct(total.sensorsDead, total.sensorsAll)})`);
console.log(`Firefighter maydays: ${total.maydays}, reached by a teammate: ${total.recovered}, lost in a flashover: ${total.crewLost}`);
console.log(`Searches: ${total.searches}, repeated within 45 s by another firefighter: ${total.dup} (${pct(total.dup, total.searches)})`);
