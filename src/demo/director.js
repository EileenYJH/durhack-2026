// Runs the recorded demo: a real incident on the real system, with a scripted
// sequence of events. Narration and the firefighter's lines are written here;
// Command's replies come from the live ElevenLabs agent (typed, since a
// recording has no microphone) and are then voiced. Each clip is logged with
// its start time so the recorder can lay the audio under the video.

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const main = $('main');
const phone = $('phone');
const A = () => main.contentWindow;
const B = () => phone.contentWindow;

const demo = (window.__demo = { audio: [], done: false, ready: false, go: false, wallStart: 0, error: null, notes: [] });
let t0 = 0;
const now = () => (performance.now() - t0) / 1000;
const strip = (t) => t.replace(/\[[^\]]*\]\s*/g, '').replace(/\s+/g, ' ').trim();

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
const live = async (voice, text, kind = voice) => play(kind, await tts(voice === 'alert' ? 'command' : voice, text), text);
const scene = (t) => ($('scene').textContent = t);
const card = async (id, show) => {
  $(id).classList.toggle('show', show);
  await sleep(700);
};

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
const roomName = (id) => sim().node('R1') && A().document.getElementById(`state-${id}`) ? id : id;

// ---- the script -----------------------------------------------------------------------
const NARRATION = {
  open: 'In a building fire, the hardest question is: who is still inside, and where?',
  photo: "It starts with a photo of the building's evacuation plan. This is the Teaching and Learning Centre, where DurHack is held. Gemini reads the rooms and doors, and ARIA repairs the gaps, with the photo underneath to check.",
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
  return clips;
}

async function run(clips) {
  t0 = performance.now();
  demo.wallStart = Date.now() / 1000;

  // Title
  await card('card-title', true);
  await play('narrator', clips['n.open'], NARRATION.open);
  await card('card-title', false);

  // 1. Photo to building
  scene('1 · Photo to building');
  const photoFile = new File([await (await fetch('/demo-assets/tlc-level-00.webp')).blob()], 'tlc-level-00.webp', { type: 'image/webp' });
  const speaking = play('narrator', clips['n.photo'], NARRATION.photo);
  const input = A().document.getElementById('photo');
  const dt = new DataTransfer();
  dt.items.add(photoFile);
  input.files = dt.files;
  input.dispatchEvent(new Event('change'));
  await waitFor(() => {
    const s = A().document.getElementById('photo-status').textContent;
    return s && !s.startsWith('Reading');
  }, 90000);
  await speaking;
  await sleep(2500);
  const usable = !A().document.getElementById('use').disabled;
  if (usable) {
    A().document.getElementById('use').click();
    await waitFor(() => A().location.pathname.endsWith('index.html') && A().rollcall, 20000);
  } else {
    demo.notes.push('Gemini import was not usable this run; used the saved TLC layout.');
    const saved = await (await fetch('/demo-assets/tlc-level-00.json')).text();
    A().localStorage.setItem('rollcall:layout', saved);
    await loadMain('index.html');
  }
  await waitFor(() => A().rollcall?.sim, 20000);
  await sleep(800);

  // 2. The board
  scene('2 · Every node keeps its own picture');
  await play('narrator', clips['n.board'], NARRATION.board);

  // 3. Alarm
  scene('3 · Fire');
  A().document.getElementById('alarm').click();
  await play('narrator', clips['n.alarm'], NARRATION.alarm);
  await sleep(2500);

  // 4. Phone joins
  scene('4 · A firefighter joins');
  A().document.getElementById('ff-open').click();
  await sleep(1800);
  const code = A().rollcall.ffCode();
  phone.src = `firefighter.html?c=${code}&ff=R1`;
  await waitFor(() => B().document.getElementById('ff-order')?.textContent && !B().document.getElementById('ff-order').textContent.startsWith('Waiting'), 20000);
  $('phone-wait').style.display = 'none';
  await play('narrator', clips['n.phone'], NARRATION.phone);
  A().document.getElementById('ff-open').click(); // close the QR panel
  await sleep(1500);

  // 5. Talk to Command, while R1 is inside and the fire is young
  scene('5 · Talk to Command');
  await waitFor(() => sim().node('R1').room !== 'OUT' && sim().node('R1').status === 'ok', 40000, 300);
  await play('narrator', clips['n.voice'], NARRATION.voice);
  await B().rcTextCall.start();
  const hello = await B().rcTextCall.firstLine();
  if (hello) await live('command', hello);
  const wayP = B().rcTextCall.ask(strip(FF.way));
  await play('firefighter', clips['f.way'], FF.way);
  await live('command', await wayP);

  // 6. Mayday, only if it is true: R1 must really be inside and working
  const r1 = sim().node('R1');
  const layout = JSON.parse(A().localStorage.getItem('rollcall:layout') ?? 'null');
  if (r1.room !== 'OUT' && r1.status === 'ok') {
    scene('6 · Mayday');
    const mayP = B().rcTextCall.ask(strip(FF.mayday));
    await play('firefighter', clips['f.mayday'], FF.mayday);
    await live('command', await mayP);
    const rescued = await waitFor(() => sim().log.some((e) => /breaks off to reach Responder 1/.test(e.text)), 20000, 300);
    if (rescued) await play('narrator', clips['n.mayday'], NARRATION.mayday);
    else demo.notes.push('No teammate broke off within 20 s, so that line was left out.');
    await sleep(3500);
  } else demo.notes.push(`R1 was not inside and working at mayday time (${r1.room}, ${r1.status}); mayday scene skipped.`);
  await B().rcTextCall.end().catch(() => {});

  // 7. Steering refused
  scene('7 · Steer from the phone');
  await play('narrator', clips['n.steer'], NARRATION.steer);
  const burning = Object.keys(sim().rooms).find((id) => sim().rooms[id].burning && id !== sim().node('R2').room && !(layout?.rooms?.[id]?.hall));
  if (burning) {
    // steer R2 (still working) so the refusal reason is the fire, not the mayday
    phone.src = phone.src.replace('ff=R1', 'ff=R2');
    await waitFor(() => B().rcState?.me?.ff === 'R2' && B().document.querySelector(`#ff-map [data-room="${burning}"]`), 15000);
    B().document.querySelector(`#ff-map [data-room="${burning}"]`).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const ok = await waitFor(() => [...B().document.querySelectorAll('#ff-radio li')].some((li) => /refused/i.test(li.textContent)), 8000);
    const li = [...B().document.querySelectorAll('#ff-radio li')].reverse().find((x) => /refused/i.test(x.textContent));
    if (ok && li) {
      CAP.command[0] = 'Command to R2';
      await live('command', li.textContent.replace(/^Command · \d\d:\d\d/, ''));
      CAP.command[0] = 'Command';
    }
  }

  // 8. Break it: jam, second fire
  scene('8 · Break it');
  A().document.getElementById('jam').click();
  await play('narrator', clips['n.jam'], NARRATION.jam);
  await sleep(1500);
  const s = sim();
  const searchable = Object.keys(s.rooms).filter((id) => !s.rooms[id].burning && !(layout?.rooms?.[id]?.hall));
  const second = searchable.sort((a, b) => s.rooms[a].heat - s.rooms[b].heat)[0];
  if (second) s.ignite(second);
  await play('narrator', clips['n.second'], NARRATION.second);
  await sleep(3000);

  // 9. Proof and close
  scene('');
  await card('card-proof', true);
  await play('narrator', clips['n.proof'], NARRATION.proof);
  await sleep(1500);
  await card('card-proof', false);
  await card('card-end', true);
  await play('narrator', clips['n.end'], NARRATION.end);
  await sleep(2500);
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
