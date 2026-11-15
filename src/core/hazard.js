// What a node believes about heat and blocked doors, from the environment
// records it holds. Like occupancy belief, this is a pure function of the
// node's own records and clock.
//
// The rule that matters: a room sensor that was reading hot and then went
// silent is presumed to have burned. Silence after heat is treated as fire,
// not as "no reading".

export const HEAT = {
  HOT: 120, // uncomfortable, getting dangerous
  FIRE: 300, // the room is burning
  FLASH: 600, // flashover: nothing in the room survives, its doors are lost
  SENSOR: 250, // a room sensor fails
  DOOR: 320, // a door sensor fails
  LETHAL: 200, // a person without protection cannot stay
  REFUSE: 450, // a firefighter will not enter
};

const SILENT = 6; // seconds without a reading before a sensor counts as silent
const CARRIED = 20; // seconds a firefighter's own reading of a room stays useful

export function roomHazard(rep, roomId, now) {
  let best = null;
  for (const rec of Object.values(rep.env ?? {})) {
    if (rec.room !== roomId) continue;
    const age = now - rec.at;
    const fixed = String(rec.writer).startsWith('room-');
    if (!fixed && age > CARRIED) continue;
    if (!best || age < best.age) best = { ...rec, age, fixed };
  }
  if (!best) return { level: 'unknown', temp: null, est: null, age: null, why: 'No heat reading' };

  const rate = Math.max(0, best.rate ?? 0);
  const est = Math.min(900, best.temp + rate * best.age);
  if (best.fixed && best.age > SILENT && best.temp >= 100) {
    return { level: 'fire', temp: best.temp, est, age: best.age, lost: true, why: `Sensor lost at ${Math.round(best.temp)}°C, presumed burning` };
  }
  const level = est >= HEAT.FIRE ? 'fire' : est >= HEAT.HOT ? 'hot' : 'ok';
  const rising = rate > 1 ? ', rising' : '';
  return { level, temp: best.temp, est, age: best.age, rate, why: `${Math.round(est)}°C${level === 'ok' ? '' : rising}` };
}

export function buildingHazard(rep, roomIds, now) {
  const out = {};
  for (const id of roomIds) out[id] = roomHazard(rep, id, now);
  return out;
}

// Doors this node has been told are impassable.
// A doorway is believed blocked if the newest report about it says so: one
// that was forced open again is reported open, and that report wins.
export function blockedDoors(rep) {
  const newest = new Map();
  for (const rec of Object.values(rep.env ?? {})) {
    if (!rec.door) continue;
    const prev = newest.get(rec.door);
    if (!prev || rec.at > prev.at) newest.set(rec.door, rec);
  }
  const out = new Set();
  for (const [door, rec] of newest) if (rec.blocked) out.add(door);
  return out;
}

export const fireRooms = (hazards) => new Set(Object.keys(hazards).filter((id) => hazards[id].level === 'fire'));
