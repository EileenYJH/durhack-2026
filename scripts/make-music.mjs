// Makes the demo's background music with ElevenLabs Music, saved to
// demo-assets/music.mp3 (not committed). node scripts/make-music.mjs
// The recorder loops it and mixes it loud on the title and end cards, quiet
// under narration, and out of the way while the firefighter and Command talk.

import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

try {
  process.loadEnvFile();
} catch {
  // use the environment as it is
}
const KEY = process.env.ELEVENLABS_API_KEY;
if (!KEY) {
  console.log('Set ELEVENLABS_API_KEY first.');
  process.exit(1);
}
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'demo-assets', 'music.mp3');

const prompt =
  'Instrumental cinematic underscore for a fire-rescue technology film. Starts quiet and hopeful with a soft piano motif and warm synth pad, ' +
  'builds slowly with a low pulsing bass and gentle strings to a steady, tense but controlled middle, then resolves to a calm, confident, uplifting ending. ' +
  'No drums kit, no vocals, no lyrics, no sudden hits. Even volume, suitable to sit under narration.';

const r = await fetch('https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'xi-api-key': KEY },
  body: JSON.stringify({ prompt, music_length_ms: 120000, force_instrumental: true }),
});
if (!r.ok) {
  console.log(`ElevenLabs Music returned ${r.status}: ${(await r.text()).slice(0, 300)}`);
  process.exit(1);
}
mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, Buffer.from(await r.arrayBuffer()));
console.log(`saved ${OUT}`);
