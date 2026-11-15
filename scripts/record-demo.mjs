// Records demo.html to an MP4 with voices. Needs ffmpeg and a Chromium build.
//   node scripts/record-demo.mjs [--chrome <path>] [--out demo-video/aria-demo.mp4]
// Starts its own server on port 8260, drives a headless Chromium through the
// DevTools protocol, saves every screen frame, then builds the video and lays
// each voice clip at the moment the page played it.

import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
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
const frames = [];
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
const result = JSON.parse(await evaluate('JSON.stringify({ wallStart: window.__demo.wallStart, audio: window.__demo.audio, notes: window.__demo.notes, error: window.__demo.error })'));
ws.close();
chrome.kill();
server.kill();
await sleep(1500);
rmSync(path.join(WORK, 'profile'), { recursive: true, force: true }); // a browser profile has no place in the project
log(`captured ${frames.length} frames, ${result.audio.length} voice clips`);
for (const n of result.notes) log('note:', n);

// 4. Video from frames, timed by their real timestamps
const start = result.wallStart;
const used = frames.filter((f) => f.ts >= start - 0.05);
if (!used.length) throw new Error('no frames recorded');
let list = '';
for (let i = 0; i < used.length; i++) {
  const next = used[i + 1]?.ts ?? used[i].ts + 2;
  list += `file '${used[i].file.replace(/\\/g, '/')}'\nduration ${Math.max(0.001, next - used[i].ts).toFixed(4)}\n`;
}
list += `file '${used.at(-1).file.replace(/\\/g, '/')}'\n`;
writeFileSync(path.join(WORK, 'frames.txt'), list);
const videoOnly = path.join(WORK, 'video.mp4');
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(WORK, 'frames.txt'), '-vf', 'fps=30,format=yuv420p', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', videoOnly], { stdio: 'inherit' });
const firstOffset = used[0].ts - start; // video starts this long after the timeline began

// 5. Voices laid at their times; the firefighter sounds like a radio
const inputs = [];
const filters = [];
result.audio.forEach((a, i) => {
  const f = path.join(WORK, 'audio', `${String(i).padStart(3, '0')}-${a.voice}.mp3`);
  writeFileSync(f, Buffer.from(a.b64, 'base64'));
  inputs.push('-i', f);
  const ms = Math.max(0, Math.round((a.t - firstOffset) * 1000));
  const radio = a.voice === 'firefighter' ? 'highpass=f=280,lowpass=f=3600,acompressor=threshold=-18dB:ratio=3,volume=1.4,' : a.voice === 'command' || a.voice === 'alert' ? 'highpass=f=180,lowpass=f=6000,' : '';
  filters.push(`[${i + 1}:a]${radio}aresample=44100,adelay=${ms}|${ms}[a${i}]`);
});
const mix = `${filters.join(';')};${result.audio.map((_, i) => `[a${i}]`).join('')}amix=inputs=${result.audio.length}:normalize=0:dropout_transition=0,alimiter=limit=0.95[aout]`;
mkdirSync(path.dirname(OUT), { recursive: true });
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', videoOnly, ...inputs, '-filter_complex', mix, '-map', '0:v', '-map', '[aout]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', OUT], { stdio: 'inherit' });
const dur = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', OUT]).toString().trim();
log(`done: ${OUT} (${Number(dur).toFixed(1)} s)`);
if (result.error) process.exitCode = 1;
