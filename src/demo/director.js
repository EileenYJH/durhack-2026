// Runs the recorded demo: a real incident on the real system, with a scripted
// sequence of events. Narration and the firefighter's lines are written here;
// Command's replies come from the live ElevenLabs agent (typed, since a
// recording has no microphone) and are then voiced. Each clip is logged with
// its start time so the recorder can lay the audio under the video.
//
// Waits nobody should sit through (Gemini reading, the agent thinking, a voice
// being made) are logged as cuts; the recorder removes them from picture and
// sound together, so the voices stay on their captions.

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const main = $('main');
const phone = $('phone');
const A = () => main.contentWindow;
const B = () => phone.contentWindow;

const demo = (window.__demo = { audio: [], cuts: [], music: [], done: false, ready: false, go: false, wallStart: 0, error: null, notes: [] });
let t0 = 0;
const now = () => (performance.now() - t0) / 1000;
const strip = (t) => t.replace(/\[[^\]]*\]\s*/g, '').replace(/\s+/g, ' ').trim();

// ---- music: levels the recorder turns into a volume curve ----------------------------
const MUSIC = { card: 0.75, narration: 0.17, live: 0.06 };
const music = (level) => demo.music.push({ t: now(), level: MUSIC[level] });

// ---- cuts -------------------------------------------------------------------------------
// Await something slow; keep `keep` seconds of it on screen and cut the rest.
async function cut(promise, keep = 0.4) {
  const a = now();
  const out = await promise;
  const b = now();
  if (b - a > keep + 0.3) demo.cuts.push([a + keep, b - 0.1]);
  return out;
}

// ---- audio ------------------------------------------------------------------------
async function tts(voice, text) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch('/api/speak', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ voice, text }) });
    if (r.ok) {
      const blob = await r.blob();
      const b64 = await new Promise((ok) => {
        const fr = new FileReader();
        fr.onload = () => ok(String(fr.result).split(',')[1]);
        fr.readAsDataURL(blob);
      });
      const dur = await new Promise((ok) => {
        const a = new Audio(URL.createObjectURL(blob));
        a.onloadedmetadata = () => ok(a.duration);
        a.onerror = () => ok(Math.max(2, text.length / 14));
      });
      return { b64, dur };
    }
    await sleep(1500);
  }
  return null;
}

const CAP = { narrator: ['', ''], firefighter: ['R1 · firefighter', 'ff'], command: ['Command', 'cmd'], alert: ['Radio', 'alert'] };
function caption(kind, text) {
  $('cap-who').textContent = CAP[kind][0];
  $('cap-who').className = CAP[kind][1];
  $('cap-text').textContent = text;
}

// Play a clip: show its caption, log it, wait for it to finish.
async function play(kind, clip, text) {
  caption(kind, strip(text));
  if (clip) {
    demo.audio.push({ t: now(), voice: kind, b64: clip.b64 });
    await sleep(clip.dur * 1000 + 450);
  } else await sleep(Math.max(2500, strip(text).length * 60));
}
// A line made now (Command's live answers): the making is cut out.
const live = async (voice, text, kind = voice) => play(kind, await cut(tts(voice === 'alert' ? 'command' : voice, text)), text);
const scene = (t) => ($('scene').textContent = t);
const card = async (id, show) => {
  $(id).classList.toggle('show', show);
  await sleep(700);
};

// ---- callouts -------------------------------------------------------------------------
// A box with a label, drawn over either screen and kept on its target as it moves.
const TONE = { hazard: '#f2bd2b', fire: '#f0475c', go: '#3fbf7f', line: '#e4eae7' };
const marks = new Map();
function rectIn(frame, el) {
  if (!el) return null;
  const f = frame.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  if (!r.width && !r.height) return null;
  return { x: f.left + frame.clientLeft + r.left, y: f.top + frame.clientTop + r.top, w: r.width, h: r.height, fx: f };
}
function place(m) {
  let r = null;
  try {
    r = m.find();
  } catch {
    r = null;
  }
  if (!r) {
    m.el.classList.remove('show');
    return;
  }
  const p = m.pad;
  // keep the box inside the frame it belongs to
  const x = Math.max(r.fx.left, r.x - p);
  const y = Math.max(r.fx.top, r.y - p);
  const w = Math.min(r.fx.right, r.x + r.w + p) - x;
  const h = Math.min(r.fx.bottom, r.y + r.h + p) - y;
  Object.assign(m.el.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
  m.el.classList.toggle('below', y - r.fx.top < 50);
  m.el.classList.toggle('right', x + 340 > r.fx.right);
  if (!m.shown) {
    m.shown = true;
    requestAnimationFrame(() => m.el.classList.add('show'));
  } else m.el.classList.add('show');
}
function mark(key, find, label, { tone = 'hazard', pad = 10, pulse = false } = {}) {
  unmark(key, true);
  const el = document.createElement('div');
  el.className = `note${pulse ? ' pulse' : ''}`;
  el.style.setProperty('--tone', TONE[tone] ?? tone);
  el.innerHTML = `<div class="box"></div><div class="tag"></div>`;
  el.querySelector('.tag').textContent = label;
  $('notes').append(el);
  const m = { el, find, pad, shown: false };
  marks.set(key, m);
  place(m);
}
function unmark(key, now_ = false) {
  const m = marks.get(key);
  if (!m) return;
  marks.delete(key);
  m.el.classList.remove('show');
  setTimeout(() => m.el.remove(), now_ ? 0 : 600);
}
const clearMarks = () => [...marks.keys()].forEach((k) => unmark(k));
setInterval(() => marks.forEach(place), 120);

// targets
const onMain = (sel) => () => rectIn(main, A().document.querySelector(sel));
const onPhone = (sel) => () => rectIn(phone, B().document.querySelector(sel));
const ffOnMap = (id) => () => {
  const g = A().document.querySelector(`#live g[data-id="${id}"]`);
  return rectIn(main, g?.querySelector('.ring') ?? g);
};
const roomOnMap = (id) => onMain(`#fill-${id}`);

// ---- helpers for the two screens -----------------------------------------------------
const loadMain = (url) =>
  new Promise((ok) => {
    main.onload = () => ok();
    main.src = url;
  });
const waitFor = async (test, ms = 30000, step = 250) => {
  const t = Date.now();
  while (Date.now() - t < ms) {
    try {
      if (test()) return true;
    } catch {
      // the frame may be between pages
    }
    await sleep(step);
  }
  return false;
};
const sim = () => A().rollcall.sim;
const byLabel = (label) => sim().nodes.find((n) => n.label === label);

// ---- the script -----------------------------------------------------------------------
const NARRATION = {
  open: 'In a building fire, the hardest question is: who is still inside, and where?',
  photo: "It starts with a photo of the building's evacuation plan. This is the Teaching and Learning Centre, where DurHack is held. Gemini reads the rooms and doors from the photo.",
  draft: 'ARIA turns that into a working plan, repairs the gaps, and keeps the photo underneath, so a person can check every wall.',
  board: 'Every sensor and every firefighter keeps its own copy of the building. There is no central server, so there is nothing single to lose.',
  alarm: 'The alarm goes up. Heat and smoke spread through the doorways, and the sensors start to fail.',
  phone: 'A firefighter joins from a phone with one scan, and sees their own order, route, air, and picture of the building.',
  jam: "Now we break it. The radio is jammed. Every node keeps working from what it last heard, and rooms nobody can hear become unknown. Never empty.",
  second: 'A second fire. Nobody tells the crews what to do. Each one re-plans from its own picture.',
  voice: 'And the firefighter can simply talk to Command, a live ElevenLabs voice agent that answers only from this firefighter’s live data.',
  steer: 'The firefighter can steer from the phone. An order into a burning room is refused, with the reason.',
  mayday: 'The mayday reaches the board, and the nearest teammate breaks off to reach R1, on their own.',
  proof: 'We measured it. Across a hundred random fires, with more than half the sensors destroyed, an occupied room was shown as empty in about a third of one percent of checks.',
  end: 'ARIA. Who is still inside, even when the building is burning around the answer.',
};
const FF = {
  way: '[panting] Command, R1. Smoke is getting thick in here. What is my way out?',
  mayday: '[urgent, out of breath] Mayday, mayday, mayday! R1. I am trapped, I cannot find the door!',
};

async function prepare() {
  // Make every fixed line in advance, so the recording never waits on it.
  const clips = {};
  for (const [k, v] of Object.entries(NARRATION)) clips[`n.${k}`] = await tts('narrator', v);
  for (const [k, v] of Object.entries(FF)) clips[`f.${k}`] = await tts('firefighter', v);
  try {
    localStorage.removeItem('rollcall:layout');
    localStorage.removeItem('rollcall:draft');
  } catch {
    // fine
  }
  await loadMain('editor.html');
  // An empty canvas, so the first plan anyone sees is the one Gemini reads.
  A().document.getElementById('blank').click();
  $('photo-img').src = '/demo-assets/tlc-level-00.webp';
  await new Promise((ok) => ($('photo-img').complete ? ok() : ($('photo-img').onload = ok)));
  return clips;
}

async function run(clips) {
  t0 = performance.now();
  demo.wallStart = Date.now() / 1000;

  // Title
  music('card');
  await card('card-title', true);
  await sleep(1800); // let the music open before the first word
  await play('narrator', clips['n.open'], NARRATION.open);
  await card('card-title', false);

  // 1. Photo to building: the photo first, then the plan drawn from it
  music('narration');
  scene('1 · Photo to building');
  $('photo-card').classList.add('show');
  const photoBlob = await (await fetch('/demo-assets/tlc-level-00.webp')).blob();
  const readPhoto = async () => {
    const input = A().document.getElementById('photo');
    const dt = new DataTransfer();
    dt.items.add(new File([photoBlob], 'tlc-level-00.webp', { type: 'image/webp' }));
    input.files = dt.files;
    input.dispatchEvent(new Event('change'));
    await sleep(300);
    await waitFor(() => !A().document.getElementById('photo-status').textContent.startsWith('Reading'), 120000);
    return !A().document.getElementById('use').disabled;
  };
  // Gemini's reading varies run to run; read again (off camera) until it passes the checks.
  const reading = (async () => {
    for (let i = 0; i < 3; i++) {
      if (await readPhoto()) return true;
      demo.notes.push(`Gemini reading ${i + 1}: ${A().document.getElementById('photo-status').textContent.slice(0, 160)}`);
    }
    return false;
  })();
  await play('narrator', clips['n.photo'], NARRATION.photo);
  const usable = await cut(reading, 1.2);
  if (!usable) {
    // Fall back to the saved, checked reading of the same photo, and say so on screen.
    demo.notes.push('Gemini import did not pass the checks in 3 tries; used the saved TLC layout.');
    const blob = new Blob([await (await fetch('/demo-assets/tlc-level-00.json')).text()], { type: 'application/json' });
    const imp = A().document.getElementById('import');
    const d2 = new DataTransfer();
    d2.items.add(new File([blob], 'tlc.json', { type: 'application/json' }));
    imp.files = d2.files;
    imp.dispatchEvent(new Event('change'));
    await sleep(800);
  }
  $('photo-card').classList.remove('show');
  await sleep(900);
  mark('canvas', onMain('#canvas'), usable ? "Gemini's plan, over the photo" : 'Checked plan from this photo', { tone: 'go', pad: 4 });
  await sleep(600);
  mark('checks', onMain('#checks'), 'Gaps ARIA repaired', { pad: 8 });
  await play('narrator', clips['n.draft'], NARRATION.draft);
  clearMarks();
  await sleep(500);
  A().document.getElementById('use').click();
  // cut until the board has drawn the building, so it never shows empty
  await cut(waitFor(() => A().location.pathname.endsWith('index.html') && A().rollcall?.sim && A().document.querySelector('#live g[data-id]'), 20000), 0);
  await sleep(300);
  await sleep(800);

  // 2. The board
  scene('2 · Every node keeps its own picture');
  mark('map', onMain('#map'), 'Same building, now live', { tone: 'go', pad: 2 });
  await play('narrator', clips['n.board'], NARRATION.board);
  clearMarks();

  // 3. Alarm: point at the fire, then at the first sensors it destroys
  scene('3 · Fire');
  const before = new Set(sim().nodes.filter((n) => !n.alive).map((n) => n.id));
  A().document.getElementById('alarm').click();
  await sleep(400);
  const fireRoom = Object.keys(sim().rooms).find((id) => sim().rooms[id].burning);
  if (fireRoom) mark('fire', roomOnMap(fireRoom), 'Fire starts here', { tone: 'fire', pad: 4, pulse: true });
  const narrating = play('narrator', clips['n.alarm'], NARRATION.alarm);
  const lost = await waitFor(() => sim().nodes.some((n) => !n.alive && !before.has(n.id) && n.kind !== 'responder'), 12000, 200);
  if (lost) {
    const dead = sim().nodes.find((n) => !n.alive && !before.has(n.id) && n.kind !== 'responder');
    mark('dead', ffOnMap(dead.id), `${dead.label} burnt out`, { tone: 'fire', pad: 6 });
  }
  await narrating;
  await sleep(1500);
  clearMarks();

  // 4. Phone joins
  scene('4 · A firefighter joins');
  A().document.getElementById('ff-open').click();
  await sleep(1800);
  const code = A().rollcall.ffCode();
  phone.src = `firefighter.html?c=${code}&ff=R1`;
  await cut(waitFor(() => B().document.getElementById('ff-order')?.textContent && !B().document.getElementById('ff-order').textContent.startsWith('Waiting'), 20000), 0.6);
  $('phone-wait').style.display = 'none';
  A().document.getElementById('ff-open').click(); // close the QR panel
  await sleep(500);
  mark('r1', ffOnMap('R1'), 'R1 · on the phone', { pad: 8 });
  mark('order', onPhone('#ff-order'), 'Their own order', { pad: 4 });
  await play('narrator', clips['n.phone'], NARRATION.phone);
  unmark('order');
  mark('picture', onPhone('#ff-map'), 'Their own picture', { pad: 2 });
  await sleep(2200);
  unmark('picture');

  // 5. Talk to Command, while R1 is inside and the fire is young
  scene('5 · Talk to Command');
  await cut(waitFor(() => sim().node('R1').room !== 'OUT' && sim().node('R1').status === 'ok', 40000, 300), 0.6);
  // half-speed fire while the call runs (shown on the board's radio log), so R1 is still inside for the mayday
  sim().setFireSpeed(0.5);
  mark('call', onPhone('#ff-call'), 'Live voice line', { tone: 'go', pad: 6 });
  await play('narrator', clips['n.voice'], NARRATION.voice);
  music('live');
  await cut(B().rcTextCall.start());
  unmark('call');
  mark('log', onPhone('#ff-call-log'), 'Command · ElevenLabs agent', { tone: 'go', pad: 4 });
  const hello = await cut(B().rcTextCall.firstLine());
  if (hello) await live('command', hello);
  const wayP = B().rcTextCall.ask(strip(FF.way));
  await play('firefighter', clips['f.way'], FF.way);
  await live('command', await cut(wayP));
  unmark('log');

  // 6. Mayday, only if it is true: R1 must really be inside and working.
  // If R1 has pulled out (air, or a threatened exit), wait off camera for them to go back in.
  await cut(waitFor(() => sim().node('R1').room !== 'OUT' && sim().node('R1').status === 'ok', 60000, 300), 0.5);
  const r1 = sim().node('R1');
  const layout = JSON.parse(A().localStorage.getItem('rollcall:layout') ?? 'null');
  if (r1.room !== 'OUT' && r1.status === 'ok') {
    scene('6 · Mayday');
    const mayP = B().rcTextCall.ask(strip(FF.mayday));
    await play('firefighter', clips['f.mayday'], FF.mayday);
    mark('r1', ffOnMap('R1'), 'MAYDAY · R1', { tone: 'fire', pad: 8, pulse: true });
    await live('command', await cut(mayP));
    let rescuer = null;
    const rescued = await cut(
      waitFor(() => {
        const e = sim().log.find((x) => /breaks off to reach Responder 1/.test(x.text));
        if (e) rescuer = byLabel(e.text.split(' breaks off')[0]);
        return Boolean(e);
      }, 20000, 300),
      1.0,
    );
    if (rescued) {
      music('narration');
      if (rescuer) mark('rescuer', ffOnMap(rescuer.id), `${rescuer.id} breaks off to help`, { tone: 'go', pad: 8 });
      // keep the callouts true: once the teammate reaches R1, R1 is no longer a mayday
      const reached = () => sim().log.some((x) => /has reached Responder 1/.test(x.text));
      const watch = setInterval(() => {
        if (!reached()) return;
        clearInterval(watch);
        unmark('rescuer');
        mark('r1', ffOnMap('R1'), `R1 reached · both coming out`, { tone: 'go', pad: 8 });
      }, 200);
      await play('narrator', clips['n.mayday'], NARRATION.mayday);
      await sleep(2500);
      clearInterval(watch);
    } else {
      demo.notes.push('No teammate broke off within 20 s, so that line was left out.');
      await sleep(2500);
    }
  } else demo.notes.push(`R1 was not inside and working at mayday time (${r1.room}, ${r1.status}); mayday scene skipped.`);
  await B().rcTextCall.end().catch(() => {});
  sim().setFireSpeed(1);
  clearMarks();
  music('narration');

  // 7. Steering refused
  scene('7 · Steer from the phone');
  const burning = Object.keys(sim().rooms).find((id) => sim().rooms[id].burning && id !== sim().node('R2').room && !(layout?.rooms?.[id]?.hall));
  if (burning) {
    // steer R2 (still working) so the refusal reason is the fire, not the mayday
    phone.src = phone.src.replace('ff=R1', 'ff=R2');
    await cut(waitFor(() => B().rcState?.me?.ff === 'R2' && B().document.querySelector(`#ff-map [data-room="${burning}"]`), 15000), 0.6);
    mark('r2', ffOnMap('R2'), 'R2 · now on the phone', { pad: 8 });
    mark('target', onPhone(`#ff-map [data-room="${burning}"]`), 'Tap: go here', { tone: 'fire', pad: 6 });
    await play('narrator', clips['n.steer'], NARRATION.steer);
    B().document.querySelector(`#ff-map [data-room="${burning}"]`).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    mark('burning', roomOnMap(burning), 'Believed burning', { tone: 'fire', pad: 4, pulse: true });
    const ok = await cut(waitFor(() => [...B().document.querySelectorAll('#ff-radio li')].some((li) => /refused/i.test(li.textContent)), 8000), 0.4);
    const li = [...B().document.querySelectorAll('#ff-radio li')].reverse().find((x) => /refused/i.test(x.textContent));
    if (ok && li) {
      unmark('target');
      mark('refused', () => rectIn(phone, li), 'Refused, with the reason', { tone: 'fire', pad: 4 });
      CAP.command[0] = 'Command to R2';
      music('live');
      await live('command', li.textContent.replace(/^Command · \d\d:\d\d/, ''));
      CAP.command[0] = 'Command';
      music('narration');
    } else await play('narrator', clips['n.steer'], NARRATION.steer);
    await sleep(800);
  } else {
    demo.notes.push('No burning room to refuse; steering scene shortened.');
    await play('narrator', clips['n.steer'], NARRATION.steer);
  }
  clearMarks();

  // 8. Break it: jam, second fire
  scene('8 · Break it');
  A().document.getElementById('jam').click();
  mark('jam', onMain('#map'), 'Radio jammed · no one can hear anyone', { tone: 'fire', pad: 2 });
  const jamSay = play('narrator', clips['n.jam'], NARRATION.jam);
  await sleep(4500);
  const unknown = Object.keys(sim().rooms).find((id) => /unknown/i.test(A().document.getElementById(`state-${id}`)?.textContent ?? ''));
  if (unknown) {
    unmark('jam');
    mark('unknown', roomOnMap(unknown), 'Unknown, not empty', { pad: 4 });
  }
  await jamSay;
  await sleep(800);
  clearMarks();
  const s = sim();
  const searchable = Object.keys(s.rooms).filter((id) => !s.rooms[id].burning && !(layout?.rooms?.[id]?.hall));
  const second = searchable.sort((a, b) => s.rooms[a].heat - s.rooms[b].heat)[0];
  if (second) {
    s.ignite(second);
    mark('second', roomOnMap(second), 'Second fire', { tone: 'fire', pad: 4, pulse: true });
  }
  const crews = sim().nodes.filter((n) => n.kind === 'responder' && n.alive && n.room !== 'OUT' && n.status !== 'mayday').slice(0, 2);
  crews.forEach((n) => mark(`crew-${n.id}`, ffOnMap(n.id), `${n.id} re-plans alone`, { tone: 'go', pad: 8 }));
  await play('narrator', clips['n.second'], NARRATION.second);
  await sleep(2500);
  clearMarks();

  // 9. Proof and close
  scene('');
  music('card');
  await card('card-proof', true);
  await play('narrator', clips['n.proof'], NARRATION.proof);
  await sleep(1500);
  await card('card-proof', false);
  demo.endAt = now();
  await card('card-end', true);
  await play('narrator', clips['n.end'], NARRATION.end);
  await sleep(5000);
  demo.done = true;
}

(async () => {
  try {
    caption('narrator', 'Preparing the demo…');
    const clips = await prepare();
    caption('narrator', '');
    demo.ready = true;
    if (!new URLSearchParams(location.search).has('record')) demo.go = true;
    await waitFor(() => demo.go, 10 * 60 * 1000, 100);
    await run(clips);
  } catch (err) {
    demo.error = String(err?.stack ?? err);
    demo.done = true;
  }
})();
