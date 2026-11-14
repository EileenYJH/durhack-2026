// Roll Call server. No dependencies: node server.js
//
// It does three small jobs:
//   1. serves the static files;
//   2. forwards mesh messages between devices (it stores nothing and decides
//      nothing: every device keeps its own state and merges for itself);
//   3. keeps the Gemini and ElevenLabs keys off the client.

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

try {
  process.loadEnvFile();
} catch {
  // no .env file: the AI brief and voice fall back to the built-in ones
}

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8200);
const HOST = process.env.HOST ?? '0.0.0.0'; // 127.0.0.1 when a reverse proxy sits in front

// The AI proxies spend the owner's keys, so cap them per address.
const hits = new Map();
function limited(req, limit = 30, windowMs = 60_000) {
  const ip = (req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '').split(',')[0].trim();
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > limit;
}
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';
const ELEVEN_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVEN_VOICE = process.env.ELEVENLABS_VOICE_ID ?? 'JBFqnCBsd6RMkjVDRZzb';
const ELEVEN_MODEL = process.env.ELEVENLABS_MODEL ?? 'eleven_flash_v2_5';

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.md': 'text/plain' };
const meshes = new Map(); // mesh code -> Set of { id, res }

const BRIEF_RULES = `You write the radio brief for a fire incident commander from sensor data.
Rules:
- Use only the data given. Never add facts, names, causes or advice that are not in it.
- Lead with the room to search first and why. Then the next rooms in order.
- Say "confirmed empty" only for rooms whose state is exactly "Confirmed empty".
- Name every room whose state is "Unknown" and say it is unknown. Never imply it is empty.
- Give counts as counts of people. Mention how old a reading is when it is over 10 seconds.
- Plain spoken English, no lists, no markdown, at most 70 words.`;

const LAYOUT_RULES = `You read a picture of a building floor plan, for example a fire evacuation plan, and return JSON only.
Canvas: 880 units wide and 520 tall, origin at the top left. Fit the whole plan inside it and keep the plan's proportions.
Describe only what is drawn. Do not invent rooms, doors or exits.
Rooms are axis-aligned rectangles: {"id": "R1", "name": string, "x": number, "y": number, "w": number, "h": number, "hall": boolean}.
Set hall to true for corridors, lobbies and stairwells that people pass through; false for rooms someone could be inside. Use the label printed on the plan for the name.
Doors: {"id": "d1", "a": roomId, "b": roomId or "OUT", "x": number, "y": number}. The point x,y lies on the wall the two rooms share. For a building exit, b is "OUT" and the point lies on the outer wall.
Return exactly: {"name": string, "rooms": [...], "doors": [...]}. If you cannot read a plan in the picture, return {"name": "", "rooms": [], "doors": []}.`;

function extractJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('no JSON in the reply');
  return JSON.parse(text.slice(start, end + 1));
}

async function layout(req, res) {
  if (!GEMINI_KEY) return send(res, 503, { error: 'Photo import needs GEMINI_API_KEY in .env' });
  const { image } = JSON.parse(await readBody(req, 8_000_000));
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(image ?? '');
  if (!m) return send(res, 400, { error: 'Send a JPEG, PNG or WebP image.' });
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': GEMINI_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: LAYOUT_RULES }] },
      contents: [{ role: 'user', parts: [{ text: 'Read this floor plan.' }, { inline_data: { mime_type: m[1], data: m[2] } }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 8000, responseMimeType: 'application/json' },
    }),
  });
  if (!r.ok) return send(res, 502, { error: `Gemini returned ${r.status}`, detail: (await r.text()).slice(0, 300) });
  const out = await r.json();
  const text = out.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  let parsed;
  try {
    parsed = extractJson(text);
  } catch {
    return send(res, 502, { error: 'Gemini did not return a layout' });
  }
  if (!parsed.rooms?.length) return send(res, 422, { error: 'No floor plan found in that picture.' });
  send(res, 200, { layout: parsed, model: GEMINI_MODEL });
}

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

async function readBody(req, limit = 400_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function brief(req, res) {
  if (!GEMINI_KEY) return send(res, 503, { error: 'no GEMINI_API_KEY set' });
  const data = await readBody(req);
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': GEMINI_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: BRIEF_RULES }] },
      contents: [{ role: 'user', parts: [{ text: data }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 800 },
    }),
  });
  if (!r.ok) return send(res, 502, { error: `Gemini returned ${r.status}`, detail: (await r.text()).slice(0, 300) });
  const out = await r.json();
  const text = out.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('').trim();
  if (!text) return send(res, 502, { error: 'Gemini returned no text' });
  send(res, 200, { text, model: GEMINI_MODEL });
}

async function speak(req, res) {
  if (!ELEVEN_KEY) return send(res, 503, { error: 'no ELEVENLABS_API_KEY set' });
  const { text } = JSON.parse(await readBody(req));
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVEN_VOICE}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'xi-api-key': ELEVEN_KEY },
    body: JSON.stringify({ text: String(text).slice(0, 800), model_id: ELEVEN_MODEL }),
  });
  if (!r.ok) return send(res, 502, { error: `ElevenLabs returned ${r.status}`, detail: (await r.text()).slice(0, 300) });
  send(res, 200, Buffer.from(await r.arrayBuffer()), 'audio/mpeg');
}

function stream(req, res, mesh, id) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
  res.write(': joined\n\n');
  const peer = { id, res };
  if (!meshes.has(mesh)) meshes.set(mesh, new Set());
  meshes.get(mesh).add(peer);
  const beat = setInterval(() => res.write(': beat\n\n'), 15000);
  req.on('close', () => {
    clearInterval(beat);
    meshes.get(mesh)?.delete(peer);
  });
}

async function relay(req, res, mesh, id) {
  const body = await readBody(req);
  JSON.parse(body); // reject anything that is not JSON
  for (const peer of meshes.get(mesh) ?? []) {
    if (peer.id !== id) peer.res.write(`data: ${body}\n\n`);
  }
  send(res, 204, '');
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    const mesh = (url.searchParams.get('mesh') ?? 'demo').slice(0, 40);
    const id = (url.searchParams.get('id') ?? '').slice(0, 60);
    if (url.pathname === '/mesh/stream' && req.method === 'GET') return stream(req, res, mesh, id);
    if (url.pathname === '/mesh/send' && req.method === 'POST') return await relay(req, res, mesh, id);
    if (url.pathname === '/api/status') return send(res, 200, { gemini: Boolean(GEMINI_KEY), elevenlabs: Boolean(ELEVEN_KEY), peers: meshes.get(mesh)?.size ?? 0 });
    if (['/api/brief', '/api/speak', '/api/layout'].includes(url.pathname) && limited(req)) return send(res, 429, { error: 'Too many requests. Wait a minute.' });
    if (url.pathname === '/api/brief' && req.method === 'POST') return await brief(req, res);
    if (url.pathname === '/api/speak' && req.method === 'POST') return await speak(req, res);
    if (url.pathname === '/api/layout' && req.method === 'POST') return await layout(req, res);

    const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT + path.sep) || rel.includes('/.')) return send(res, 403, 'Forbidden', 'text/plain');
    send(res, 200, await readFile(file), MIME[path.extname(file)] ?? 'application/octet-stream');
  } catch (err) {
    if (res.headersSent) return res.end();
    send(res, err.code === 'ENOENT' ? 404 : 500, err.code === 'ENOENT' ? 'Not found' : 'Server error', 'text/plain');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Roll Call on http://localhost:${PORT}  (simulation: /, live nodes: /live.html)`);
  console.log(`Gemini brief: ${GEMINI_KEY ? 'on' : 'off'}   ElevenLabs voice: ${ELEVEN_KEY ? 'on' : 'off'}`);
});
