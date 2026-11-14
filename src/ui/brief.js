// The commander's brief: written by Gemini when the server has a key, checked
// against the data before it is shown, and spoken by ElevenLabs. Without keys
// it falls back to a rule-based sentence and the browser's own voice.

import { ROOMS, ROOM_IDS } from '../core/building.js';
import { STATE_LABEL } from '../core/belief.js';
import { priority } from '../core/assign.js';

const ranked = (belief) =>
  ROOM_IDS.filter((id) => id !== 'COR')
    .map((id) => ({ id, b: belief[id], p: priority(belief[id]) }))
    .filter((o) => o.p > 0)
    .sort((x, y) => y.p - x.p);

const range = (hc) => (hc.low === hc.high ? String(hc.low) : `${hc.low} to ${hc.high}`);

export function ruleBrief(belief, hc, alarm) {
  if (!alarm) return `Normal operation. ${range(hc)} people believed inside.`;
  const order = ranked(belief);
  if (!order.length) return 'Every room is confirmed empty.';
  const { id, b } = order[0];
  const name = ROOMS[id].name;
  if (b.state === 'still') return `Search ${name} first. ${b.count} not moving, seen ${Math.round(b.age)} s ago.`;
  if (b.state === 'occupied') return `${name}: ${b.count} moving inside, seen ${Math.round(b.age)} s ago.`;
  if (b.state === 'possible') return `Check ${name}. ${b.why}.`;
  return `No reliable reading from ${hc.unknown} ${hc.unknown === 1 ? 'room' : 'rooms'}. Verify ${name} first.`;
}

function spokenRuleBrief(belief, hc) {
  const order = ranked(belief);
  if (!order.length) return 'Every room is confirmed empty.';
  const say = ({ id, b }) => {
    const name = ROOMS[id].name;
    if (b.state === 'still') return `${name}, ${b.count} not moving`;
    if (b.state === 'occupied') return `${name}, ${b.count} moving`;
    if (b.state === 'possible') return `${name}, possibly ${b.count}`;
    return `${name}, unknown`;
  };
  return `Search order. ${order.map(say).join('. ')}. ${range(hc)} people believed inside.`;
}

function payload(latest) {
  return {
    seen_from: latest.viewer,
    people_believed_inside: { at_least: latest.hc.low, at_most: latest.hc.high, rooms_unknown: latest.hc.unknown },
    rooms: ROOM_IDS.map((id) => {
      const b = latest.belief[id];
      return {
        room: ROOMS[id].name,
        state: STATE_LABEL[b.state],
        people: b.count,
        confidence_percent: b.conf,
        reading_age_seconds: b.age === null || b.age === undefined ? null : Math.round(b.age),
        reason: b.why,
        search_priority: id === 'COR' ? 0 : priority(b),
      };
    }),
  };
}

// A generated brief must never tell a crew that a room is empty when the data
// does not say so. Checked sentence by sentence; a failed check discards it.
export function unsafeClaim(text, belief) {
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    const s = sentence.toLowerCase();
    if (!/\b(empty|clear|cleared|nobody|no one|no people)\b/.test(s)) continue;
    if (/\b(not|unknown|cannot|can't|unconfirmed|never)\b/.test(s)) continue;
    for (const id of ROOM_IDS) {
      if (belief[id].state !== 'empty' && s.includes(ROOMS[id].name.toLowerCase())) return ROOMS[id].name;
    }
  }
  return null;
}

export async function voice(text) {
  try {
    const r = await fetch('/api/speak', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) });
    if (!r.ok) throw new Error('no voice');
    const audio = new Audio(URL.createObjectURL(await r.blob()));
    await audio.play();
    return 'ElevenLabs voice';
  } catch {
    if ('speechSynthesis' in window) {
      speechSynthesis.cancel();
      speechSynthesis.speak(new SpeechSynthesisUtterance(text));
      return 'browser voice';
    }
    return 'no voice available';
  }
}

// Writes and speaks the brief. Returns roughly how many seconds it runs.
export async function deliverBrief(latest, textEl, sourceEl) {
  let text = null;
  let source;
  sourceEl.textContent = 'Writing the brief';
  try {
    const r = await fetch('/api/brief', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload(latest)) });
    if (r.ok) {
      const out = await r.json();
      const bad = unsafeClaim(out.text, latest.belief);
      if (bad) source = `Gemini's brief was discarded: it described ${bad} as empty. Rule-based brief shown`;
      else {
        text = out.text;
        source = `Written by Gemini from ${latest.viewer}'s data`;
      }
    }
  } catch {
    // no server or no network: fall through to the rule-based brief
  }
  if (!text) {
    text = spokenRuleBrief(latest.belief, latest.hc);
    source ??= 'Rule-based brief';
  }
  textEl.textContent = text;
  const spokenBy = await voice(text);
  sourceEl.textContent = `${source}. Read by ${spokenBy}.`;
  return text.split(/\s+/).length / 2.4;
}
