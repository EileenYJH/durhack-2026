// ARIA server. No dependencies: node server.js
//
// It does three small jobs:
//   1. serves the static files;
//   2. forwards mesh messages between devices (it stores nothing and decides
//      nothing: every device keeps its own state and merges for itself);
//   3. keeps the Gemini and ElevenLabs credentials off the client.

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGemini } from './src/server/gemini.js';

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

const gemini = createGemini();
const ELEVEN_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVEN_VOICE = process.env.ELEVENLABS_VOICE_ID ?? 'JBFqnCBsd6RMkjVDRZzb';
const ELEVEN_MODEL = process.env.ELEVENLABS_MODEL ?? 'eleven_flash_v2_5';
const ELEVEN_AGENT = process.env.ELEVENLABS_AGENT_ID; // the "Command" voice agent (scripts/setup-voice-agent.js)

// Voice settings for fire incident context: urgent, clear, authoritative
const ELEVEN_VOICE_SETTINGS = {
  stability: 0.3,        // lower = more expressive/variable delivery
  similarity_boost: 0.8, // stay close to voice character
  style: 0.6,            // expressiveness (flash/turbo models)
  use_speaker_boost: true,
};

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

const LAYOUT_RULES = `You read a picture of a building floor plan, for example a fire evacuation or architect's plan, and return JSON only.
Give every position in your usual 0-1000 grid over the whole picture, as box_2d = [ymin, xmin, ymax, xmax] and point = [y, x].
Rooms:
- One entry for every labelled room (use the label printed on the plan as the name, for example "TLC025").
- One entry for each main circulation space: corridors, the main hall, atrium, foyer or cafe that people walk through. Set "hall": true for these and false for rooms.
- Leave out small service spaces (toilets, stair cores, lifts, cupboards, plant rooms) unless they are large.
- Use rectangles. If a space is L-shaped, give its largest rectangular part.
- Neighbouring spaces must share edges exactly: where a room meets a corridor, the room's edge and the corridor's edge have the same value. Rooms must not overlap each other or the corridors.
Doors:
- One door for each opening that connects two spaces you listed, or a space to the outside.
- "a" and "b" are room ids, or "OUT" for the outside. point = [y, x] on the wall the two spaces share.
- Exits: every door on the outer wall of the building, especially any marked "entrance" or with an arrow. Include at least one exit.
Return exactly: {"name": "<plan title or building>", "rooms": [{"id": "R1", "name": "...", "hall": false, "box_2d": [ymin, xmin, ymax, xmax]}], "doors": [{"id": "d1", "a": "R1", "b": "R2", "point": [y, x]}]}
If there is no floor plan in the picture, return {"name": "", "rooms": [], "doors": []}.`;

const DIRECTIONS_RULES = `You rewrite turn-by-turn fire evacuation directions so they sound natural when spoken to a responder over a radio earpiece.
Input: literal steps such as "Turn left and head north along the corridor. Room 102 is the 2nd door on your right."
Rules:
- Say exactly the same thing. Keep every room name, every left or right, every compass direction (north, south, east, west), every door number such as "2nd", and every mention of an exit or entrance. Use each of those words the same number of times as the input.
- You may change only the phrasing: contractions, a calmer rhythm, joining short sentences.
- Never add or remove a room, turn, door or exit. Never add advice, warnings or hazards.
- If the input says there is no route, say that there is no route that avoids the fire.
- No markdown, no lists, plain spoken English, at most 120 words.`;

const VOICE_PARSE_RULES = `You parse a firefighter's voice report into structured JSON for an occupancy tracking system.
Input: a spoken transcript like "Lab 1 is clear" or "Found two adults in Workshop" or "Corridor blocked by debris".
Known rooms (ID → Name):
  A → "Lab 1"
  B → "Lab 2"
  C → "Seminar"
  D → "Workshop"
  E → "Store"
  F → "Office"
  COR → "Corridor" (hallway, not searched)
Valid states: "empty" (confirmed clear), "occupied" (people moving), "still" (people not moving), "possible" (uncertain).
Output JSON only:
{
  "room": "A" | "B" | "C" | "D" | "E" | "F" | "COR" | null,
  "state": "empty" | "occupied" | "still" | "possible" | null,
  "count": number,
  "details": "original transcript"
}
Rules:
- Match room names flexibly (e.g., "lab one" → "A", "workshop" → "D", "corridor" → "COR").
- "clear" / "empty" / "all clear" / "nobody" / "no one" → state: "empty", count: 0.
- "found X people" / "X adults" / "X victims" / "X inside" → state: "occupied", count: X.
- "not moving" / "unconscious" / "down" / "still" → state: "still".
- "maybe" / "think" / "possible" / "heard" / "unsure" → state: "possible".
- If room cannot be identified, return null for room and state.
- No markdown, JSON only.`;

function extractJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('no JSON in the reply');
  return JSON.parse(text.slice(start, end + 1));
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

// A Gemini failure is reported as 503 when it is a setup problem (nothing to
// retry) and 502 when Google itself refused or failed.
const geminiFailure = (res, err) => send(res, gemini.ready() ? 502 : 503, { error: err.message });

async function layout(req, res) {
  const { image } = JSON.parse(await readBody(req, 8_000_000));
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(image ?? '');
  if (!m) return send(res, 400, { error: 'Send a JPEG, PNG or WebP image.' });
  try {
    // Same route as every other Gemini call (Vertex AI or AI Studio, set in .env).
    const text = await gemini.generate(LAYOUT_RULES, [{ text: 'Read this floor plan.' }, { inlineData: { mimeType: m[1], data: m[2] } }], {
      temperature: 0.1,
      maxTokens: 8000,
      responseMimeType: 'application/json',
    });
    let parsed;
    try {
      parsed = extractJson(text);
    } catch {
      return send(res, 502, { error: 'Gemini did not return a layout' });
    }
    if (!parsed.rooms?.length) return send(res, 422, { error: 'No floor plan found in that picture.' });
    send(res, 200, { layout: parsed, model: gemini.model });
  } catch (err) {
    geminiFailure(res, err);
  }
}

async function directions(req, res) {
  const { steps } = JSON.parse(await readBody(req));
  if (!Array.isArray(steps) || !steps.length || steps.length > 40 || !steps.every((s) => typeof s === 'string')) return send(res, 400, { error: 'Send { steps: [strings] }' });
  try {
    const text = await gemini.generate(DIRECTIONS_RULES, [{ text: steps.join(' ') }], { temperature: 0.3, maxTokens: 400 });
    send(res, 200, { text, model: gemini.model });
  } catch (err) {
    geminiFailure(res, err);
  }
}

async function voiceParse(req, res) {
  const { transcript } = JSON.parse(await readBody(req));
  if (!transcript || typeof transcript !== 'string') return send(res, 400, { error: 'Send { transcript: "..." }' });
  try {
    const text = await gemini.generate(VOICE_PARSE_RULES, [{ text: transcript }], { temperature: 0.1, maxTokens: 300, responseMimeType: 'application/json' });
    let parsed;
    try {
      parsed = extractJson(text);
    } catch {
      return send(res, 502, { error: 'Gemini did not return valid JSON' });
    }
    // Validate required fields
    if (!parsed.room || !parsed.state) {
      return send(res, 502, { error: 'Missing room or state in parsed result' });
    }
    send(res, 200, parsed);
  } catch (err) {
    geminiFailure(res, err);
  }
}

async function brief(req, res) {
  const data = await readBody(req);
  try {
    const text = await gemini.generate(BRIEF_RULES, [{ text: data }], { temperature: 0.2, maxTokens: 800 });
    send(res, 200, { text, model: gemini.model });
  } catch (err) {
    geminiFailure(res, err);
  }
}

// A short-lived token so a phone can open a live voice call with the Command
// agent without ever seeing the API key.
// A signed link for a typed (text-only) conversation with the same agent,
// used by the recorded demo, which has no microphone.
async function voiceSignedUrl(req, res) {
  if (!ELEVEN_KEY || !ELEVEN_AGENT) return send(res, 503, { error: 'Voice calls need ELEVENLABS_API_KEY and ELEVENLABS_AGENT_ID.' });
  const r = await fetch(`https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(ELEVEN_AGENT)}`, { headers: { 'xi-api-key': ELEVEN_KEY } });
  const out = await r.json().catch(() => ({}));
  if (!r.ok || !out.signed_url) return send(res, 502, { error: `ElevenLabs returned ${r.status}` });
  send(res, 200, { url: out.signed_url });
}

async function voiceToken(req, res) {
  if (!ELEVEN_KEY || !ELEVEN_AGENT) return send(res, 503, { error: 'Voice calls need ELEVENLABS_API_KEY and ELEVENLABS_AGENT_ID.' });
  const r = await fetch(`https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=${encodeURIComponent(ELEVEN_AGENT)}`, { headers: { 'xi-api-key': ELEVEN_KEY } });
  const out = await r.json().catch(() => ({}));
  if (!r.ok || !out.token) return send(res, 502, { error: `ElevenLabs returned ${r.status}`, detail: JSON.stringify(out.detail ?? out).slice(0, 200) });
  send(res, 200, { token: out.token });
}

// Named voices for the demo video: a narrator, a firefighter on the radio, and
// Command (the same voice as the live agent). They use the newest, most
// expressive model, which performs cues such as [panting] instead of reading them.
const NAMED_VOICES = { narrator: 'onwK4e9ZLuTAKqWW03F9', firefighter: 'pNInz6obpgDQGcFmaJgB', command: ELEVEN_VOICE };

async function speak(req, res) {
  if (!ELEVEN_KEY) return send(res, 503, { error: 'no ELEVENLABS_API_KEY set' });
  const { text, voice } = JSON.parse(await readBody(req));
  if (voice && NAMED_VOICES[voice]) {
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${NAMED_VOICES[voice]}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'xi-api-key': ELEVEN_KEY },
      body: JSON.stringify({ text: String(text).slice(0, 800), model_id: 'eleven_v4' }),
    });
    if (!r.ok) return send(res, 502, { error: `ElevenLabs returned ${r.status}`, detail: (await r.text()).slice(0, 300) });
    return send(res, 200, Buffer.from(await r.arrayBuffer()), 'audio/mpeg');
  }
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVEN_VOICE}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'xi-api-key': ELEVEN_KEY },
    body: JSON.stringify({
      text: String(text).slice(0, 800),
      model_id: ELEVEN_MODEL,
      voice_settings: ELEVEN_VOICE_SETTINGS,
    }),
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
    if (url.pathname === '/api/status') return send(res, 200, { gemini: gemini.ready(), provider: gemini.provider, elevenlabs: Boolean(ELEVEN_KEY), voiceAgent: Boolean(ELEVEN_KEY && ELEVEN_AGENT), peers: meshes.get(mesh)?.size ?? 0 });
    if (['/api/brief', '/api/speak', '/api/layout', '/api/directions', '/api/voice-parse', '/api/voice-report', '/api/voice-token', '/api/voice-signed-url'].includes(url.pathname) && limited(req, 120)) return send(res, 429, { error: 'Too many requests. Wait a minute.' });
    if (url.pathname === '/api/brief' && req.method === 'POST') return await brief(req, res);
    if (url.pathname === '/api/speak' && req.method === 'POST') return await speak(req, res);
    if (url.pathname === '/api/voice-token' && req.method === 'GET') return await voiceToken(req, res);
    if (url.pathname === '/api/voice-signed-url' && req.method === 'GET') return await voiceSignedUrl(req, res);
    if (url.pathname === '/api/layout' && req.method === 'POST') return await layout(req, res);
    if (url.pathname === '/api/directions' && req.method === 'POST') return await directions(req, res);
    if (url.pathname === '/api/voice-parse' && req.method === 'POST') return await voiceParse(req, res);
    if (url.pathname === '/api/voice-report' && req.method === 'POST') return await voiceParse(req, res);

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
  console.log(`ARIA on http://localhost:${PORT}  (simulation: /, live nodes: /live.html)`);
  console.log(`Gemini: ${gemini.ready() ? `on, ${gemini.describe()}` : `off (${gemini.problem()})`}   ElevenLabs voice: ${ELEVEN_KEY ? 'on' : 'off'}`);
});
