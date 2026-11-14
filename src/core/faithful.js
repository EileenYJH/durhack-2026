// Checks that an AI rewrite of spoken directions still says the same thing.
// A rewrite that changes "left" to "right", drops a compass direction or a
// door number, or names a different room could send someone the wrong way, so
// anything that does not match exactly is thrown away and the literal steps
// are spoken instead.

const WORDS = /\b(left|right|north|south|east|west|straight|around|\d+(?:st|nd|rd|th))\b/gi;

function count(text) {
  const out = {};
  for (const m of text.toLowerCase().matchAll(WORDS)) out[m[1]] = (out[m[1]] ?? 0) + 1;
  return out;
}

// roomNames: every room name in the building, so a rewrite cannot add or lose one.
export function faithful(original, rewritten, roomNames = []) {
  const a = count(original);
  const b = count(rewritten);
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if ((a[k] ?? 0) !== (b[k] ?? 0)) return { ok: false, why: `"${k}" appears ${b[k] ?? 0} times instead of ${a[k] ?? 0}` };
  const o = original.toLowerCase();
  const w = rewritten.toLowerCase();
  for (const name of roomNames.map((n) => n.toLowerCase())) {
    if (o.includes(name) !== w.includes(name)) return { ok: false, why: `room "${name}" ${w.includes(name) ? 'was added' : 'was dropped'}` };
  }
  if (/\bno route\b/i.test(original) && !/\b(no|not)\b[^.]*\b(route|way)\b/i.test(rewritten)) return { ok: false, why: 'lost the "no route" warning' };
  return { ok: true };
}
