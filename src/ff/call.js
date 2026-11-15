// Live voice call with "Command", an ElevenLabs voice agent. The firefighter
// holds a button to talk (push to talk, like a radio: the microphone is off
// otherwise, so the noise of the fireground never reaches Command), can
// interrupt at any moment, and Command answers from this phone's
// live picture through four tools. Urgent radio traffic is pushed into the
// call as it happens. The API key stays on the server; the phone gets a
// short-lived token.

import { setBuilding, ROOMS, ROOM_IDS, isHall } from '../core/building.js';
import { directions } from '../core/directions.js';

const SDK = 'https://cdn.jsdelivr.net/npm/@elevenlabs/client@1.32.1/+esm';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');

let convo = null;
let mode = 'listening';
let talking = false;
let layoutKey = '';
let startedAt = 0;
let lastOrder = '';
const told = new Set();
const urgent = [];

function current() {
  const s = window.rcState;
  if (!s) return null;
  const c = s.feed.crews.find((x) => x.id === s.me.ff);
  if (!c) return null;
  const key = `${Object.keys(s.feed.building.rooms).join()}|${Object.keys(s.feed.building.doors).length}`;
  if (key !== layoutKey) {
    setBuilding(s.feed.building);
    layoutKey = key;
  }
  return { feed: s.feed, me: s.me, c };
}

const squash = (t) => String(t).toLowerCase().replace(/[^a-z0-9]/g, '');
function findRoom(spoken) {
  const q = squash(spoken);
  if (/^(the)?(exit|out|outside|wayout|nearestexit|safeexit)$/.test(q)) return 'OUT';
  const ids = ROOM_IDS.filter((id) => squash(id) === q || squash(ROOMS[id].name) === q);
  if (ids.length) return ids[0];
  const loose = ROOM_IDS.filter((id) => squash(ROOMS[id].name).includes(q) || q.includes(squash(ROOMS[id].name)));
  return loose.length === 1 ? loose[0] : null;
}

const TOOLS = {
  get_situation: async () => {
    const s = current();
    if (!s) return 'No update from the command board yet.';
    const { c, feed } = s;
    const fire = ROOM_IDS.filter((id) => c.belief[id]?.h === 'fire').map((id) => ROOMS[id].name);
    const unknown = ROOM_IDS.filter((id) => c.belief[id]?.s === 'unknown' && !isHall(id)).map((id) => ROOMS[id].name);
    const people = ROOM_IDS.filter((id) => ['still', 'occupied', 'possible'].includes(c.belief[id]?.s)).map((id) => `${ROOMS[id].name}: ${c.belief[id].s === 'possible' ? 'possibly ' : ''}${c.belief[id].c || 'some'}${c.belief[id].s === 'still' ? ' not moving' : ''}`);
    const radio = feed.radio.filter((r) => r.ff === c.id || r.ff === null).slice(-4).map((r) => `${r.from === 'ff' ? 'you' : 'command'}: ${r.text}`);
    return [
      `Firefighter ${c.id}. Status: ${c.status}. Air ${c.air} percent.`,
      `Location: ${c.roomName}${c.heatHere === null ? '' : `, ${c.heatHere} degrees`}.`,
      `Current order: ${c.directive}`,
      c.route.length ? `Route for that order: ${c.route.join(' ')}` : '',
      `People believed inside: ${c.inside}. ${people.length ? `Where: ${people.join('; ')}.` : ''}`,
      `Rooms burning: ${fire.length ? fire.join(', ') : 'none known'}.`,
      `Rooms with no reliable reading (unknown, not empty): ${unknown.length ? unknown.join(', ') : 'none'}.`,
      `Nearest safe exit: ${c.exit ?? 'none believed clear'}.`,
      `Radio contact with command board: ${feed.jammed ? 'jammed' : c.contact ? 'yes' : 'no, working from own picture'}.`,
      radio.length ? `Latest radio: ${radio.join(' | ')}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  },

  get_directions: async ({ destination }) => {
    const s = current();
    if (!s) return 'No update from the command board yet.';
    const to = findRoom(destination ?? '');
    if (!to) return `There is no room called "${destination}" on this plan. Rooms are: ${ROOM_IDS.map((id) => ROOMS[id].name).join(', ')}.`;
    if (s.c.room === to) return `You are already ${to === 'OUT' ? 'outside' : `in ${ROOMS[to].name}`}.`;
    const avoid = new Set(ROOM_IDS.filter((id) => s.c.belief[id]?.h === 'fire'));
    avoid.delete(to);
    if (s.c.room !== 'OUT') avoid.delete(s.c.room);
    return directions(s.c.room, to, { avoid }).join(' ');
  },

  report: async ({ what }) => {
    const s = current();
    if (!s) return 'Not connected to the command board.';
    const { c, me } = s;
    if (c.room === 'OUT') return 'You are outside. Reports are for the room you are in.';
    if (isHall(c.room)) return `You are in ${c.roomName}, a corridor. Report from inside the room you searched.`;
    window.rcSend({ type: 'cmd', ff: me.ff, action: what === 'casualty' ? 'found' : 'clear' });
    return what === 'casualty' ? `Sent: casualty found in ${c.roomName}.` : `Sent: ${c.roomName} clear.`;
  },

  mayday: async () => {
    const s = current();
    if (!s) return 'Not connected to the command board. Use your radio mayday.';
    window.rcSend({ type: 'cmd', ff: s.me.ff, action: 'mayday' });
    return s.c.room === 'OUT' ? 'You are outside, so no mayday was raised.' : `Mayday raised for ${s.me.ff} in ${s.c.roomName}. A crew is being sent.`;
  },
};

function line(who, text) {
  const list = $('ff-call-log');
  const li = document.createElement('li');
  li.className = who === 'You' ? 'me' : who === 'Alert' ? 'all urgent' : 'cmd';
  li.innerHTML = `<span class="who">${who}</span>${esc(text)}`;
  list.append(li);
  while (list.children.length > 8) list.firstChild.remove();
  list.scrollTop = list.scrollHeight;
}

function setStatus(text, cls = '') {
  $('ff-call-status').textContent = text;
  $('ff-call-status').className = `ff-call-status ${cls}`;
}

// Feed new radio traffic and order changes into the call.
function watch() {
  if (!convo) return;
  const s = current();
  if (!s) return;
  for (const r of s.feed.radio) {
    if (told.has(r.n) || (r.ff !== s.me.ff && r.ff !== null) || r.from !== 'command') continue;
    told.add(r.n);
    if (r.t < startedAt) continue; // only what happens during the call
    if (r.urgent) urgent.push(r.text.replace(/^All crews: /, 'All crews: '));
    else convo.sendContextualUpdate(`Radio, from command: ${r.text}`);
  }
  if (s.c.directive !== lastOrder) {
    if (lastOrder) {
      const pressing = /Withdraw|MAYDAY|Get out/i.test(s.c.directive);
      if (pressing) urgent.push(`New order: ${s.c.directive}`);
      else convo.sendContextualUpdate(`The order for ${s.me.ff} changed to: ${s.c.directive}`);
    }
    lastOrder = s.c.directive;
  }
  // Only break in while the agent is listening, so it is never talked over.
  if (urgent.length && mode === 'listening') {
    const text = urgent.splice(0).join(' Also: ');
    line('Alert', text);
    convo.sendUserMessage(`URGENT FROM COMMAND: ${text}`);
  }
}

async function start() {
  const btn = $('ff-call');
  btn.disabled = true;
  setStatus('Connecting…');
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('This page needs HTTPS to use the microphone.');
    await navigator.mediaDevices.getUserMedia({ audio: true });
    const tokenRes = await fetch('/api/voice-token');
    const tok = await tokenRes.json();
    if (!tokenRes.ok) throw new Error(tok.error ?? 'no token');
    const { Conversation } = await import(SDK);
    const s = current();
    startedAt = s?.feed.t ?? 0;
    lastOrder = s?.c.directive ?? '';
    for (const r of s?.feed.radio ?? []) told.add(r.n);
    window.rcCallActive = true;
    convo = await Conversation.startSession({
      conversationToken: tok.token,
      connectionType: 'webrtc',
      dynamicVariables: { ff: window.rcState?.me.ff ?? 'R1' },
      clientTools: TOOLS,
      onConnect: () => {
        convo?.setMicMuted(true);
        setStatus('On air. Hold the button to talk; let go when you are done.', 'ok');
      },
      onDisconnect: () => stop(true),
      onError: (err) => setStatus(`Call error: ${err?.message ?? err}`, 'bad'),
      onModeChange: ({ mode: m }) => {
        mode = m;
        if (!talking) setStatus(m === 'speaking' ? 'Command is speaking. Hold to talk to interrupt.' : 'Hold the button to talk.', 'ok');
      },
      onMessage: (m) => {
        const who = (m.source ?? m.role) === 'user' ? 'You' : 'Command';
        if (m.message) line(who, m.message);
      },
    });
    convo.setMicMuted(true);
    btn.textContent = 'End call';
    btn.classList.add('live');
    btn.disabled = false;
    $('ff-ptt').hidden = false;
    $('ff-call-log').hidden = false;
  } catch (err) {
    window.rcCallActive = false;
    convo = null;
    btn.disabled = false;
    setStatus(`Could not start the call: ${err.message}`, 'bad');
  }
}

async function stop(fromSdk = false) {
  const c = convo;
  convo = null;
  window.rcCallActive = false;
  urgent.length = 0;
  talk(false);
  $('ff-ptt').hidden = true;
  if (c && !fromSdk) await c.endSession().catch(() => {});
  $('ff-call').textContent = 'Talk to Command';
  $('ff-call').classList.remove('live');
  setStatus('Call ended.');
}

// Push to talk: the microphone is open only while the button (or Space) is held.
function talk(on) {
  if (talking === on) return;
  talking = on;
  const b = $('ff-ptt');
  b.classList.toggle('on', on);
  b.setAttribute('aria-pressed', String(on));
  b.textContent = on ? 'Talking… let go to send' : 'Hold to talk';
  if (!convo) return;
  convo.setMicMuted(!on);
  if (on) setStatus(mode === 'speaking' ? 'Interrupting Command…' : 'Command can hear you.', 'ok');
  else setStatus('Mic off. Command is answering…', 'ok');
}

export function setupCall() {
  $('ff-call').addEventListener('click', () => (convo ? stop() : start()));
  const ptt = $('ff-ptt');
  ptt.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    ptt.setPointerCapture?.(e.pointerId);
    talk(true);
  });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) ptt.addEventListener(ev, () => talk(false));
  ptt.addEventListener('contextmenu', (e) => e.preventDefault()); // a long press must not open a menu
  window.addEventListener('blur', () => talk(false));
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && convo && !e.repeat && !e.target.closest?.('input, textarea')) {
      e.preventDefault();
      talk(true);
    }
  });
  document.addEventListener('keyup', (e) => {
    if (e.code === 'Space') talk(false);
  });
  setInterval(watch, 700);
}

// For checks from the console.
export const tools = TOOLS;

// A typed conversation with the same agent and tools, for the recorded demo
// (a recording has no microphone). ask() resolves with Command's reply.
window.rcTextCall = {
  replies: [],
  async start() {
    const res = await fetch('/api/voice-signed-url');
    const { url, error } = await res.json();
    if (!url) throw new Error(error ?? 'no signed url');
    const { Conversation } = await import(SDK);
    const s = current();
    startedAt = s?.feed.t ?? 0;
    lastOrder = s?.c.directive ?? '';
    for (const r of s?.feed.radio ?? []) told.add(r.n);
    window.rcCallActive = true;
    $('ff-call-log').hidden = false;
    $('ff-call').textContent = 'End call';
    $('ff-call').classList.add('live');
    setStatus('On air with Command.', 'ok');
    convo = await Conversation.startSession({
      signedUrl: url,
      textOnly: true,
      connectionType: 'websocket',
      dynamicVariables: { ff: window.rcState?.me.ff ?? 'R1' },
      clientTools: TOOLS,
      onMessage: (m) => {
        const who = (m.source ?? m.role) === 'user' ? 'You' : 'Command';
        if (!m.message) return;
        if (who === 'Command') this.replies.push(m.message);
        line(who, m.message);
      },
    });
  },
  async ask(text) {
    const before = this.replies.length;
    convo.sendUserMessage(text);
    line('You', text);
    const t0 = Date.now();
    while (this.replies.length === before && Date.now() - t0 < 30000) await new Promise((r) => setTimeout(r, 150));
    await new Promise((r) => setTimeout(r, 1200)); // a reply can arrive in parts
    return this.replies.slice(before).join(' ');
  },
  async firstLine() {
    const t0 = Date.now();
    while (!this.replies.length && Date.now() - t0 < 15000) await new Promise((r) => setTimeout(r, 150));
    return this.replies[0] ?? '';
  },
  async end() {
    await stop();
  },
};
// For checking push to talk without a live call: stand in a fake call object.
export const _test = {
  fakeCall(c) {
    convo = c;
    $('ff-ptt').hidden = !c;
  },
};
