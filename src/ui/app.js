import { ROOMS, DOORS, ROOM_IDS, DOOR_IDS } from '../core/building.js';
import { buildingBelief, headcount, STATE_LABEL } from '../core/belief.js';
import { priority } from '../core/assign.js';
import { createSim, CUT_X } from '../sim/sim.js';

const $ = (id) => document.getElementById(id);
const NS = 'http://www.w3.org/2000/svg';
const FILL = {
  still: 'url(#p-still)',
  occupied: 'var(--fire-soft)',
  possible: 'url(#p-possible)',
  unknown: 'url(#p-unknown)',
  empty: 'var(--go-soft)',
};

let sim = createSim(7);
let viewer = 'POST';
let speed = 1;
let paused = false;
let showTruth = true;

// ---- static drawing ---------------------------------------------------------
const map = $('map');

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

function drawStatic() {
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

// ---- per-frame drawing --------------------------------------------------------
function nodeMarkup(n) {
  const cls = `node ${n.kind}${n.alive ? '' : ' dead'}${n.id === viewer ? ' sel' : ''}`;
  let body;
  let label = '';
  if (n.kind === 'door') body = `<rect class="body" x="-8" y="-8" width="16" height="16"/>`;
  else if (n.kind === 'room') body = `<circle class="body" r="9"/>`;
  else if (n.kind === 'post') {
    body = `<rect class="body" x="-15" y="-15" width="30" height="30"/>`;
    label = 'CP';
  } else {
    body = `<path class="body" d="M0 -15 L14 11 L-14 11 Z"/>`;
    label = n.id.slice(1);
  }
  const ring = n.kind === 'post' ? 24 : n.kind === 'responder' ? 22 : 16;
  const text = label ? `<text text-anchor="middle" y="${n.kind === 'responder' ? 7 : 5}">${label}</text>` : '';
  const dead = n.alive ? '' : `<path d="M-6 -6 L6 6 M6 -6 L-6 6" stroke="var(--fire)" stroke-width="2.5"/>`;
  return `<g class="${cls}" data-id="${n.id}" transform="translate(${n.x.toFixed(1)} ${n.y.toFixed(1)})" tabindex="0" role="button" aria-label="${n.label}">
    <circle class="ring" r="${ring}"/>${body}${text}${dead}<title>${n.label}${n.alive ? '' : ' (failed)'}</title></g>`;
}

function drawLive() {
  const links = sim.links().map((l) => `<line class="link${l.hot ? ' hot' : ''}${l.a.id === viewer || l.b.id === viewer ? ' mine' : ''}" x1="${l.a.x.toFixed(1)}" y1="${l.a.y.toFixed(1)}" x2="${l.b.x.toFixed(1)}" y2="${l.b.y.toFixed(1)}"/>`).join('');
  const cut = sim.cut
    ? `<line class="cutline" x1="${CUT_X}" y1="20" x2="${CUT_X}" y2="580"/><text class="cutlabel" x="${CUT_X + 8}" y="16">LINK DOWN</text>`
    : '';
  const people = showTruth
    ? sim.people.map((p) => `<circle class="person ${p.mode}" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${p.mode === 'down' ? 7 : 6}"/>`).join('')
    : '';
  const nodes = sim.nodes.map(nodeMarkup).join('');
  $('live').innerHTML = links + cut + people + nodes;
}

// ---- panels -------------------------------------------------------------------
const clock = (t) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const shown = (b) => (b.count === null || b.count === undefined ? '?' : String(b.count));

function drawPanels() {
  const node = sim.node(viewer);
  const belief = calm(buildingBelief(node.rep, sim.t));
  const truth = sim.truth();

  $('viewer-name').textContent = node.label + (node.alive ? '' : ' (failed)');
  $('clock').textContent = clock(sim.t);
  const hc = headcount(belief);
  $('inside').textContent = hc.low === hc.high ? String(hc.low) : `${hc.low} to ${hc.high}`;
  $('truth').textContent = String(Object.values(truth).reduce((a, b) => a + b, 0));
  $('unknowns').textContent = String(hc.unknown);

  for (const id of ROOM_IDS) {
    const b = belief[id];
    $(`fill-${id}`).setAttribute('fill', FILL[b.state]);
    $(`state-${id}`).textContent = STATE_LABEL[b.state];
    $(`count-${id}`).textContent = shown(b);
  }
  const tag = $('fire-tag');
  if (sim.fire) {
    const r = ROOMS[sim.fire.room];
    tag.setAttribute('x', r.x + 14);
    tag.setAttribute('y', r.y + r.h - 14);
    tag.textContent = 'FIRE REPORTED';
  } else tag.textContent = '';

  // search order
  const order = ROOM_IDS.map((id) => ({ id, b: belief[id], p: id === 'COR' ? 0 : priority(belief[id]) })).sort((x, y) => y.p - x.p || ROOM_IDS.indexOf(x.id) - ROOM_IDS.indexOf(y.id));
  let rank = 0;
  $('tally').innerHTML = order
    .map(({ id, b, p }) => {
      const r = p > 0 ? ++rank : '';
      const age = b.age === null || b.age === undefined ? 'no reading' : `age ${Math.round(b.age)} s`;
      return `<li class="${p > 0 ? '' : 'rest'}">
        <span class="rank">${r}</span><span class="tab ${b.state}"></span>
        <span class="what"><span class="name">${ROOMS[id].name}</span><br><span class="state">${STATE_LABEL[b.state]}</span><br><span class="why">${b.why}</span></span>
        <span class="num"><span class="count">${shown(b)}</span><span class="meta">conf ${b.conf}%<br>${age}</span></span>
      </li>`;
    })
    .join('');
  $('brief').textContent = brief(order, hc);

  // who believes what
  const cols = [...sim.nodes].sort((a, b) => rankKind(a) - rankKind(b));
  const beliefs = cols.map((n) => (n.alive ? calm(buildingBelief(n.rep, sim.t)) : null));
  const head = `<tr><th></th><th><span>Truth</span></th>${cols.map((n) => `<th class="${n.id === viewer ? 'sel' : ''}"><span>${short(n)}</span></th>`).join('')}</tr>`;
  const rows = ROOM_IDS.map((id) => {
    const cells = beliefs
      .map((bl) => {
        if (!bl) return '<td class="dead">x</td>';
        const b = bl[id];
        return `<td class="${b.state}" title="${STATE_LABEL[b.state]}">${b.state === 'empty' ? '' : shown(b)}</td>`;
      })
      .join('');
    return `<tr><th>${ROOMS[id].name}</th><td class="truthcell">${truth[id]}</td>${cells}</tr>`;
  }).join('');
  $('matrix').innerHTML = `<table><thead>${head}</thead><tbody>${rows}</tbody></table>
    <p class="matrix-note">Each column is one node's own copy. Columns that differ belong to nodes that have not heard the same news yet.</p>`;

  $('log').innerHTML = sim.log.map((l) => `<li class="${l.kind}"><time>${clock(l.t)}</time><span>${l.text}</span></li>`).join('');
  $('alarm').disabled = sim.alarm;
  $('alarm').textContent = sim.alarm ? 'Alarm active' : 'Raise alarm';
}

// Before the alarm, someone standing still is just someone at a desk.
function calm(belief) {
  if (sim.alarm) return belief;
  for (const b of Object.values(belief)) {
    if (b.state === 'still') {
      b.state = 'occupied';
      b.why = b.why.replace('someone not moving', 'people inside');
    }
  }
  return belief;
}

const rankKind = (n) => ({ post: 0, responder: 1, room: 2, door: 3 })[n.kind];
const short = (n) => (n.kind === 'post' ? 'Post' : n.kind === 'responder' ? n.id : n.kind === 'room' ? ROOMS[n.room].name : n.label);

function brief(order, hc) {
  const top = order.find((o) => o.p > 0 && o.id !== 'COR') ?? order.find((o) => o.p > 0);
  if (!sim.alarm) return `Normal operation. ${hc.low === hc.high ? hc.low : `${hc.low} to ${hc.high}`} people believed inside.`;
  if (!top) return 'Every room is confirmed empty.';
  const name = ROOMS[top.id].name;
  const b = top.b;
  if (b.state === 'still') return `Search ${name} first. ${b.count} not moving, seen ${Math.round(b.age)} s ago.`;
  if (b.state === 'occupied') return `${name}: ${b.count} moving inside, seen ${Math.round(b.age)} s ago.`;
  if (b.state === 'possible') return `Check ${name}. ${b.why}.`;
  return `No reliable reading from ${hc.unknown} ${hc.unknown === 1 ? 'room' : 'rooms'}. Verify ${name} first.`;
}

// ---- controls -----------------------------------------------------------------
$('alarm').addEventListener('click', () => sim.raiseAlarm());
$('cut').addEventListener('click', (e) => {
  sim.setCut(!sim.cut);
  e.currentTarget.setAttribute('aria-pressed', String(sim.cut));
  e.currentTarget.textContent = sim.cut ? 'Restore east link' : 'Cut east link';
});
$('fail').addEventListener('click', () => {
  const n = sim.node(viewer);
  sim.toggleNode(n.kind === 'door' || n.kind === 'room' ? viewer : 'room-E');
});
$('pause').addEventListener('click', (e) => {
  paused = !paused;
  e.currentTarget.setAttribute('aria-pressed', String(paused));
  e.currentTarget.textContent = paused ? 'Resume' : 'Pause';
});
$('speed').addEventListener('click', (e) => {
  speed = speed === 1 ? 2 : speed === 2 ? 4 : 1;
  e.currentTarget.textContent = `Speed ${speed}x`;
});
$('reset').addEventListener('click', () => {
  sim = createSim(7);
  viewer = 'POST';
  $('cut').setAttribute('aria-pressed', 'false');
  $('cut').textContent = 'Cut east link';
  drawPanels();
});
$('show-truth').addEventListener('change', (e) => {
  showTruth = e.currentTarget.checked;
});
function pick(e) {
  const g = e.target.closest?.('.node');
  if (!g) return;
  viewer = g.dataset.id;
  drawPanels();
}
map.addEventListener('click', pick);
map.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    pick(e);
  }
});

// ---- loop ---------------------------------------------------------------------
drawStatic();
drawPanels();
let last = performance.now();
let owed = 0;
let panelAt = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!paused) {
    owed += dt * speed;
    let steps = 0;
    while (owed >= 0.1 && steps++ < 12) {
      sim.step(0.1);
      owed -= 0.1;
    }
  }
  drawLive();
  if (now - panelAt > 250) {
    panelAt = now;
    drawPanels();
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// For scripted checks from the console.
window.rollcall = { get sim() { return sim; }, select: (id) => { viewer = id; drawPanels(); } };
