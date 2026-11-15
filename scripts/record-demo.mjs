// Records demo.html to an MP4 with voices. Needs ffmpeg and a Chromium build.
//   node scripts/record-demo.mjs [--chrome <path>] [--out demo-video/aria-demo.mp4]
// Starts its own server on port 8260, drives a headless Chromium through the
// DevTools protocol, saves every screen frame, then builds the video and lays
// each voice clip at the moment the page played it.

import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const OUT = path.resolve(ROOT, arg('--out', 'demo-video/aria-demo.mp4'));
const WORK = path.resolve(ROOT, 'demo-video/work');
const PORT = 8260;
const DEBUG = 9333;

function findChrome() {
  const given = arg('--chrome');
  if (given) return given;
  const base = path.join(process.env.LOCALAPPDATA ?? '', 'ms-playwright');
  const dirs = existsSync(base) ? readdirSync(base).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse() : [];
  for (const d of dirs) {
    const exe = path.join(base, d, 'chrome-win64', 'chrome.exe');
    if (existsSync(exe)) return exe;
  }
  throw new Error('No Chromium found. Pass --chrome <path to chrome.exe>.');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// --remix: build the video and sound again from the last recording, without recording
const REMIX = process.argv.includes('--remix');
let frames = [];
let result;
if (REMIX) {
  ({ frames, result } = JSON.parse(readFileSync(path.join(WORK, 'session.json'), 'utf8')));
  log('re-mixing the last recording');
} else {
rmSync(WORK, { recursive: true, force: true });
mkdirSync(path.join(WORK, 'frames'), { recursive: true });
mkdirSync(path.join(WORK, 'audio'), { recursive: true });

// 1. Server
const server = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1' }, stdio: 'ignore' });
for (let i = 0; i < 40; i++) {
  try {
    if ((await fetch(`http://127.0.0.1:${PORT}/api/status`)).ok) break;
  } catch {
    // starting
  }
  await sleep(250);
}
log('server up');

// 2. Browser
const profile = path.join(WORK, 'profile');
const chrome = spawn(findChrome(), [
  '--headless=new', `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${profile}`, '--window-size=1920,1080',
  '--hide-scrollbars', '--mute-audio', '--autoplay-policy=no-user-gesture-required', '--force-device-scale-factor=1',
  '--no-first-run', '--no-default-browser-check', 'about:blank',
], { stdio: 'ignore' });
let pageWs;
for (let i = 0; i < 60 && !pageWs; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${DEBUG}/json`)).json();
    pageWs = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl;
  } catch {
    // starting
  }
  if (!pageWs) await sleep(250);
}
if (!pageWs) throw new Error('Chromium did not start');
log('browser up');

const ws = new WebSocket(pageWs);
await new Promise((ok) => ws.addEventListener('open', ok, { once: true }));
let id = 0;
const waiting = new Map();
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && waiting.has(m.id)) {
    waiting.get(m.id)(m);
    waiting.delete(m.id);
  } else if (m.method === 'Page.screencastFrame') {
    const n = frames.length;
    const file = path.join(WORK, 'frames', `${String(n).padStart(6, '0')}.jpg`);
    writeFileSync(file, Buffer.from(m.params.data, 'base64'));
    frames.push({ file, ts: m.params.metadata.timestamp });
    ws.send(JSON.stringify({ id: ++id, method: 'Page.screencastFrameAck', params: { sessionId: m.params.sessionId } }));
  }
});
const cdp = (method, params = {}) =>
  new Promise((ok) => {
    const n = ++id;
    waiting.set(n, ok);
    ws.send(JSON.stringify({ id: n, method, params }));
  });
const evaluate = async (expr) => (await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;

await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
await cdp('Page.navigate', { url: `http://127.0.0.1:${PORT}/demo.html?record=1` });

// 3. Wait until every fixed voice line is made, then record
for (let i = 0; i < 600; i++) {
  if (await evaluate('window.__demo && window.__demo.ready')) break;
  await sleep(500);
}
log('demo prepared, recording');
await cdp('Page.startScreencast', { format: 'jpeg', quality: 82, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
await sleep(400);
await evaluate('window.__demo.go = true');

for (let i = 0; i < 1200; i++) {
  const state = await evaluate('JSON.stringify({ done: window.__demo.done, error: window.__demo.error, clips: window.__demo.audio.length })');
  const s = JSON.parse(state ?? '{}');
  if (i % 20 === 0) log(`recording… ${frames.length} frames, ${s.clips} voice clips`);
  if (s.done) {
    if (s.error) log('DEMO ERROR:', s.error);
    break;
  }
  await sleep(500);
}
await cdp('Page.stopScreencast');
result = JSON.parse(await evaluate('JSON.stringify({ wallStart: window.__demo.wallStart, audio: window.__demo.audio, cuts: window.__demo.cuts, music: window.__demo.music, endAt: window.__demo.endAt, notes: window.__demo.notes, error: window.__demo.error })'));
ws.close();
chrome.kill();
server.kill();
await sleep(1500);
rmSync(path.join(WORK, 'profile'), { recursive: true, force: true }); // a browser profile has no place in the project
log(`captured ${frames.length} frames, ${result.audio.length} voice clips`);
for (const n of result.notes) log('note:', n);
writeFileSync(path.join(WORK, 'session.json'), JSON.stringify({ frames, result }));
}

// 4. One timeline for picture and sound. Times are seconds since the demo began;
// the cut stretches (waiting on Gemini, the agent, a voice) are removed from both.
const start = result.wallStart;
const cuts = (result.cuts ?? []).filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
const inCut = (t) => cuts.some(([a, b]) => t > a && t < b);
const mapT = (t) => t - cuts.reduce((s, [a, b]) => s + Math.max(0, Math.min(t, b) - a), 0);
log(`cutting ${cuts.length} waits, ${cuts.reduce((s, [a, b]) => s + b - a, 0).toFixed(1)} s in all`);

const used = frames.map((f) => ({ ...f, rel: f.ts - start })).filter((f) => f.rel >= -0.05 && !inCut(f.rel));
if (!used.length) throw new Error('no frames recorded');
const firstAt = mapT(Math.max(0, used[0].rel));
let list = '';
for (let i = 0; i < used.length; i++) {
  const here = mapT(Math.max(0, used[i].rel));
  const next = used[i + 1] ? mapT(Math.max(0, used[i + 1].rel)) : here + 2;
  list += `file '${used[i].file.replace(/\\/g, '/')}'\nduration ${Math.max(0.001, next - here).toFixed(4)}\n`;
}
list += `file '${used.at(-1).file.replace(/\\/g, '/')}'\n`;
writeFileSync(path.join(WORK, 'frames.txt'), list);
const videoOnly = path.join(WORK, 'video.mp4');
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(WORK, 'frames.txt'), '-vf', 'fps=30,format=yuv420p', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', videoOnly], { stdio: 'inherit' });
const videoLen = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', videoOnly]).toString().trim());
const at = (t) => Math.max(0, mapT(t) - firstAt); // demo time -> video time

// 5. Voices laid at their times; the firefighter sounds like a radio
const inputs = [];
const filters = [];
const labels = [];
result.audio.forEach((a, i) => {
  const f = path.join(WORK, 'audio', `${String(i).padStart(3, '0')}-${a.voice}.mp3`);
  writeFileSync(f, Buffer.from(a.b64, 'base64'));
  inputs.push('-i', f);
  const ms = Math.round(at(a.t) * 1000);
  const radio = a.voice === 'firefighter' ? 'highpass=f=280,lowpass=f=3600,acompressor=threshold=-18dB:ratio=3,volume=1.4,' : a.voice === 'command' || a.voice === 'alert' ? 'highpass=f=180,lowpass=f=6000,' : '';
  filters.push(`[${i + 1}:a]${radio}aresample=44100,aformat=channel_layouts=stereo,adelay=${ms}|${ms}[a${i}]`);
  labels.push(`[a${i}]`);
});

// 6. Music: louder on the cards, low under narration, nearly gone in the live
// exchanges. The end card gets the track's own ending.
const MUSIC = path.join(ROOT, 'demo-assets', 'music.mp3');
if (existsSync(MUSIC) && result.music?.length) {
  const trackLen = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', MUSIC]).toString().trim());
  const keys = result.music.map((m) => ({ t: at(m.t), v: m.level }));
  // piecewise level with 1.2 s ramps between steps
  let expr = String(keys[0].v);
  for (let i = 1; i < keys.length; i++) {
    const { t, v } = keys[i];
    const prev = keys[i - 1].v;
    expr = `if(lt(t,${t.toFixed(2)}),${expr},if(lt(t,${(t + 1.2).toFixed(2)}),${prev}+(${v}-${prev})*(t-${t.toFixed(2)})/1.2,${v}))`;
  }
  const endAt = result.endAt != null ? at(result.endAt) : videoLen - 12;
  const tail = Math.min(trackLen, Math.max(12, videoLen - endAt + 3));
  const n = result.audio.length;
  inputs.push('-stream_loop', '-1', '-i', MUSIC, '-i', MUSIC);
  // bed: the track from the top, looped, fading out as the ending comes in
  filters.push(`[${n + 1}:a]aresample=44100,aformat=channel_layouts=stereo,atrim=0:${(endAt + 1).toFixed(2)},afade=t=in:d=0.8,afade=t=out:st=${(endAt - 1.5).toFixed(2)}:d=2.5[bed]`);
  // ending: the last seconds of the track, starting under the end card
  const tailMs = Math.round(Math.max(0, endAt - 2) * 1000);
  filters.push(`[${n + 2}:a]aresample=44100,aformat=channel_layouts=stereo,atrim=start=${(trackLen - tail).toFixed(2)},asetpts=PTS-STARTPTS,afade=t=in:d=2,adelay=${tailMs}|${tailMs}[end]`);
  filters.push(`[bed][end]amix=inputs=2:normalize=0:dropout_transition=0,volume='${expr}':eval=frame,afade=t=out:st=${(videoLen - 2.5).toFixed(2)}:d=2.5[music]`);
  labels.push('[music]');
  log('music laid');
} else log('no demo-assets/music.mp3; no music (node scripts/make-music.mjs makes one)');

const mix = `${filters.join(';')};${labels.join('')}amix=inputs=${labels.length}:normalize=0:dropout_transition=0,atrim=0:${videoLen.toFixed(2)},alimiter=limit=0.95[aout]`;
mkdirSync(path.dirname(OUT), { recursive: true });
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', videoOnly, ...inputs, '-filter_complex', mix, '-map', '0:v', '-map', '[aout]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', OUT], { stdio: 'inherit' });
// a log of when each voice lands, to check against the picture
writeFileSync(path.join(WORK, 'voices.txt'), result.audio.map((a) => `${at(a.t).toFixed(2)}\t${a.voice}`).join('\n'));
const dur = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', OUT]).toString().trim();
log(`done: ${OUT} (${Number(dur).toFixed(1)} s)`);
if (result.error) process.exitCode = 1;
