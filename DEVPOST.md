# ARIA: who is still inside, even when the building is burning around the answer

**Live demo:** https://durhack-2026-production.up.railway.app · **Repository:** https://github.com/EileenYJH/durhack-2026 · **Gemini project number:** 577567729000

## Inspiration

At a building fire, the incident commander keeps making the same decision: send crews in to search, or fight the fire from outside. That decision depends on one question nobody can answer well: **who is still inside, and where?**

Today the answer is put together from:
- a paper roll call at the assembly point;
- a fire alarm panel that knows where the smoke is, but not where the people are;
- badge systems that know who came in, but not who is still in which room;
- radio messages on one crowded channel.

And the fire attacks the tools themselves: sensors burn, radio fades behind concrete and in smoke, and the commander loses the picture exactly when it matters most.

I asked: what if every sensor and every firefighter kept **its own copy of the picture**, and the copies agreed again whenever they could hear each other?

## What it does

- **Photo → building.** Upload a photo of the fire evacuation plan from the wall. Gemini reads the rooms and doors; ARIA repairs the gaps (snaps walls, adds missing doors, exits and corridors), lists every repair, and keeps the photo underneath so a person can check every wall. The building cannot be used until it passes the checks.
- **Every node keeps its own picture.** Door counters, room sensors, firefighters and the command post each hold a copy of the shared state and work out, for every room, one of: occupied and still, occupied, possibly occupied, **unknown**, or confirmed empty. Each state comes with the reason and how fresh it is.
- **Nobody hands out rooms.** Each firefighter works out the whole team's assignment from its own copy (rooms by urgency, teammates by the position each broadcasts, taking turns in a fixed order R1, R2, R3) and follows its own part. Same rules on the same data give the same answer on every device, so they split the rooms without a radio call.
- **It keeps working when things break.** Cut the radio between two wings, jam all radio, collapse a doorway, kill a sensor, start a second fire: every node keeps deciding from what it last heard. A room nobody can hear from turns **unknown, never empty**. When the link comes back, the copies agree again.
- **A fire that fights back.** Heat and smoke spread through doorways; sensors fail in the heat; smoke blinds cameras and weakens radio; rooms flash over; people collapse; firefighters run on limited air and pull out while their way out is still below 240°C.
- **Crews look after each other.** When a firefighter calls a mayday, the nearest free teammate sees it in its own copy, breaks off, walks to them and brings them out together. No commander has to assign the rescue.
- **A firefighter phone.** Scan a QR code and a phone becomes one firefighter: their current order, turn-by-turn route, air, their own picture of the building, and radio messages (read aloud if voice is on). Buttons: room clear, casualty here, way out, mayday. Tap a room to steer the firefighter; ARIA refuses an order into a room believed to be burning, and says why.
- **Talk to Command.** A live two-way voice call with an ElevenLabs agent that answers only from this firefighter's live data, through four tools. The firefighter can interrupt it at any time. Urgent orders are spoken into the call as soon as the agent is listening, never on top of it.
- **A spoken commander's brief.** Gemini writes a short brief from the command post's data, and ElevenLabs reads it. If Gemini calls any room empty that the data does not confirm, the brief is thrown away and a rule-based brief is read instead.

## How I built it

Plain JavaScript modules in the browser, and one small Node server with no dependencies and no build step.

| Part | What it does | How |
|---|---|---|
| `src/core/replica.js` | Each node's copy of the shared state | Every record has **exactly one writer** and a sequence number only that writer increases. Merging keeps the higher sequence, so copies converge whatever order messages arrive in, however often they repeat. Records carry their **age**, not a timestamp, so device clocks never have to agree. |
| `src/core/belief.js` | Room state from door counts, room sensors and searches | Rule-based, not probabilistic. Sightings decay with age. "Empty" must outlast the last sighting, and is trusted only for a few seconds before the room turns unknown again. A sensor that goes silent while reading hot is presumed burnt. A sensor blinded by smoke says nothing rather than saying "empty". |
| `src/core/hazard.js` | Each node's belief about heat and fire per room | From its own copy of the sensor and firefighter readings. |
| `src/core/assign.js` | Who searches which room | An urgency score per room (people not moving first; raised when people are believed to be in a room that is heating up; a burning room with nobody known inside is not searched at all). Then each firefighter, in a fixed order, takes the room with the best urgency minus distance that it can reach without crossing the fire. The fixed order is why everyone arrives at the same assignment without talking. A room a teammate has just attended is left alone. |
| `src/core/building.js`, `directions.js` | Routes and spoken directions | Breadth-first search over the graph of rooms and doors, avoiding rooms believed on fire and doors reported impassable, then turned into radio-style steps. |
| `src/core/layout.js`, `planfit.js` | Building model, Gemini import repair | Validation, wall snapping, door placement, added exits and corridors, with a note for every change. |
| `src/sim/sim.js` | The incident | People, sensors, firefighters, fire, smoke, air, radio links, and the "Break it" controls. |
| `server.js` | Static files, message relay, AI proxies | The relay only forwards messages and holds no picture of the building. API keys stay on the server, and AI requests are rate limited. |

**Gemini** runs on Vertex AI (`gemini-3.5-flash`) in my Google Cloud project, with a service account on the hosted copy. It does four jobs: reading the floor plan photo, writing the commander's brief, smoothing route wording (thrown away unless every turn, direction and room name survives unchanged), and acting as the language model inside the voice agent. **None of them make a safety decision**, and every feature still works without Gemini.

**ElevenLabs** provides the live voice agent (Agents platform: WebRTC call, client tools, turn model `turn_v3` in eager mode so the firefighter can interrupt, `eleven_v4_turbo` voice), with a short-lived token from my server so the key never reaches the phone. It also reads the radio messages, the brief and the routes aloud. The demo video's voices and music were made with ElevenLabs too.

**Why voice:** inside a fire a firefighter cannot look at a screen. Their hands hold a hose, tools or a casualty; their gloves are thick; their mask fogs; smoke can mean zero visibility. Radio is already how they work. A calm, human voice is easier to follow under stress than robotic speech, and the firefighter must be able to cut in ("mayday!") at any moment.

### How I chose the voices, and the feeling in them

On a fireground, **how** something is said matters as much as what is said. A frightened firefighter needs to hear steadiness, and a commander needs to tell at once who is speaking. So each voice was chosen for a job.

| Who | ElevenLabs voice | Why this voice | The feeling it carries |
|---|---|---|---|
| **Command** (the live agent, the commander's brief, the radio) | **Alexis Lancaster**: warm, gentle, middle-aged British female | The opposite of the fireground: calm where the firefighter is breathless, unhurried where everything else is urgent. A female voice stands out clearly from a crew of mostly male radio voices, so "this is Command" is recognised from the first word. British, like the crews it would serve. | **Calm and steady.** The agent is told to speak like an experienced fire officer: short sentences, one instruction at a time, never more than three sentences unless reading directions. A steady voice tells a frightened person "someone has this under control", which helps them follow the instruction. |
| **Firefighter R1** (the demo video) | **Adam**: firm, a voice that cuts through | A firefighter's voice has to carry over noise, through a mask and a radio. | **Real strain.** Generated on `eleven_v4` with audio tags: `[panting]` when asking the way out through thick smoke, `[urgent, out of breath]` for the mayday. Then a radio filter. The contrast with Command's calm is the point of the design. |
| **Narrator** (the demo video) | **Daniel**: steady broadcaster | Clear and neutral, so judges follow the story without it competing with the fireground voices. | **Neutral.** |

**Tuning the feeling, not just the words:**
- The commander's brief and the radio messages use expressive settings (stability 0.3, style 0.6, speaker boost), so an urgent "all crews: flashover, keep clear" *sounds* urgent and still stays clear.
- The live agent uses `eleven_v4_turbo` for a quick reply, with steadier settings (stability 0.5, normal speed), so Command never sounds rushed, even when the situation is.
- The agent never raises its voice to compete. Urgent news is spoken into the call only while the firefighter is not talking, and the firefighter can interrupt the agent at any time.

## How I measured it

`node scripts/evaluate.js 100`: 100 simulated fires of 110 seconds each. Each run has the fire spreading at 1x to 3x, a cut link between the wings, an 8-second radio jam, and up to two extra sensor failures. Every half second, every live node's belief about every room is compared with the truth.

| Measure | Result |
|---|---|
| Occupied room shown as confirmed empty (the unsafe error) | **0.353%** of 469,196 checks |
| Occupied room shown as unknown (the honest answer) | 3.54% |
| Empty room shown as occupied (the safe error) | 5.9% |
| Rooms wrongly empty on the command post at the end of a run | **0 of 100** |
| Sensors destroyed by the end of a run | 56.8% |
| Agreement after the link returns | mean 10.5 s, worst 52.7 s |

**What measuring made me fix:**

| Problem found | Before | After |
|---|---|---|
| Firefighters caught in a flashover | 57 in 100 runs | 0, after adding "leave while the way out is still below 240°C" |
| Searches in total | 1,082 | 562 |
| Unsafe "empty" (runs without fire) | 1.008% | 0.284%, after making "empty" outlast the last sighting and trusting it for 6 s instead of 22 s |

**Still weak, and said so:** 27.8% of searches repeat a room another firefighter searched in the last 45 seconds, mostly while the radio is cut or jammed. The fire and survival figures come from simple rules chosen to look plausible, not from a validated fire model, and the sensor error rates are assumptions. Full method and results: `docs/evaluation.md`. There are 74 automated tests (`npm test`).

## Challenges I ran into

- **Making "no answer" safe.** The easy mistake is to treat a silent sensor as an empty room. In a fire, silence usually means the sensor burnt. Getting the unsafe rate down meant making "empty" hard to earn and quick to expire, at the cost of more rooms showing unknown. That trade is deliberate.
- **Merging without a referee.** Two copies can disagree about what they have heard, but never about what is true, because every record has one owner. That one rule made merging after a cut instant and order-independent.
- **Letting AI help without letting it decide.** Gemini is good at messy photos and natural wording, and can be confidently wrong. Every Gemini output is checked against the data, and anything that fails is replaced by the plain rule-based version.
- **Rescue that really works.** Watching the recorded demo showed the rescuer "reaching" a casualty from across a big hall and the two leaving separately. Now the rescuer crosses the room, and the casualty stays at the rescuer's side all the way to the assembly point. A test checks it.

## Accomplishments I'm proud of

- Under failure it says **"unknown"** instead of pretending, and it is measured to do so.
- A live voice agent a firefighter can interrupt, grounded in that firefighter's own picture of the building.
- A real building (the Teaching and Learning Centre where DurHack is held) imported from a photo of its evacuation plan.
- Solo, in 24 hours, with numbers to back the claims.

## What I learned

- In a distributed system for emergencies, the hardest part is not sharing data. It is deciding what a node should believe when it has **not** heard anything.
- Single-writer records and ages instead of timestamps remove most of the hard problems of agreeing without a server.
- Measuring early changes the design: two of the most important rules came straight from the evaluation.

## What's next

- **Real sensors and cameras as nodes.** A camera node that counts people on the device (sharing counts, never images) already exists as an experiment; it is not part of this submission. Cameras are blind in smoke, which is exactly why the design handles silent sensors.
- **Device-to-device radio** (Wi-Fi, Bluetooth or LoRa) instead of the relay server. The sharing rules do not depend on how messages travel.
- **Several floors**, with stairs in the route graph.
- **Testing the voice with a fire service** in real breathing apparatus, through their existing radios or bone-conduction headsets.

## How it fits the tracks

- **Neptune North (actors work better together):** many actors, one goal (find everyone), each deciding alone, and still working when communication is cut, jammed or burnt.
- **Accenture:** the fire roll call is a process everyone accepts as "just how it works". AI reads the building from a photo, writes the brief and talks to the firefighter, while the safety decisions stay with rules and people.
- **MLH Best Use of ElevenLabs:** voice is the only interface that works inside a burning building. Each voice was chosen for its job and its feeling: Command is warm and steady against the firefighter's breathless urgency, interruptible, and grounded in live data.
- **MLH Best Use of Gemini API:** four Gemini features on Vertex AI, each checked against the data, none trusted with a safety decision.

## Built with

JavaScript (browser ES modules) · Node.js 22 · Gemini on Google Cloud Vertex AI · ElevenLabs Agents, Text to Speech and Music · Railway · Server-Sent Events relay · SVG
