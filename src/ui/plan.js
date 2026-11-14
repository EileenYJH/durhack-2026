// The floor plan drawing, shared by the simulation, live and editor-preview pages.
// It draws whatever building is loaded.

import { ROOMS, DOORS, ROOM_IDS, DOOR_IDS, VEC, bounds, exitDoors, assemblyOf, wallOf } from '../core/building.js';

export const FILL = {
  still: 'url(#p-still)',
  occupied: 'var(--fire-soft)',
  possible: 'url(#p-possible)',
  unknown: 'url(#p-unknown)',
  empty: 'var(--go-soft)',
};

export const shown = (b) => (b.count === null || b.count === undefined ? '?' : String(b.count));

// A door is a gap in the wall with a swinging leaf, opening into room b
// (or room a when b is outside).
function doorMarkup(id) {
  const d = DOORS[id];
  const swing = d.b === 'OUT' ? d.a : d.b;
  const w = wallOf(swing === 'OUT' ? d.b : swing, id);
  const inward = { x: -VEC[w].x, y: -VEC[w].y };
  const g = 18;
  if (w === 'E' || w === 'W') {
    return `<line class="gap" x1="${d.x}" y1="${d.y - g}" x2="${d.x}" y2="${d.y + g}"/>
      <path class="leaf" d="M${d.x} ${d.y - g} l${inward.x * 2 * g} 0 M${d.x + inward.x * 2 * g} ${d.y - g} a${2 * g} ${2 * g} 0 0 ${inward.x > 0 ? 1 : 0} ${-inward.x * 2 * g} ${2 * g}"/>`;
  }
  return `<line class="gap" x1="${d.x - g}" y1="${d.y}" x2="${d.x + g}" y2="${d.y}"/>
    <path class="leaf" d="M${d.x - g} ${d.y} l0 ${inward.y * 2 * g} M${d.x - g} ${d.y + inward.y * 2 * g} a${2 * g} ${2 * g} 0 0 ${inward.y < 0 ? 1 : 0} ${2 * g} ${-inward.y * 2 * g}"/>`;
}

export function drawStatic(map) {
  const b = bounds();
  map.setAttribute('viewBox', `${b.minX - 170} ${b.minY - 40} ${b.maxX - b.minX + 340} ${b.maxY - b.minY + 100}`);

  const rooms = ROOM_IDS.map((id) => {
    const r = ROOMS[id];
    return `<rect class="room-fill" id="fill-${id}" x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}"/>`;
  }).join('');
  const walls = ROOM_IDS.map((id) => {
    const r = ROOMS[id];
    return `<rect class="wall" x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}"/>`;
  }).join('');
  const labels = ROOM_IDS.map((id) => {
    const r = ROOMS[id];
    const name = r.name.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    if (r.hall) {
      const x = r.x + Math.min(300, r.w * 0.34);
      return `<text class="room-name" x="${x}" y="${r.y + 24}">${name}</text>
        <text class="room-state" id="state-${id}" x="${x}" y="${r.y + 42}"></text>
        <text class="room-count" id="count-${id}" x="${x + 130}" y="${r.y + 62}" style="font-size:40px"></text>`;
    }
    return `<text class="room-name" x="${r.x + 14}" y="${r.y + 28}">${name}</text>
      <text class="room-state" id="state-${id}" x="${r.x + 14}" y="${r.y + 47}"></text>
      <text class="room-count" id="count-${id}" x="${r.x + r.w - 16}" y="${r.y + r.h - 16}" text-anchor="end"></text>`;
  }).join('');
  const signs = exitDoors()
    .map((e) => {
      const a = assemblyOf(e);
      return `<rect class="assembly" x="${a.x - 52}" y="${a.y - 12}" width="104" height="24"/>
        <text class="assembly-text" x="${a.x}" y="${a.y + 5}" text-anchor="middle">ASSEMBLY</text>`;
    })
    .join('');

  map.innerHTML = `
    <defs>
      <pattern id="p-still" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="7" height="7" style="fill:var(--fire-soft)"/><rect width="4" height="7" style="fill:var(--fire)"/>
      </pattern>
      <pattern id="p-possible" width="11" height="11" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
        <rect width="11" height="11" style="fill:var(--hazard-soft)"/><rect width="5" height="11" style="fill:var(--hazard)"/>
      </pattern>
      <pattern id="p-unknown" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="1.5" height="6" style="fill:var(--hatch)"/>
      </pattern>
    </defs>
    ${signs}${rooms}${walls}${DOOR_IDS.map(doorMarkup).join('')}${labels}
    <text class="fire-tag" id="fire-tag" x="0" y="0"></text>
    <g id="live"></g>`;
}
