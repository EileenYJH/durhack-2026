// Turns the simulation's event log into radio traffic: what command says to a
// firefighter, what the firefighter reports back, and what is broadcast to
// all crews. Labels in the log look like "Responder 2"; crews are called R2.

const L = '(Responder \\d+)';
const id = (label) => `R${label.split(' ')[1]}`;

const RULES = [
  [new RegExp(`^To ${L}: (.*)$`), (m) => ({ from: 'command', ff: id(m[1]), text: m[2] })],
  [new RegExp(`^${L} heads for (.+?)\\. (.*)$`), (m) => ({ from: 'command', ff: id(m[1]), text: `Search ${m[2]}. ${m[3]}` })],
  [new RegExp(`^${L} found (\\d+) in (.+)$`), (m) => ({ from: 'ff', ff: id(m[1]), text: `Found ${m[2]} in ${m[3]}. Bringing them out.` })],
  [new RegExp(`^${L} searched (.+): clear$`), (m) => ({ from: 'ff', ff: id(m[1]), text: `${m[2]} searched. Clear.` })],
  [new RegExp(`^${L} is low on air and withdrawing$`), (m) => ({ from: 'ff', ff: id(m[1]), text: 'Low on air. Coming out.' })],
  [new RegExp(`^${L} is pulling out: (.*)$`), (m) => ({ from: 'command', ff: id(m[1]), text: `Get out now: ${m[2]}.`, urgent: true })],
  [new RegExp(`^${L} is driven out of (.+) by the heat$`), (m) => ({ from: 'ff', ff: id(m[1]), text: `Too hot in ${m[2]}. Pulling back.` })],
  [new RegExp(`^${L} will not enter (.+): (.+)$`), (m) => ({ from: 'ff', ff: id(m[1]), text: `${m[2]} is at ${m[3]}. Not going in.` })],
  [new RegExp(`^${L} reports the way from (.+) to (.+) is impassable$`), (m) => ({ from: 'ff', ff: id(m[1]), text: `Way from ${m[2]} to ${m[3]} is blocked.` })],
  [new RegExp(`^${L} has fresh air and is going back in$`), (m) => ({ from: 'ff', ff: id(m[1]), text: 'Fresh cylinder. Going back in.' })],
  [new RegExp(`^MAYDAY\\. ${L} is down in (.+?): (.*)$`), (m) => ({ from: 'ff', ff: id(m[1]), text: `MAYDAY, MAYDAY, MAYDAY. Down in ${m[2]}, ${m[3]}.`, urgent: true })],
  [
    new RegExp(`^${L} breaks off to reach ${L} in (.+?)(?: \\(.*\\))?$`),
    (m) => [
      { from: 'command', ff: id(m[1]), text: `${id(m[2])} is down in ${m[3]}. Go to them now.`, urgent: true },
      { from: 'command', ff: id(m[2]), text: `Stay where you are. ${id(m[1])} is coming to you.`, urgent: true },
    ],
  ],
  [new RegExp(`^${L} has reached ${L}\\. Both are withdrawing\\.$`), (m) => ({ from: 'ff', ff: id(m[1]), text: `With ${id(m[2])}. Both coming out.` })],
  [new RegExp(`^${L} found no one from the crew in (.+)$`), (m) => ({ from: 'ff', ff: id(m[1]), text: `No crew in ${m[2]}.` })],
  [/^Contact lost with (Responder \d+) in (.+)$/, (m) => ({ from: 'command', ff: null, text: `All crews: contact lost with ${id(m[1])} in ${m[2]}.`, urgent: true })],
  [/^(Alarm raised\..*)$/, (m) => ({ from: 'command', ff: null, text: `All crews: ${m[1]}`, urgent: true })],
  [/^(Fire has spread to .+)$/, (m) => ({ from: 'command', ff: null, text: `All crews: ${m[1]}.` })],
  [/^(A second fire has started in .+)$/, (m) => ({ from: 'command', ff: null, text: `All crews: ${m[1]}.`, urgent: true })],
  [/^Flashover in (.+?)\..*$/, (m) => ({ from: 'command', ff: null, text: `All crews: flashover in ${m[1]}. Keep clear.`, urgent: true })],
  [/^Radio jammed.*$/, () => ({ from: 'command', ff: null, text: 'All crews: radio is being jammed. Work from your own picture.', urgent: true })],
];

// One log entry to zero or more radio messages.
export function toRadio(entry) {
  for (const [re, make] of RULES) {
    const m = re.exec(entry.text);
    if (!m) continue;
    const out = make(m);
    return (Array.isArray(out) ? out : [out]).map((r, i) => ({ ...r, n: `${entry.n}.${i}`, t: entry.t }));
  }
  return [];
}
