import { ROOMS, ROOM_IDS, initBuilding, isHall, searchRooms, bounds } from '../core/building.js';
import { buildingBelief, headcount, STATE_LABEL } from '../core/belief.js';
import { urgency } from '../core/assign.js';
import { buildingHazard, fireRooms, blockedDoors } from '../core/hazard.js';
import { DOORS } from '../core/building.js';
import { createSim } from '../sim/sim.js';
import { drawStatic, FILL, shown } from './plan.js';
import { ruleBrief, deliverBrief, voice, aiDirections } from './brief.js';
import { directions, routePoints } from '../core/directions.js';
import { toRadio } from './radio.js';
import { getBuilding, exitDoors, innerRoom, wallOf } from '../core/building.js';

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
    else if (n.manual) extra += `<circle class="manual-ring" r="25"/><text class="manual-text" text-anchor="middle" y="-22">PHONE</text>`;
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
  $('live').innerHTML = fire + links + cut + jam + path + people + nodes + focusMarkup();
}

// ---- what just happened -------------------------------------------------------------
// A banner over the plan says what changed and what to watch for, and a pulsing
// outline marks where. The log at the bottom of the page is too far away to notice.
let focus = null; // { until, tone, at: { x, y, r } | { rect } }
let eventTimer = 0;
function notice(title, watch, { tone = 'fire', at = null, seconds = 7 } = {}) {
  const box = $('event');
  box.className = `event ${tone}`;
  $('event-title').textContent = title;
  $('event-watch').innerHTML = watch;
  box.hidden = false;
  clearTimeout(eventTimer);
  eventTimer = setTimeout(() => {
    box.classList.add('fading');
    eventTimer = setTimeout(() => (box.hidden = true), 600);
  }, seconds * 1000);
  if (at) focus = { at, tone, until: performance.now() + Math.min(seconds, 6) * 1000 };
}
function focusMarkup() {
  if (!focus || performance.now() > focus.until) return '';
  const a = typeof focus.at === 'function' ? focus.at() : focus.at;
  if (!a) return '';
  if (a.rect) return `<rect class="focus ${focus.tone}" x="${a.rect.x - 4}" y="${a.rect.y - 4}" width="${a.rect.w + 8}" height="${a.rect.h + 8}"/>`;
  return `<circle class="focus ${focus.tone}" cx="${a.x.toFixed(1)}" cy="${a.y.toFixed(1)}" r="${a.r ?? 30}"/>`;
}
const nodeAt = (id, r) => () => {
  const n = sim.node(id);
  return n && { x: n.x, y: n.y, r };
};
const roomAt = (id) => ({ rect: ROOMS[id] });

// Events the incident produces by itself, announced as they happen.
let seenLog = 0;
let lastReconverge = null;
function announceSim() {
  const fresh = sim.log.filter((e) => e.n > seenLog).reverse();
  if (sim.log.length) seenLog = Math.max(seenLog, sim.log[0].n);
  for (const e of fresh) {
    let m;
    if ((m = e.text.match(/^MAYDAY\. (Responder \d+) is down/))) {
      const id = sim.nodes.find((n) => n.label === m[1])?.id;
      notice(`Mayday: ${id} is down`, 'Watch the <b>nearest free teammate</b>: nobody assigns the rescue, they break off on their own.', { at: id && nodeAt(id, 34) });
    } else if ((m = e.text.match(/^(Responder \d+) breaks off to reach (Responder \d+)/))) {
      const id = sim.nodes.find((n) => n.label === m[1])?.id;
      notice(`${id} breaks off to help`, `It saw the mayday in its own copy. Watch it walk to ${m[2].replace('Responder ', 'R')}.`, { tone: 'go', at: id && nodeAt(id, 30) });
    } else if ((m = e.text.match(/^(Responder \d+) has reached (Responder \d+)/))) {
      const id = sim.nodes.find((n) => n.label === m[1])?.id;
      notice(`${id} has ${m[2].replace('Responder ', 'R')}`, 'They come out <b>together</b>, at the casualty\'s pace, all the way to the assembly point.', { tone: 'go', at: id && nodeAt(id, 36) });
    } else if ((m = e.text.match(/^Flashover in (.+?)\./))) {
      const id = ROOM_IDS.find((r) => ROOMS[r].name === m[1]);
      notice(`Flashover in ${m[1]}`, 'The whole room ignites and its doors are lost. Sensors in it die; the room turns <b>unknown</b>, never empty.', { at: id && roomAt(id) });
    } else if ((m = e.text.match(/^(Responder \d+) is pulling out/))) {
      const id = sim.nodes.find((n) => n.label === m[1])?.id;
      notice(`${id} pulls out on their own`, 'Their way out is heating towards 240°C. They leave while it is still passable, without being told.', { tone: 'hazard', at: id && nodeAt(id, 30) });
    }
  }
  const r = sim.metrics().reconverge;
  if (r !== null && r !== lastReconverge) {
    lastReconverge = r;
    notice(`All nodes agree again after ${r.toFixed(1)} s`, 'Every sensor and firefighter now holds the same picture. Nothing was lost while they could not hear each other.', { tone: 'go' });
  }
}

function drawTicker() {
  $('ticker').innerHTML = sim.log
    .slice(0, 3)
    .map((l) => `<li class="${l.kind}"><time>${clock(l.t)}</time><span>${l.text}</span></li>`)
    .join('');
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
  announceSim();
  drawTicker();
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
$('alarm').addEventListener('click', () => {
  sim.raiseAlarm();
  const fire = ROOM_IDS.find((r) => sim.rooms[r].burning);
  notice('Alarm raised', `Fire in <b>${fire ? ROOMS[fire].name : 'the building'}</b>. People start to leave and the firefighters arrive and split the search between them.`, { at: fire && roomAt(fire) });
});
$('cut').addEventListener('click', (e) => {
  sim.setCut(!sim.cut);
  e.currentTarget.setAttribute('aria-pressed', String(sim.cut));
  e.currentTarget.textContent = sim.cut ? 'Restore the link' : 'Cut the link';
  if (sim.cut) notice('Link down between the two wings', 'Nodes on each side can no longer hear the other side. Watch <b>What each node believes</b>: the columns start to disagree, and rooms on the far side turn <b>unknown</b>. Everyone keeps working.', { at: { rect: { x: sim.cutX - 6, y: bounds().minY, w: 12, h: bounds().maxY - bounds().minY } }, seconds: 9 });
  else notice('Link restored', 'The two sides can hear each other again. The copies merge, and <b>Agreed again after</b> shows how long it took.', { tone: 'go' });
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
$('jam').addEventListener('click', () => {
  sim.jam(10);
  notice('Radio jammed for 10 seconds', 'Nothing gets through: <b>Radio messages lost</b> goes to 100% and the links stop flashing. Every node keeps working from its own copy. When it ends, watch <b>Agreed again after</b>.', { seconds: 10 });
});
$('fire-speed').addEventListener('click', (e) => {
  const next = sim.fireSpeed === 1 ? 2 : sim.fireSpeed === 2 ? 4 : 1;
  sim.setFireSpeed(next);
  e.currentTarget.textContent = `Fire speed ${next}x`;
  notice(`Fire now spreads at ${next}x`, next > 1 ? 'Every second changes the right decision. Watch sensors die and crews pull out sooner.' : 'Back to normal speed.', { tone: next > 1 ? 'fire' : 'go', seconds: 4 });
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
  seenLog = 0;
  lastReconverge = null;
  focus = null;
  $('event').hidden = true;
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
    if (!key) return;
    sim.sever(key);
    const [a, b] = key.split('|').map((k) => sim.node(k));
    const cut = sim.severed.has(key);
    notice(
      cut ? `Radio link cut: ${a.label} ↔ ${b.label}` : `Radio link restored: ${a.label} ↔ ${b.label}`,
      cut ? 'The red dashed line is the lost link. News still gets through <b>around it</b>, passed on by other nodes.' : 'Watch <b>Agreed again after</b> in Live measures.',
      { tone: cut ? 'fire' : 'go', at: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, r: 24 } },
    );
  } else if (mode === 'ignite') {
    // Whatever was clicked (the floor, the room's name, its count, a person),
    // the room is the one under the pointer. The smallest one wins where they nest.
    let room = g && kind === 'room' ? sim.node(id).room : null;
    if (!room && Number.isFinite(e.clientX)) {
      const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(map.getScreenCTM().inverse());
      room = ROOM_IDS.filter((r) => p.x >= ROOMS[r].x && p.x <= ROOMS[r].x + ROOMS[r].w && p.y >= ROOMS[r].y && p.y <= ROOMS[r].y + ROOMS[r].h).sort((a, b) => ROOMS[a].w * ROOMS[a].h - ROOMS[b].w * ROOMS[b].h)[0] ?? null;
    }
    if (!room && e.target.id?.startsWith('fill-')) room = e.target.id.slice(5);
    if (!room) return;
    const was = sim.rooms[room].burning;
    sim.ignite(room);
    if (was) notice(`${ROOMS[room].name} is already burning`, 'Pick another room.', { tone: 'hazard', at: roomAt(room), seconds: 3 });
    else notice(`Fire started in ${ROOMS[room].name}`, 'Heat and smoke spread <b>through the doorways</b>. Sensors die at 250°C and their rooms turn <b>unknown</b>. Watch the firefighters re-plan around it.', { at: roomAt(room) });
  } else if (mode === 'door' && kind === 'door') {
    sim.blockDoor(id);
    notice(`Doorway collapsed: ${sim.node(id).label}`, 'Nobody can pass. The first firefighter to reach it reports it, and from then on <b>every route avoids it</b>.', { at: nodeAt(id, 24) });
  } else if (mode === 'kill' && (kind === 'door' || kind === 'room')) {
    sim.toggleNode(id);
    const n = sim.node(id);
    const room = n.kind === 'room' ? ROOMS[n.room].name : null;
    if (n.alive) notice(`${n.label} back on`, 'It starts reporting again, and its room fills back in.', { tone: 'go', at: nodeAt(id, 24) });
    else notice(`Sensor killed: ${n.label}`, room ? `Watch <b>${room}</b>: with no fresh reading it turns <b>unknown</b> within seconds, never "empty".` : 'This doorway stops counting. The rooms on each side lose their count and turn <b>unknown</b> unless another sensor or a firefighter sees them.', { at: nodeAt(id, 24) });
  } else if (mode === 'mayday' && kind === 'responder') {
    const n = sim.node(id);
    if (n.room === 'OUT' || n.status === 'mayday') {
      notice(`${id} can't go down here`, n.room === 'OUT' ? 'They are outside. Pick a firefighter inside the building.' : 'They are already down.', { tone: 'hazard', at: nodeAt(id, 30), seconds: 3 });
      return;
    }
    sim.mayday(id); // announced by announceSim from the log
  } else if (mode === 'inspect' && id) {
    viewer = id;
    notice(`Now seeing the building as ${sim.node(id).label} believes it`, 'The plan and the right-hand panel show <b>this node\'s own copy</b>. Compare two firefighters during a cut link: their pictures differ.', { tone: 'go', at: nodeAt(id, 30), seconds: 5 });
  } else return;
  drawPanels();
}
// The live layer is redrawn every frame, so the element under the pointer is
// usually replaced before the button comes up and a 'click' never fires.
// Remember what was pressed, and act on release unless the pointer moved (a scroll).
let press = null;
map.addEventListener('pointerdown', (e) => {
  press = e.button === 0 ? { e, x: e.clientX, y: e.clientY } : null;
});
map.addEventListener('pointerup', (e) => {
  const p = press;
  press = null;
  if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) < 10) pick(p.e);
});
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

// ---- firefighter phones ------------------------------------------------------------
// This screen runs the incident. Once a second it sends each firefighter's own
// picture through the server's relay; phones on the same channel show it, and
// can answer back.
const FF_KEY = 'rollcall:ff-channel';
let ffCode = sessionStorage.getItem(FF_KEY);
if (!ffCode) {
  ffCode = Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(Math.random() * 24)]).join('');
  sessionStorage.setItem(FF_KEY, ffCode);
}
const phones = new Map(); // phone id -> { ff, at }
const radioLog = [];
let radioSeen = 0;

function contactWithPost(node) {
  const post = sim.node('POST');
  const seen = new Set([post]);
  const queue = [post];
  while (queue.length) {
    const cur = queue.shift();
    if (cur === node) return true;
    for (const n of sim.nodes) if (!seen.has(n) && sim.linked(cur, n)) (seen.add(n), queue.push(n));
  }
  return false;
}

function crewFeed() {
  // radio traffic from new log entries
  for (const e of [...sim.log].reverse()) {
    if ((e.n ?? 0) <= radioSeen) continue;
    radioSeen = e.n;
    radioLog.push(...toRadio(e));
  }
  if (radioLog.length > 80) radioLog.splice(0, radioLog.length - 80);

  const b = getBuilding();
  const crews = sim.nodes
    .filter((n) => n.kind === 'responder')
    .map((n) => {
      const belief = buildingBelief(n.rep, sim.t);
      const hz = buildingHazard(n.rep, ROOM_IDS, sim.t);
      const avoid = fireRooms(hz);
      const roomName = n.room === 'OUT' ? 'Outside' : ROOMS[n.room].name;
      let goal = null;
      let directive;
      if (!n.alive) directive = 'No contact.';
      else if (n.status === 'mayday') directive = 'MAYDAY. Stay where you are and keep your alarm sounding. Help is coming.';
      else if (n.escort) directive = `Stay with ${sim.node(n.escort).id}. They are bringing you out.`;
      else if (n.status === 'low-air') {
        goal = 'OUT';
        directive = `Withdraw to the nearest safe exit. Air ${Math.round(n.air)}%.`;
      } else if (n.status === 'refill') directive = 'Changing cylinder at the entrance.';
      else if (n.mission) {
        goal = n.target;
        directive = `Reach ${sim.node(n.mission).id} in ${ROOMS[n.target]?.name ?? 'the building'}. Teammate down.`;
      } else if (n.manual && n.target) {
        goal = n.target;
        directive = `Going to ${ROOMS[n.target].name}, your order. ${belief[n.target].why}.`;
      } else if (n.manual) {
        directive = `Under your control in ${roomName}. Tap a room to move.`;
      } else if (n.target) {
        goal = n.target;
        directive = `Search ${ROOMS[n.target].name}. ${belief[n.target].why}.`;
      } else if (!sim.alarm) directive = 'No incident. Standing by.';
      else directive = n.room === 'OUT' ? 'Stand by at the entrance for tasking.' : `Hold in ${roomName} for tasking.`;
      let route = [];
      if (goal && n.room !== goal) {
        avoid.delete(goal);
        if (n.room !== 'OUT') avoid.delete(n.room);
        route = directions(n.room, goal, { avoid });
      }
      // The nearest exit this firefighter believes is not cut off by fire.
      const COMPASS = { N: 'North', S: 'South', E: 'East', W: 'West' };
      const exits = exitDoors()
        .filter((e) => !avoid.has(innerRoom(e)) || innerRoom(e) === n.room)
        .sort((p, q) => Math.hypot(DOORS[p].x - n.x, DOORS[p].y - n.y) - Math.hypot(DOORS[q].x - n.x, DOORS[q].y - n.y));
      const exitName = exits.length ? `${COMPASS[wallOf(innerRoom(exits[0]), exits[0])]} exit` : null;
      const hc = headcount(belief);
      return {
        id: n.id,
        label: n.label,
        alive: n.alive,
        status: n.status,
        manual: n.manual,
        air: Math.round(n.air),
        room: n.room,
        roomName,
        target: n.target,
        x: Math.round(n.x),
        y: Math.round(n.y),
        heatHere: n.room === 'OUT' ? null : Math.round(sim.rooms[n.room].heat),
        directive,
        route,
        contact: n.alive && contactWithPost(n),
        inside: hc.low === hc.high ? String(hc.low) : `${hc.low} to ${hc.high}`,
        burning: Object.values(hz).filter((h) => h.level === 'fire').length,
        unknown: hc.unknown,
        exit: exitName,
        belief: Object.fromEntries(ROOM_IDS.map((id) => [id, { s: belief[id].state, c: belief[id].count ?? 0, h: hz[id].level }])),
        mates: Object.entries(n.rep.claims)
          .filter(([id]) => id !== n.id)
          .map(([id, c]) => ({ id, x: Math.round(c.x), y: Math.round(c.y), age: Math.round(sim.t - c.at) })),
      };
    });
  return { type: 'feed', t: sim.t, alarm: sim.alarm, jammed: sim.t < sim.jamUntil, building: { name: b.name, rooms: b.rooms, doors: b.doors }, crews, radio: radioLog.slice(-50) };
}

function applyPhone(msg) {
  if (!msg || !msg.ff) return;
  phones.set(msg.from ?? msg.ff, { ff: msg.ff, at: Date.now() });
  if (msg.type !== 'cmd') return;
  const n = sim.node(msg.ff);
  if (!n) return;
  if (msg.action === 'mayday') {
    if (n.room === 'OUT') sim.tell(msg.ff, 'You are outside. Mayday not raised.');
    else sim.mayday(msg.ff);
  } else if (msg.action === 'clear' || msg.action === 'found') {
    if (!sim.report(msg.ff, msg.action)) {
      const where = n.room === 'OUT' ? 'outside' : `in ${ROOMS[n.room].name}, a corridor`;
      sim.tell(msg.ff, `You are ${where}. Report from inside the room you searched.`);
    }
  } else if (msg.action === 'goto' && typeof msg.room === 'string') {
    sim.command(msg.ff, msg.room);
  } else if (msg.action === 'auto') {
    sim.command(msg.ff, 'AUTO');
  } else if (msg.action === 'out') {
    const hz = buildingHazard(n.rep, ROOM_IDS, sim.t);
    const avoid = fireRooms(hz);
    if (n.room !== 'OUT') avoid.delete(n.room);
    sim.tell(msg.ff, n.room === 'OUT' ? 'You are already outside.' : directions(n.room, 'OUT', { avoid }).join(' '));
  }
}

(function startPhones() {
  const base = `${location.origin}/firefighter.html?c=${ffCode}`;
  $('ff-code').textContent = ffCode;
  $('ff-link').href = base;
  $('ff-link').textContent = base;
  if (/^(localhost|127\.|\[::1\])/.test(location.hostname)) $('ff-local').textContent = 'This screen is on localhost, so a phone cannot reach it. Open the hosted site on this computer instead (the Railway address), then scan.';
  const src = new EventSource(`/mesh/stream?mesh=${ffCode}&id=board`);
  src.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      applyPhone({ ...msg, from: msg.from });
    } catch {
      // ignore anything that is not ours
    }
  };
  setInterval(() => {
    for (const [k, v] of phones) if (Date.now() - v.at > 12000) phones.delete(k);
    $('ff-count').textContent = String(phones.size);
    if (!phones.size && $('ff-panel').hidden) return; // nobody listening
    fetch(`/mesh/send?mesh=${ffCode}&id=board`, { method: 'POST', body: JSON.stringify(crewFeed()) }).catch(() => {});
  }, 1000);
  let qrDone = false;
  $('ff-open').addEventListener('click', async (e) => {
    const open = $('ff-panel').hidden;
    $('ff-panel').hidden = !open;
    e.currentTarget.setAttribute('aria-expanded', String(open));
    if (open && !qrDone) {
      qrDone = true;
      try {
        await new Promise((ok, bad) => {
          const s = document.createElement('script');
          s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
          s.onload = ok;
          s.onerror = bad;
          document.head.append(s);
        });
        new window.QRCode($('ff-qr'), { text: base, width: 168, height: 168, colorDark: '#14202b', colorLight: '#ffffff' });
      } catch {
        $('ff-qr').textContent = 'QR code unavailable offline. Use the link.';
      }
    }
  });
})();

// For scripted checks from the console.
window.rollcall = { crewFeed: () => crewFeed(), ffCode: () => ffCode, get sim() { return sim; }, select: (id) => { viewer = id; drawPanels(); } };
