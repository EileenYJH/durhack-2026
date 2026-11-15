// A real node. This page runs on a laptop or phone, keeps its own replica,
// senses with its own camera, and talks to other devices over the mesh.

import { ROOMS, DOORS, ROOM_IDS, DOOR_IDS, initBuilding, isHall } from '../core/building.js';
import { createReplica, writeDoor, writeReport } from '../core/replica.js';
import { buildingBelief, headcount, STATE_LABEL } from '../core/belief.js';
import { priority } from '../core/assign.js';
import { drawStatic, FILL, shown } from '../ui/plan.js';
import { ruleBrief, deliverBrief } from '../ui/brief.js';
import { joinMesh } from './mesh.js';
import { createTracker } from './tracker.js';

initBuilding();
const $ = (id) => document.getElementById(id);
const now = () => Date.now() / 1000;
const roomName = (id) => (id === 'OUT' ? 'Outside' : ROOMS[id].name);
const doorLabel = (id) => `${roomName(DOORS[id].a)} to ${roomName(DOORS[id].b)}`;

let me = null; // { id, role, place, mesh, rep, net }
let latest = null;
let heldUntil = 0;

// ---- join form ----------------------------------------------------------------
const form = $('join-form');
function fillPlaces() {
  const role = form.role.value;
  $('place-field').hidden = role === 'board';
  if (role === 'door') {
    $('place').innerHTML = DOOR_IDS.map((d) => `<option value="${d}">${doorLabel(d)}</option>`).join('');
    $('place-help').textContent = 'Point the camera across the doorway so people cross the frame from side to side.';
  } else if (role === 'room') {
    $('place').innerHTML = ROOM_IDS.map((r) => `<option value="${r}">${ROOMS[r].name}</option>`).join('');
    $('place-help').textContent = 'Office and Store have one door each, so one door camera and one room camera are enough to confirm them empty.';
  }
}
form.addEventListener('change', fillPlaces);
fillPlaces();

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const mesh = form.mesh.value.trim();
  if (!mesh) {
    $('join-error').textContent = 'Enter a mesh code.';
    return;
  }
  const role = form.role.value;
  const place = role === 'board' ? null : form.place.value;
  let id;
  if (role === 'door') id = place;
  else if (role === 'room') id = `room-${place}`;
  else {
    id = localStorage.getItem('rollcall:board-id') ?? `board-${Math.random().toString(36).slice(2, 6)}`;
    localStorage.setItem('rollcall:board-id', id);
  }
  start({ id, role, place, mesh });
});

// ---- start --------------------------------------------------------------------
function start({ id, role, place, mesh }) {
  const key = `rollcall:${mesh}:${id}`;
  const rep = createReplica(id);
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (saved) Object.assign(rep, { doors: saved.doors ?? {}, reports: saved.reports ?? {}, claims: saved.claims ?? {} });
  } catch {
    // a damaged save is ignored; peers will send our own records back
  }
  const net = joinMesh({ mesh, id, rep, now });
  me = { id, role, place, mesh, rep, net, key, flip: false, emptyStreak: 0, tracks: [] };

  $('join').hidden = true;
  $('plan').hidden = false;
  $('board').hidden = false;
  $('me').textContent = role === 'board' ? 'Command board' : role === 'door' ? `Door: ${doorLabel(place)}` : `${ROOMS[place].name} camera`;
  $('radio').disabled = false;
  $('forget').disabled = false;
  drawStatic($('map'));

  setInterval(() => localStorage.setItem(key, JSON.stringify({ doors: rep.doors, reports: rep.reports, claims: rep.claims })), 2000);
  setInterval(tick, 1000);
  setInterval(render, 500);
  render();
  if (role !== 'board') startCamera();
}

// ---- sensing ------------------------------------------------------------------
function tick() {
  if (me.role === 'door') {
    const rec = me.rep.doors[me.place];
    writeDoor(me.rep, me.place, rec?.ab ?? 0, rec?.ba ?? 0, now()); // heartbeat
  } else if (me.role === 'room' && me.cameraReady) {
    const n = me.tracks.length;
    if (n > 0) {
      me.emptyStreak = 0;
      const moving = me.tracks.some((t) => t.moving);
      writeReport(me.rep, me.place, me.id, { state: moving ? 'moving' : 'still', count: n, conf: 0.8, kind: 'sensor' }, now());
    } else if (++me.emptyStreak >= 3) {
      writeReport(me.rep, me.place, me.id, { state: 'empty', count: 0, conf: 0.8, kind: 'sensor' }, now());
    }
  }
}

function crossed(direction) {
  const rec = me.rep.doors[me.place];
  let ab = rec?.ab ?? 0;
  let ba = rec?.ba ?? 0;
  if ((direction > 0) !== me.flip) ab += 1;
  else ba += 1;
  writeDoor(me.rep, me.place, ab, ba, now());
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`could not load ${src}`));
    document.head.append(s);
  });
}

async function startCamera() {
  $('cam').hidden = false;
  $('cam-title').textContent = me.role === 'door' ? 'Door camera' : 'Room camera';
  $('door-tools').hidden = me.role !== 'door';
  const video = $('video');
  const readout = $('readout');
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('This page needs HTTPS or localhost to use the camera.');
    video.srcObject = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
    await video.play();
    readout.textContent = 'Loading the person detector';
    await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js');
    await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js');
    const model = await window.cocoSsd.load({ base: 'lite_mobilenet_v2' });
    me.cameraReady = true;
    detectLoop(model, video);
  } catch (err) {
    readout.textContent = `Camera not running: ${err.message}`;
    readout.classList.add('error');
  }
}

async function detectLoop(model, video) {
  const tracker = createTracker();
  const canvas = $('overlay');
  const ctx = canvas.getContext('2d');
  let frames = 0;
  let since = performance.now();
  let fps = 0;
  for (;;) {
    const found = await model.detect(video, 10, 0.45);
    const people = found.filter((f) => f.class === 'person');
    const w = video.videoWidth || 640;
    const h = video.videoHeight || 480;
    const dets = people.map((p) => ({ x: (p.bbox[0] + p.bbox[2] / 2) / w, y: (p.bbox[1] + p.bbox[3] / 2) / h }));
    const out = tracker.update(dets, now());
    me.tracks = out.tracks;
    if (me.role === 'door') out.crossings.forEach(crossed);

    canvas.width = w;
    canvas.height = h;
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#f2bd2b';
    for (const p of people) ctx.strokeRect(...p.bbox);
    if (me.role === 'door') {
      ctx.setLineDash([12, 8]);
      ctx.strokeStyle = '#f0475c';
      ctx.beginPath();
      ctx.moveTo(w / 2, 0);
      ctx.lineTo(w / 2, h);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    frames += 1;
    if (performance.now() - since > 1000) {
      fps = frames;
      frames = 0;
      since = performance.now();
    }
    const rec = me.rep.doors[me.place];
    $('readout').textContent =
      me.role === 'door'
        ? `In view ${out.tracks.length}. Counted ${rec?.ab ?? 0} towards ${roomName(DOORS[me.place].b)}, ${rec?.ba ?? 0} towards ${roomName(DOORS[me.place].a)}. ${fps} frames a second.`
        : `In view ${out.tracks.length}${out.tracks.length ? (out.tracks.some((t) => t.moving) ? ', moving' : ', not moving') : ''}. ${fps} frames a second.`;
    await new Promise((r) => requestAnimationFrame(r));
  }
}

// ---- board --------------------------------------------------------------------
function render() {
  const t = now();
  const belief = buildingBelief(me.rep, t);
  const hc = headcount(belief);
  $('inside').textContent = hc.low === hc.high ? String(hc.low) : `${hc.low} to ${hc.high}`;

  const heard = Object.entries(me.net.peers).sort((a, b) => b[1] - a[1]);
  const live = heard.filter(([, at]) => t - at < 5).length;
  $('peers').textContent = String(live);
  $('peer-list').innerHTML = heard.length
    ? heard.map(([id, at]) => `<li><span>${id}</span><span class="meta">${t - at < 5 ? 'live' : `silent ${Math.round(t - at)} s`}</span></li>`).join('')
    : '<li class="none">No other node heard yet. Open this page on another device or window with the same mesh code.</li>';

  for (const id of ROOM_IDS) {
    const b = belief[id];
    $(`fill-${id}`).setAttribute('fill', FILL[b.state]);
    $(`state-${id}`).textContent = STATE_LABEL[b.state];
    $(`count-${id}`).textContent = shown(b);
  }
  const order = ROOM_IDS.map((id) => ({ id, b: belief[id], p: isHall(id) ? 0 : priority(belief[id]) })).sort((x, y) => y.p - x.p || ROOM_IDS.indexOf(x.id) - ROOM_IDS.indexOf(y.id));
  let rank = 0;
  $('tally').innerHTML = order
    .map(({ id, b, p }) => {
      const age = b.age === null || b.age === undefined ? 'no reading' : `age ${Math.round(b.age)} s`;
      return `<li class="${p > 0 ? '' : 'rest'}"><span class="rank">${p > 0 ? ++rank : ''}</span><span class="tab ${b.state}"></span>
        <span class="what"><span class="name">${ROOMS[id].name}</span><br><span class="state">${STATE_LABEL[b.state]}</span><br><span class="why">${b.why}</span></span>
        <span class="num"><span class="count">${shown(b)}</span><span class="meta">conf ${b.conf}%<br>${age}</span></span></li>`;
    })
    .join('');
  latest = { belief, hc, alarm: true, viewer: 'this device' };
  if (performance.now() >= heldUntil) $('brief').textContent = ruleBrief(belief, hc, true);
}

// ---- controls -----------------------------------------------------------------
$('radio').addEventListener('click', (e) => {
  me.net.setRadio(!me.net.radio);
  e.currentTarget.setAttribute('aria-pressed', String(!me.net.radio));
  e.currentTarget.textContent = me.net.radio ? 'Radio on' : 'Radio off';
});
$('forget').textContent = 'Leave mesh';
$('forget').addEventListener('click', () => location.reload());
$('flip').addEventListener('click', () => (me.flip = !me.flip));
$('zero').addEventListener('click', () => writeDoor(me.rep, me.place, 0, 0, now()));
$('speak').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  heldUntil = performance.now() + 60000;
  const secs = await deliverBrief(latest, $('brief'), $('brief-source'));
  heldUntil = performance.now() + Math.max(4000, secs * 1000);
  btn.disabled = false;
});

// ---- voice report ---------------------------------------------------------------
let recognition = null;
function initVoiceRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    $('voice-status').textContent = 'Speech recognition not supported in this browser';
    $('voice-report').disabled = true;
    return;
  }
  recognition = new SR();
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.lang = 'en-US';
  recognition.maxAlternatives = 1;
}

async function parseVoiceReport(transcript) {
  // Send to server for Gemini parsing
  const r = await fetch('/api/voice-parse', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ transcript })
  });
  if (!r.ok) throw new Error('Parse failed');
  return r.json();
}

function applyVoiceClaim(parsed) {
  const { room, state, count, details } = parsed;
  if (!room || !ROOM_IDS.includes(room)) return false;
  const validStates = ['empty', 'occupied', 'still', 'possible'];
  if (!validStates.includes(state)) return false;
  writeReport(me.rep, room, me.id, {
    state,
    count: Number(count) || 0,
    conf: 0.9,
    kind: 'voice',
    details: details || transcript
  }, now());
  return true;
}

$('voice-report').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  const status = $('voice-status');
  if (!recognition) initVoiceRecognition();
  if (!recognition) return;

  btn.disabled = true;
  btn.textContent = '🎤 Listening...';
  status.textContent = 'Speak now...';

  recognition.onresult = async (event) => {
    const transcript = event.results[0][0].transcript.trim();
    status.textContent = `Heard: "${transcript}" — parsing...`;
    try {
      const parsed = await parseVoiceReport(transcript);
      if (applyVoiceClaim(parsed)) {
        status.textContent = `✅ Logged: ${parsed.room} = ${parsed.state} (${parsed.count})`;
        render(); // refresh UI immediately
      } else {
        status.textContent = `❌ Could not parse: ${JSON.stringify(parsed)}`;
      }
    } catch (err) {
      status.textContent = `❌ Error: ${err.message}`;
    }
    btn.disabled = false;
    btn.textContent = '🎤 Voice Report';
  };
  recognition.onerror = (err) => {
    status.textContent = `❌ Recognition error: ${err.error}`;
    btn.disabled = false;
    btn.textContent = '🎤 Voice Report';
  };
  recognition.onend = () => {
    if (btn.disabled) { // still disabled means error or no result
      btn.disabled = false;
      btn.textContent = '🎤 Voice Report';
    }
  };
  recognition.start();
});
