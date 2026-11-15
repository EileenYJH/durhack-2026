// A firefighter's own device. It shows one crew member's world as the main
// screen streams it: their order, the route, their air, what they believe
// about the building, and radio traffic. The firefighter can answer back.

import { setupCall } from './call.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
const params = new URLSearchParams(location.search);
const me = { code: (params.get('c') ?? '').toUpperCase(), ff: params.get('ff') ?? 'R1', id: `phone-${Math.random().toString(36).slice(2, 7)}` };

const STATUS = { ok: 'Working', 'low-air': 'Withdrawing', refill: 'Changing cylinder', mayday: 'MAYDAY', out: 'Outside' };
const FILL = { still: 'url(#p-still)', occupied: 'var(--fire-soft)', possible: 'url(#p-possible)', unknown: 'url(#p-unknown)', empty: 'var(--go-soft)' };

let lastFeed = 0;
let seen = new Set();
let voiceOn = false;
const speakQueue = [];
let speaking = false;

// ---- joining ------------------------------------------------------------------
$('code').value = me.code;
for (const r of document.querySelectorAll('input[name="ff"]')) r.checked = r.value === me.ff;
$('pick-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const code = $('code').value.trim().toUpperCase();
  if (!code) {
    $('pick-error').textContent = 'Enter the code shown on the main screen.';
    return;
  }
  me.code = code;
  me.ff = document.querySelector('input[name="ff"]:checked').value;
  history.replaceState(null, '', `?c=${encodeURIComponent(me.code)}&ff=${me.ff}`);
  start();
});
if (me.code) start();

function start() {
  $('pick').hidden = true;
  $('ff-main').hidden = false;
  $('ff-name').textContent = me.ff;
  const src = new EventSource(`/mesh/stream?mesh=${encodeURIComponent(me.code)}&id=${me.id}`);
  src.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'feed') render(msg);
  };
  send({ type: 'hello', ff: me.ff });
  setInterval(() => send({ type: 'hello', ff: me.ff }), 5000);
  setInterval(signal, 1000);
  setupCall();
}

window.rcSend = (body) => send(body);
function send(body) {
  fetch(`/mesh/send?mesh=${encodeURIComponent(me.code)}&id=${me.id}`, { method: 'POST', body: JSON.stringify({ ...body, from: me.id }) }).catch(() => {});
}

function signal() {
  const age = (Date.now() - lastFeed) / 1000;
  const el = $('ff-signal');
  if (!lastFeed) {
    el.textContent = 'Waiting for the main screen. Is the simulation open with this channel code?';
    el.className = 'ff-signal warn';
  } else if (age > 4) {
    el.textContent = `No update for ${Math.round(age)} s. Showing the last picture.`;
    el.className = 'ff-signal bad';
  }
}

// ---- rendering ----------------------------------------------------------------
function render(feed) {
  lastFeed = Date.now();
  window.rcState = { feed, me };
  const c = feed.crews.find((x) => x.id === me.ff);
  if (!c) return;

  const status = c.room === 'OUT' && c.status === 'ok' ? 'out' : c.status;
  $('ff-status').textContent = c.alive === false ? 'No contact' : STATUS[status] ?? status;
  $('ff-status').className = `ff-chip ${status}`;
  document.body.classList.toggle('mayday', c.status === 'mayday');
  $('ff-air').textContent = `${c.air}%`;
  $('ff-air-fill').style.width = `${Math.max(0, Math.min(100, c.air))}%`;
  $('ff-air-fill').className = `ff-air-fill${c.air < 30 ? ' low' : c.air < 50 ? ' mid' : ''}`;
  $('ff-room').textContent = c.roomName;
  $('ff-heat').textContent = c.heatHere === null ? '' : `${c.heatHere}°C`;
  $('ff-heat').className = `ff-heat ${c.heatHere >= 200 ? 'bad' : c.heatHere >= 100 ? 'warn' : ''}`;

  const sig = $('ff-signal');
  if (feed.jammed) {
    sig.textContent = 'RADIO JAMMED. Work from your own picture.';
    sig.className = 'ff-signal bad';
  } else if (!c.contact) {
    sig.textContent = 'No radio contact with command. Your picture is what you last heard and saw.';
    sig.className = 'ff-signal bad';
  } else {
    sig.textContent = `Live. Incident clock ${clock(feed.t)}`;
    sig.className = 'ff-signal ok';
  }

  $('ff-order').textContent = c.directive;
  $('ff-order').className = `ff-order-text ${c.status === 'mayday' || c.status === 'low-air' ? 'urgent' : ''}`;
  $('ff-route').innerHTML = c.route.map((s, i) => `<li class="${i === 0 ? 'now' : ''}">${esc(s)}</li>`).join('');

  drawMap(feed.building, c);
  $('ff-auto').hidden = !c.manual;
  $('ff-control').textContent = c.manual ? 'You are steering. Tap a room or a green exit.' : 'Tap a room or a green exit to take control.';
  $('ff-picture-note').textContent = `as you believe it`;
  const nb = (k, v, cls = '') => `<div class="${cls}"><dt>${k}</dt><dd>${v}</dd></div>`;
  $('ff-numbers').innerHTML =
    nb('Believed inside', c.inside) +
    nb('Rooms burning', c.burning, c.burning ? 'bad' : '') +
    nb('Rooms unknown', c.unknown, c.unknown ? 'warn' : '') +
    nb('Nearest exit', esc(c.exit ?? 'none clear'), c.exit ? '' : 'bad');

  // radio, oldest first, only what this firefighter would hear
  const mine = feed.radio.filter((r) => r.ff === me.ff || r.ff === null);
  const list = $('ff-radio');
  const atBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 30;
  list.innerHTML = mine
    .map((r) => {
      const who = r.from === 'ff' ? (r.ff === me.ff ? 'You' : r.ff) : r.ff === null ? 'All crews' : 'Command';
      const cls = r.from === 'ff' ? 'me' : r.ff === null ? 'all' : 'cmd';
      return `<li class="${cls}${r.urgent ? ' urgent' : ''}"><span class="who">${who} · ${clock(r.t)}</span>${esc(r.text.replace(/^All crews: /, ''))}</li>`;
    })
    .join('');
  if (atBottom) list.scrollTop = list.scrollHeight;

  for (const r of mine) {
    if (seen.has(r.n)) continue;
    seen.add(r.n);
    if (lastSeenReady && r.from === 'command') say(r);
  }
  lastSeenReady = true;
}
let lastSeenReady = false;

const clock = (t) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

function drawMap(b, c) {
  const svg = $('ff-map');
  const rooms = Object.entries(b.rooms);
  const xs = rooms.flatMap(([, r]) => [r.x, r.x + r.w]);
  const ys = rooms.flatMap(([, r]) => [r.y, r.y + r.h]);
  const [x0, x1, y0, y1] = [Math.min(...xs) - 60, Math.max(...xs) + 60, Math.min(...ys) - 30, Math.max(...ys) + 30];
  svg.setAttribute('viewBox', `${x0} ${y0} ${x1 - x0} ${y1 - y0}`);
  const fs = Math.max(14, Math.round((x1 - x0) / 30)); // readable on a phone whatever the building size
  const fill = rooms
    .map(([id, r]) => {
      const s = c.belief[id] ?? { s: 'unknown' };
      const hot = s.h === 'fire' ? '<rect class="ff-fire" x="X" y="Y" width="W" height="H"/>' : '';
      return `<rect data-room="${esc(id)}" x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="${FILL[s.s] ?? FILL.unknown}" class="ff-room${id === c.target ? ' target' : ''}"/>${hot.replace('X', r.x).replace('Y', r.y).replace('W', r.w).replace('H', r.h)}<text x="${r.x + 8}" y="${r.y + fs + 4}" class="ff-room-name" style="font-size:${fs}px">${esc(r.name)}</text>${s.c ? `<text x="${r.x + r.w - 10}" y="${r.y + r.h - 10}" text-anchor="end" class="ff-room-count" style="font-size:${fs * 2}px">${s.c}</text>` : ''}`;
    })
    .join('');
  const doors = Object.values(b.doors)
    .map((d) => (d.a === 'OUT' || d.b === 'OUT' ? `<rect data-room="OUT" x="${d.x - 14}" y="${d.y - 14}" width="28" height="28" class="ff-door exit"/>` : `<rect x="${d.x - 7}" y="${d.y - 7}" width="14" height="14" class="ff-door"/>`))
    .join('');
  const mates = c.mates.map((m) => `<g class="ff-mate${m.age > 10 ? ' ghost' : ''}" transform="translate(${m.x} ${m.y})"><circle r="14"/><text text-anchor="middle" y="5">${m.id.slice(1)}</text><title>${m.id}, heard ${Math.round(m.age)} s ago</title></g>`).join('');
  const self = `<g class="ff-self" transform="translate(${c.x} ${c.y})"><circle r="20" class="ring"/><path d="M0 -14 L13 10 L-13 10 Z"/></g>`;
  svg.innerHTML = `<defs>
      <pattern id="p-still" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="7" height="7" style="fill:var(--fire-soft)"/><rect width="4" height="7" style="fill:var(--fire)"/></pattern>
      <pattern id="p-possible" width="11" height="11" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)"><rect width="11" height="11" style="fill:var(--hazard-soft)"/><rect width="5" height="11" style="fill:var(--hazard)"/></pattern>
      <pattern id="p-unknown" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="1.5" height="6" style="fill:var(--hatch)"/></pattern>
    </defs>${fill}${doors}${mates}${self}`;
}

// ---- steering -------------------------------------------------------------------------
$('ff-map').addEventListener('click', (e) => {
  const room = e.target.closest('[data-room]')?.dataset.room;
  if (!room || !window.rcState) return;
  const b = window.rcState.feed.building;
  send({ type: 'cmd', ff: me.ff, action: 'goto', room });
  $('ff-control').textContent = `Order sent: go to ${room === 'OUT' ? 'the nearest safe exit' : b.rooms[room]?.name ?? room}.`;
});
$('ff-auto').addEventListener('click', () => send({ type: 'cmd', ff: me.ff, action: 'auto' }));

// ---- voice ----------------------------------------------------------------------
$('ff-voice').addEventListener('click', (e) => {
  voiceOn = !voiceOn;
  e.currentTarget.setAttribute('aria-pressed', String(voiceOn));
  e.currentTarget.textContent = voiceOn ? 'Voice on' : 'Voice off';
  if (voiceOn && 'speechSynthesis' in window) speechSynthesis.speak(new SpeechSynthesisUtterance('Voice on.'));
});

function say(r) {
  if (!voiceOn || window.rcCallActive) return; // the live call speaks instead
  speakQueue.push(r);
  // Keep up with the fire: if the queue grows, drop older routine messages.
  while (speakQueue.length > 2) {
    const i = speakQueue.findIndex((x) => !x.urgent);
    speakQueue.splice(i >= 0 ? i : 0, 1);
  }
  if (!speaking) next();
}

async function next() {
  const r = speakQueue.shift();
  if (!r) {
    speaking = false;
    return;
  }
  speaking = true;
  const text = `${r.ff === null ? 'All crews. ' : `${me.ff}. `}${r.text.replace(/^All crews: /, '')}`;
  try {
    const res = await fetch('/api/speak', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) });
    if (!res.ok) throw new Error('no voice');
    const audio = new Audio(URL.createObjectURL(await res.blob()));
    audio.onended = next;
    audio.onerror = next;
    await audio.play();
  } catch {
    if ('speechSynthesis' in window) {
      const u = new SpeechSynthesisUtterance(text);
      u.onend = next;
      speechSynthesis.speak(u);
    } else next();
  }
}

// ---- answering back ----------------------------------------------------------------
for (const b of document.querySelectorAll('[data-act]')) {
  b.addEventListener('click', () => {
    const act = b.dataset.act;
    if (act === 'mayday' && !confirm('Send MAYDAY to command?')) return;
    send({ type: 'cmd', ff: me.ff, action: act });
    b.classList.add('sent');
    setTimeout(() => b.classList.remove('sent'), 900);
  });
}
