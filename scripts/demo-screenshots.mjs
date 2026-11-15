// Takes Devpost screenshots from the last recorded demo, each a few seconds into
// the voice line of its scene (times from demo-video/work/voices.txt).
//   node scripts/demo-screenshots.mjs   ->  docs/screenshots/*.png

import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VIDEO = path.join(ROOT, 'demo-video', 'aria-demo.mp4');
const OUT = path.join(ROOT, 'docs', 'screenshots');
const voices = readFileSync(path.join(ROOT, 'demo-video', 'work', 'voices.txt'), 'utf8').trim().split('\n').map((l) => Number(l.split('\t')[0]));

// [index of the voice line, seconds into it, file name]; the order of lines is
// fixed by src/demo/director.js (a run without a mayday has fewer lines: check them)
const SHOTS = [
  [1, 6, '01-photo-gemini-reads'],
  [2, 5, '02-plan-over-photo'],
  [4, 6, '03-fire-sensors-fail'],
  [5, 5, '04-firefighter-phone-joins'],
  [9, 6, '05-talk-to-command'],
  [11, 3, '06-mayday'],
  [12, 7, '07-teammate-reaches-r1'],
  [14, 3, '08-order-refused'],
  [15, 8, '09-radio-jammed-unknown'],
  [16, 4, '10-second-fire'],
  [17, 6, '11-measured'],
];

mkdirSync(OUT, { recursive: true });
for (const f of readdirSync(OUT)) if (f.endsWith('.png')) rmSync(path.join(OUT, f));
for (const [i, off, name] of SHOTS) {
  if (voices[i] === undefined) continue;
  const t = (voices[i] + off).toFixed(2);
  execFileSync('ffmpeg', ['-nostdin', '-y', '-loglevel', 'error', '-ss', t, '-i', VIDEO, '-frames:v', '1', path.join(OUT, `${name}.png`)]);
  console.log(`${name}.png at ${t} s`);
}
