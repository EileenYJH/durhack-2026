import { ROOMS, ROOM_IDS, initBuilding, isHall, searchRooms, bounds } from '../core/building.js';
import { buildingBelief, headcount, STATE_LABEL } from '../core/belief.js';
import { priority } from '../core/assign.js';
import { createSim } from '../sim/sim.js';
import { drawStatic, FILL, shown } from './plan.js';
import { ruleBrief, deliverBrief, voice } from './brief.js';
import { directions, routePoints } from '../core/directions.js';

const $ = (id) => document.getElementById(id);
const NS = 'http://www.w3.org/2000/svg';

const source = initBuilding();
let sim = createSim(7);
let viewer = 'POST';
let speed = 1;
let paused = false;
let showTruth = true;
let latest = null;
let shownRoute = null;
let heldUntil = 0;
const briefHeld = () => performance.now() < heldUntil;

const map = $('map');

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
  const cutBounds = bounds();
  const links = sim.links().map((l) => `<line class="link${l.hot ? ' hot' : ''}${l.a.id === viewer || l.b.id === viewer ? ' mine' : ''}" x1="${l.a.x.toFixed(1)}" y1="${l.a.y.toFixed(1)}" x2="${l.b.x.toFixed(1)}" y2="${l.b.y.toFixed(1)}"/>`).join('');
  const cut = sim.cut
    ? `<line class="cutline" x1="${sim.cutX}" y1="${cutBounds.minY - 20}" x2="${sim.cutX}" y2="${cutBounds.maxY + 20}"/><text class="cutlabel" x="${sim.cutX + 8}" y="${cutBounds.minY - 24}">LINK DOWN</text>`
    : '';
  const people = showTruth
    ? sim.people.map((p) => `<circle class="person ${p.mode}" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${p.mode === 'down' ? 7 : 6}"/>`).join('')
    : '';
  const nodes = sim.nodes.map(nodeMarkup).join('');
  const path = shownRoute
    ? `<polyline class="route" points="${shownRoute.map((p) => `${p.x.toFixed(0)},${p.y.toFixed(0)}`).join(' ')}"/><circle class="route-end" cx="${shownRoute.at(-1).x}" cy="${shownRoute.at(-1).y}" r="9"/>`
    : '';
  $('live').innerHTML = links + cut + path + people + nodes;
}

// ---- panels -------------------------------------------------------------------
const clock = (t) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

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
  const order = ROOM_IDS.map((id) => ({ id, b: belief[id], p: isHall(id) ? 0 : priority(belief[id]) })).sort((x, y) => y.p - x.p || ROOM_IDS.indexOf(x.id) - ROOM_IDS.indexOf(y.id));
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
  latest = { belief, hc, alarm: sim.alarm, viewer: node.label };
  if (!briefHeld()) $('brief').textContent = ruleBrief(belief, hc, sim.alarm);

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

// ---- controls -----------------------------------------------------------------
$('alarm').addEventListener('click', () => sim.raiseAlarm());
$('cut').addEventListener('click', (e) => {
  sim.setCut(!sim.cut);
  e.currentTarget.setAttribute('aria-pressed', String(sim.cut));
  e.currentTarget.textContent = sim.cut ? 'Restore the link' : 'Cut the link';
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
  $('cut').textContent = 'Cut the link';
  drawPanels();
});
$('speak').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  heldUntil = performance.now() + 60000;
  const done = await deliverBrief(latest, $('brief'), $('brief-source'));
  heldUntil = performance.now() + Math.max(4000, done * 1000);
  btn.disabled = false;
});
const places = [['OUT', 'Outside (entrance)'], ...ROOM_IDS.map((r) => [r, ROOMS[r].name])];
$('g-from').innerHTML = places.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
$('g-to').innerHTML = '<option value="top">Top of the search order</option>' + places.map(([v, l]) => `<option value="${v}">${v === 'OUT' ? 'Outside (assembly point)' : l}</option>`).join('');
$('guide').addEventListener('submit', async (e) => {
  e.preventDefault();
  const from = $('g-from').value;
  let to = $('g-to').value;
  if (to === 'top') {
    const belief = buildingBelief(sim.node(viewer).rep, sim.t);
    to = searchRooms().map((r) => ({ r, p: priority(belief[r]) })).sort((a, b) => b.p - a.p)[0]?.r ?? 'OUT';
  }
  const avoid = new Set(sim.fire ? [sim.fire.room] : []);
  const steps = directions(from, to, { avoid });
  shownRoute = steps.some((t) => t.startsWith('There is no route')) ? null : routePoints(from, to, { avoid });
  $('g-text').textContent = steps.join(' ');
  $('g-go').disabled = true;
  await voice(steps.join(' '));
  $('g-go').disabled = false;
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
drawStatic(map);
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
