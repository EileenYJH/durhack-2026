// Creates the "Command" voice agent in your ElevenLabs account, with the four
// tools the firefighter phone answers. Run once: node scripts/setup-voice-agent.js
// It prints the agent id to put in ELEVENLABS_AGENT_ID (in .env and on Railway).
// Running it again creates a new agent; delete old ones in the ElevenLabs dashboard.

try {
  process.loadEnvFile();
} catch {
  // use the environment as it is
}

const KEY = process.env.ELEVENLABS_API_KEY;
const VOICE = process.env.ELEVENLABS_VOICE_ID ?? 'JBFqnCBsd6RMkjVDRZzb';
const API = 'https://api.elevenlabs.io/v1/convai';
if (!KEY) {
  console.log('Set ELEVENLABS_API_KEY first.');
  process.exit(1);
}

async function post(path, body) {
  const r = await fetch(`${API}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'xi-api-key': KEY }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${path} returned ${r.status}: ${JSON.stringify(j.detail ?? j).slice(0, 400)}`);
  return j;
}

const TOOLS = [
  {
    name: 'get_situation',
    description: 'Current picture for this firefighter: their order, where they are, heat there, air left, people believed inside, rooms burning or unknown, nearest safe exit, radio contact, and the latest radio traffic. Call it before answering any question about the situation.',
    expects_response: true,
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_directions',
    description: 'Turn-by-turn directions from where the firefighter is now to a room, or to the nearest safe exit, avoiding rooms believed to be on fire. Read the steps back exactly; never invent a route.',
    expects_response: true,
    parameters: {
      type: 'object',
      properties: { destination: { type: 'string', description: 'A room name as the firefighter said it, or "exit" for the way out.' } },
      required: ['destination'],
    },
  },
  {
    name: 'report',
    description: 'Send the firefighter\'s report to the command board. Use when they say the room they are in is clear, or that they found a casualty there.',
    expects_response: true,
    parameters: {
      type: 'object',
      properties: { what: { type: 'string', enum: ['clear', 'casualty'], description: '"clear" if the room they are in is empty, "casualty" if they found someone there.' } },
      required: ['what'],
    },
  },
  {
    name: 'mayday',
    description: 'Raise a MAYDAY for this firefighter. Only when they say mayday, or clearly say they are trapped, lost, hurt or out of air.',
    expects_response: true,
    parameters: { type: 'object', properties: {}, required: [] },
  },
];

const PROMPT = `You are Command, the incident command radio operator at a building fire, talking to firefighter {{ff}} over their radio earpiece.

How you speak:
- Like a calm, experienced fire officer on the radio: short, clear sentences, one instruction at a time. Address them as {{ff}} when it matters.
- Never more than three sentences in a turn unless reading directions.
- If they interrupt, stop and answer what they just said.

What you know:
- You know nothing about the fire except what your tools return. Call get_situation before answering anything about the building, people, fire, heat, air or orders. Never guess.
- For directions, call get_directions and read the steps back in order, exactly. Do not shorten or change left, right, compass directions or door numbers.
- Never say a room is empty or safe unless get_situation says it is confirmed empty. Unknown means unknown.
- When a message starts with "URGENT FROM COMMAND", tell {{ff}} at once, in your own words, then give the safest instruction it implies.

What you can do:
- When they report a room clear or a casualty, call report, then confirm briefly.
- When they say mayday, or say they are trapped, lost, hurt or out of air, call mayday immediately, then tell them to stay where they are, keep their alarm sounding, and that a crew is coming.
- If they ask for something you cannot do, say so in one sentence.`;

const ids = [];
for (const t of TOOLS) {
  const out = await post('/tools', { tool_config: { type: 'client', response_timeout_secs: 15, ...t } });
  ids.push(out.id);
  console.log(`tool ${t.name}: ${out.id}`);
}

const agent = await post('/agents/create', {
  name: 'ARIA firefighter radio',
  tags: ['durhack-2026', 'aria'],
  // Only callers holding a token from our server can talk to it.
  platform_settings: { auth: { enable_auth: true } },
  conversation_config: {
    agent: {
      first_message: 'Command here, {{ff}}. Go ahead.',
      language: 'en',
      dynamic_variables: { dynamic_variable_placeholders: { ff: 'R1' } },
      prompt: { prompt: PROMPT, llm: 'gemini-2.5-flash', temperature: 0.3, tool_ids: ids },
    },
    tts: { voice_id: VOICE, model_id: 'eleven_v4_turbo' },
    turn: { turn_timeout: 7, turn_eagerness: 'eager', turn_model: 'turn_v3' },
  },
});
console.log(`\nagent: ${agent.agent_id}`);
console.log('Put this in .env and on Railway as ELEVENLABS_AGENT_ID.');
