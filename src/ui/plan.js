// The floor plan drawing, shared by the simulation and live pages.
import { ROOMS, DOORS, ROOM_IDS, DOOR_IDS } from '../core/building.js';

export const FILL = {
  still: 'url(#p-still)',
  occupied: 'var(--fire-soft)',
  possible: 'url(#p-possible)',
  unknown: 'url(#p-unknown)',
  empty: 'var(--go-soft)',
};

export const shown = (b) => (b.count === null || b.count === undefined ? '?' : String(b.count));


function doorMarkup(id) {
  const d = DOORS[id];
  const vertical = id === 'dAB' || id === 'dW' || id === 'dX';
  const g = 18;
  if (vertical) {
    return `<line class="gap" x1="${d.x}" y1="${d.y - g}" x2="${d.x}" y2="${d.y + g}"/>
      <path class="leaf" d="M${d.x} ${d.y - g} l${2 * g} 0 M${d.x + 2 * g} ${d.y - g} a${2 * g} ${2 * g} 0 0 1 ${-2 * g} ${2 * g}"/>`;
  }
  const up = d.y === 250 ? -1 : 1;
  return `<line class="gap" x1="${d.x - g}" y1="${d.y}" x2="${d.x + g}" y2="${d.y}"/>
    <path class="leaf" d="M${d.x - g} ${d.y} l0 ${up * 2 * g} M${d.x - g} ${d.y + up * 2 * g} a${2 * g} ${2 * g} 0 0 ${up < 0 ? 1 : 0} ${2 * g} ${-up * 2 * g}"/>`;
}

export function drawStatic(map) {
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
    if (id === 'COR') {
      return `<text class="room-name" x="${r.x + 300}" y="${r.y + 24}">${r.name}</text>
        <text class="room-state" id="state-${id}" x="${r.x + 300}" y="${r.y + 42}"></text>
        <text class="room-count" id="count-${id}" x="${r.x + 430}" y="${r.y + 62}" style="font-size:40px"></text>`;
    }
    return `<text class="room-name" x="${r.x + 14}" y="${r.y + 28}">${r.name}</text>
      <text class="room-state" id="state-${id}" x="${r.x + 14}" y="${r.y + 47}"></text>
      <text class="room-count" id="count-${id}" x="${r.x + r.w - 16}" y="${r.y + r.h - 16}" text-anchor="end"></text>`;
  }).join('');
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
    <rect class="assembly" x="-112" y="372" width="104" height="24"/>
    <text class="assembly-text" x="-60" y="389" text-anchor="middle">ASSEMBLY</text>
    <rect class="assembly" x="950" y="372" width="104" height="24"/>
    <text class="assembly-text" x="1002" y="389" text-anchor="middle">ASSEMBLY</text>
    ${rooms}${walls}${DOOR_IDS.map(doorMarkup).join('')}${labels}
    <text class="fire-tag" id="fire-tag" x="0" y="0"></text>
    <g id="live"></g>`;
}

