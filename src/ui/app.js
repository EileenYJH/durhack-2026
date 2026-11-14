import { ROOMS, ROOM_IDS, initBuilding, isHall, searchRooms, bounds } from '../core/building.js';
import { buildingBelief, headcount, STATE_LABEL } from '../core/belief.js';
import { urgency } from '../core/assign.js';
import { buildingHazard, fireRooms, blockedDoors } from '../core/hazard.js';
import { DOORS } from '../core/building.js';
import { createSim } from '../sim/sim.js';
import { drawStatic, FILL, shown } from './plan.js';
import { ruleBrief, deliverBrief, voice, aiDirections } from './brief.js';
import { directions, routePoints } from '../core/directions.js';

const $ = (id) => document.getElementById(id);
const NS = 'http://www.w3.org/2000/svg';

const source = initBuilding();
let sim = createSim(7);
let viewer = 'POST';
let speed = 1;
let paused = false;
let showTruth = true;
let mode = 'inspect';
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
  let extra = '';
  if (n.kind === 'responder') {
    const w = Math.max(0, Math.min(1, n.air / 100)) * 30;
    extra = `<rect class="air-track" x="-15" y="17" width="30" height="4"/><rect class="air${n.air < 30 ? ' low' : ''}" x="-15" y="17" width="${w.toFixed(1)}" height="4"/>`;
    if (n.status === 'mayday') extra += `<circle class="mayday-ring" r="26"/><text class="mayday-text" text-anchor="middle" y="-22">MAYDAY</text>`;
  }
  return `<g class="${cls}${n.status === 'mayday' ? ' mayday' : ''}" data-id="${n.id}" transform="translate(${n.x.toFixed(1)} ${n.y.toFixed(1)})" tabindex="0" role="button" aria-label="${n.label}">
    <circle class="ring" r="${ring}"/>${body}${text}${dead}${extra}<title>${n.label}${n.alive ? '' : ' (failed)'}</title></g>`;
}

function drawLive() {
  const cutBounds = bounds();
  const xy = (l) => `x1="${l.a.x.toFixed(1)}" y1="${l.a.y.toFixed(1)}" x2="${l.b.x.toFixed(1)}" y2="${l.b.y.toFixed(1)}"`;
  const links = sim
    .links()
    .map((l) => {
      if (l.severed) return `<line class="link severed" ${xy(l)}/>${mode === 'sever' ? `<line class="linkhit" data-link="${l.key}" ${xy(l)}/>` : ''}`;
      const weak = l.q < 0.6 ? ' weak' : '';
      return `<line class="link${l.hot ? ' hot' : ''}${weak}${l.a.id === viewer || l.b.id === viewer ? ' mine' : ''}" ${xy(l)}/>${mode === 'sever' ? `<line class="linkhit" data-link="${l.key}" ${xy(l)}/>` : ''}`;
    })
    .join('');
  // What is really happening: heat, smoke and lost doorways. Simulation only.
  let fire = '';
  if (showTruth) {
    for (const id of ROOM_IDS) {
      const r = ROOMS[id];
      const t = sim.rooms[id];
      const glow = Math.max(0, Math.min(0.62, (t.heat - 60) / 900));
      if (t.smoke > 0.03) fire += `<rect class="smoke" x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" opacity="${(t.smoke * 0.42).toFixed(2)}"/>`;
      if (glow > 0) fire += `<rect class="heat${t.burning ? ' burning' : ''}" x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" opacity="${glow.toFixed(2)}"/>`;
      if (t.heat > 45) fire += `<text class="temp" x="${r.x + 14}" y="${r.y + r.h - 14}">${t.flashed ? 'FLASHOVER ' : t.burning ? 'FIRE ' : ''}${Math.round(t.heat)}°C</text>`;
    }
    for (const d of sim.blocked) fire += `<path class="lost-door" d="M${DOORS[d].x - 14} ${DOORS[d].y - 14} l28 28 m0 -28 l-28 28"/>`;
  }
  const jam = sim.t < sim.jamUntil ? `<text class="cutlabel" x="${cutBounds.minX}" y="${cutBounds.minY - 24}">RADIO JAMMED ${Math.ceil(sim.jamUntil - sim.t)} s</text>` : '';
  const cut = sim.cut
    ? `<line class="cutline" x1="${sim.cutX}" y1="${cutBounds.minY - 20}" x2="${sim.cutX}" y2="${cutBounds.maxY + 20}"/><text class="cutlabel" x="${sim.cutX + 8}" y="${cutBounds.minY - 24}">LINK DOWN</text>`
    : '';
  const people = showTruth
    ? sim.people.map((p) => (p.mode === 'lost' ? `<path class="person lost" d="M${(p.x - 6).toFixed(1)} ${(p.y - 6).toFixed(1)} l12 12 m0 -12 l-12 12"/>` : `<circle class="person ${p.mode}" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${p.mode === 'down' ? 7 : 6}"/>`)).join('')
    : '';
  const nodes = sim.nodes.map(nodeMarkup).join('');
  const path = shownRoute
    ? `<polyline class="route" points="${shownRoute.map((p) => `${p.x.toFixed(0)},${p.y.toFixed(0)}`).join(' ')}"/><circle class="route-end" cx="${shownRoute.at(-1).x}" cy="${shownRoute.at(-1).y}" r="9"/>`
    : '';
  $('live').innerHTML = fire + links + cut + jam + path + people + nodes;
}

// ---- panels -------------------------------------------------------------------
const clock = (t) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

function drawPanels() {
  const node = sim.node(viewer);
  const belief = calm(buildingBelief(node.rep, sim.t));
  const hazards = buildingHazard(node.rep, ROOM_IDS, sim.t);
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

  // search order
  const order = ROOM_IDS.map((id) => ({ id, b: belief[id], p: isHall(id) ? 0 : urgency(belief[id], hazards[id]), h: hazards[id] })).sort((x, y) => y.p - x.p || ROOM_IDS.indexOf(x.id) - ROOM_IDS.indexOf(y.id));
  let rank = 0;
  $('tally').innerHTML = order
    .map(({ id, b, p, h }) => {
      const r = p > 0 ? ++rank : '';
      const heat = h.level === 'unknown' || (h.level === 'ok' && !sim.alarm) ? '' : `<br><span class="heat-line ${h.level}">${h.level === 'fire' ? 'Fire. ' : h.level === 'hot' ? 'Hot. ' : 'Heat '}${h.why}</span>`;
      const age = b.age === null || b.age === undefined ? 'no reading' : `age ${Math.round(b.age)} s`;
      return `<li class="${p > 0 ? '' : 'rest'}">
        <span class="rank">${r}</span><span class="tab ${b.state}"></span>
        <span class="what"><span class="name">${ROOMS[id].name}</span><br><span class="state">${STATE_LABEL[b.state]}</span><br><span class="why">${b.why}</span>${heat}</span>
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

  // live measures
  const m = sim.metrics();
  const ages = ROOM_IDS.map((id) => belief[id].age).filter((a) => a !== null && a !== undefined);
  const stale = ages.length ? ages.reduce((a, b) => a + b, 0) / ages.length : null;
  const cell = (label, value, cls = '') => `<div class="${cls}"><dt>${label}</dt><dd>${value}</dd></div>`;
  $('metrics').innerHTML =
    cell('People out', `${m.safe} of ${m.total}`) +
    cell('Still inside', m.inside, m.inside ? 'warn' : '') +
    cell('Collapsed', m.down, m.down ? 'bad' : '') +
    cell('Lost', m.lost, m.lost ? 'bad' : '') +
    cell('Rooms burning', m.burning, m.burning ? 'bad' : '') +
    cell('Sensors alive', `${m.sensorsAlive} of ${m.sensorsTotal}`, m.sensorsAlive < m.sensorsTotal ? 'warn' : '') +
    cell('Radio messages lost', `${Math.round(m.dropRate * 100)}%`, m.dropRate > 0.2 ? 'warn' : '') +
    cell('Firefighters down', m.crewDown, m.crewDown ? 'bad' : '') +
    cell('Searches', m.searches) +
    cell('Repeated searches', m.duplicateSearches) +
    cell(`Reading age, ${short(node)}`, stale === null ? 'none' : `${stale.toFixed(1)} s`) +
    cell('Agreed again after', m.reconverge === null ? 'no outage yet' : `${m.reconverge.toFixed(1)} s`);

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
const MODE_HELP = {
  inspect: 'Click a sensor or firefighter to see the building as it believes it.',
  sever: 'Click a radio link to cut it. Click a cut link to restore it.',
  door: 'Click a door sensor to collapse that doorway.',
  kill: 'Click a sensor to switch it off, or back on.',
  ignite: 'Click a room to start a fire there.',
  mayday: 'Click a firefighter who is inside the building.',
};
function setMode(next) {
  mode = next;
  for (const b of document.querySelectorAll('[data-mode]')) b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
  $('mode-help').textContent = MODE_HELP[mode];
  map.dataset.mode = mode;
}
for (const b of document.querySelectorAll('[data-mode]')) b.addEventListener('click', () => setMode(b.dataset.mode));
$('jam').addEventListener('click', () => sim.jam(10));
$('fire-speed').addEventListener('click', (e) => {
  const next = sim.fireSpeed === 1 ? 2 : sim.fireSpeed === 2 ? 4 : 1;
  sim.setFireSpeed(next);
  e.currentTarget.textContent = `Fire speed ${next}x`;
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
  $('fire-speed').textContent = 'Fire speed 1x';
  shownRoute = null;
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
    const hz = buildingHazard(sim.node(viewer).rep, ROOM_IDS, sim.t);
    to = searchRooms().map((r) => ({ r, p: urgency(belief[r], hz[r]) })).sort((a, b) => b.p - a.p)[0]?.r ?? 'OUT';
  }
  // Route around what this node believes is burning, not around the truth.
  const avoid = fireRooms(buildingHazard(sim.node(viewer).rep, ROOM_IDS, sim.t));
  avoid.delete(to);
  const steps = directions(from, to, { avoid });
  shownRoute = steps.some((t) => t.startsWith('There is no route')) ? null : routePoints(from, to, { avoid });
  $('g-text').textContent = steps.join(' ');
  $('g-go').disabled = true;
  const spoken = await aiDirections(steps);
  await voice(spoken);
  $('g-go').disabled = false;
});
$('show-truth').addEventListener('change', (e) => {
  showTruth = e.currentTarget.checked;
});
function pick(e) {
  const g = e.target.closest?.('.node');
  const id = g?.dataset.id;
  const kind = id ? sim.node(id).kind : null;
  if (mode === 'sever') {
    const key = e.target.closest?.('.linkhit')?.dataset.link;
    if (key) sim.sever(key);
  } else if (mode === 'ignite') {
    const room = e.target.id?.startsWith('fill-') ? e.target.id.slice(5) : g && kind === 'room' ? sim.node(id).room : null;
    if (room) sim.ignite(room);
  } else if (mode === 'door' && kind === 'door') sim.blockDoor(id);
  else if (mode === 'kill' && (kind === 'door' || kind === 'room')) sim.toggleNode(id);
  else if (mode === 'mayday' && kind === 'responder') sim.mayday(id);
  else if (mode === 'inspect' && id) viewer = id;
  else return;
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
setMode('inspect');
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
