# Roll Call: design spec (v2, software only)

Date: 2026-11-14. Event: DurHack 2026 (14-15 November, 24 hours). Team: solo.

Supersedes v1 (hardware build for the RS challenge). The loan library ran out of every board, so v2 needs no hardware. v1 is in git history.

## 1. Targets

| Prize | Why this project fits |
|---|---|
| Neptune North (primary) | Many actors, one goal, each decides alone, progress continues when comms fail |
| Accenture | The paper fire roll call is a frustrating process people accept; an LLM turns node data into a commander's brief |
| DurHack overall (theme: Composition) | Judged on creativity, polish, technical execution, research. The board is also heard: each room has a tone |
| MLH Best Use of ElevenLabs | Spoken commander's brief |
| MLH Best Use of Gemini API | The LLM brief |
| MLH DEV Writing Challenge | Write-up after the event |

Whether one project may enter several sponsor prizes is unconfirmed. Ask the organisers.

## 2. Problem

In a building fire, responders do not know who is still inside. The current answer is a warden's roll call against a register at the assembly point. It misses visitors, gives no location and is stale by the time crews arrive. Fixed systems that could help depend on a central panel and a network, and both fail in a fire.

## 3. What Roll Call is

A set of independent nodes that together keep one answer current: which rooms are confirmed empty, possibly occupied, occupied, or unknown. No node is in charge. Each node holds its own copy of the building state, decides from what it knows, and merges with any node it can reach.

Actors:

- **Door nodes** count crossings through one door, by direction.
- **Room nodes** report presence in one room (empty, moving, still).
- **Responders** carry a board, choose which room to search, and report what they find.

## 4. The hard part

Reconnecting and replaying messages is ordinary. The design work is in what nodes do while cut off and how conflicting observations are reconciled.

1. **Conflicting observations.** A door node says two people left room B; the room node still sees one. Neither is "the latest write". The answer must weigh sensor type, confidence and age, and every node must reach the same answer whatever order messages arrive in.
2. **No double counting.** A person who moves between rooms during a partition must be counted once after the merge.
3. **Knowledge decays.** "Room C is empty" is less true every minute. Each node ages other nodes' claims itself.
4. **Asymmetric safety.** Wrongly saying "empty" can kill; wrongly saying "occupied" costs a search. One credible sighting outweighs several empty reports. Silence is never evidence of absence.
5. **Deciding without a leader.** Two responders who cannot talk must not both pick the same room, and must not both assume the other has it.

## 5. Replicated state

Every piece of state has exactly one writer, so merging is safe without coordination.

| Record | Writer | Content | Merge rule |
|---|---|---|---|
| Door counter | That door's node | Crossings a->b and b->a (only ever increase), sequence number | Keep the higher sequence |
| Room report | One sensor or responder, per room | State (empty, moving, still), count, confidence, sequence | Keep the higher sequence per writer |
| Responder claim | That responder | Target room, position, sequence | Keep the higher sequence |

- A crossing is recorded once, by the door it went through, as "out of a, into b". Occupancy of a room is the sum of crossings in minus crossings out over its doors. Because each counter has one writer and only grows, merging by maximum converges to the same totals on every node, and a person moving between rooms is never counted twice.
- No synchronised clocks. Each record travels with its age, and the receiver converts that to its own clock. Age grows while a record waits in a cut-off node.
- Nodes gossip their full state to any neighbour they can reach, so records travel across several hops.

## 6. Belief

Belief is a pure function of a node's merged records and its own clock. Two nodes with the same records compute the same belief. Rules, in order:

1. A fresh sighting (moving or still) by any writer: **occupied** (or **occupied, still**). Count is the larger of the sighting and the door count.
2. A stale sighting never becomes empty. It becomes **possibly occupied**, "last seen N ago".
3. Fresh "empty" from the room sensor, door count zero, door counters fresh: **confirmed empty**.
4. Fresh "empty" but door count above zero, or the reverse: **possibly occupied**, with the disagreement shown.
5. "Empty" reports decay to **unknown** as they age. So do rooms whose door counters are stale.
6. No records: **unknown**.

Confidence is derived from age and agreement and is shown next to every state. A responder's search report counts as a strong sighting or a strong "empty" that also decays.

## 7. Responders

Each responder ranks rooms by a **rescue priority score** from its own belief: occupied-still first, then occupied, possibly occupied, unknown; adjusted by distance. The score is a heuristic, not a survival estimate, and is shown with its reasons.

Assignment without talking: every responder runs the same deterministic assignment over the last known roster and positions, and takes its own row. Responders with the same belief therefore pick different rooms. If beliefs differ they may overlap; claims are replicated records, so the overlap resolves when they next hear each other.

## 8. Build

Static web app, no build step, ES modules.

- `src/core/` replica (records, merge), belief, assignment. Pure functions, covered by tests.
- `src/sim/` ground-truth world (people moving in a floor plan), a network with links that can be cut, and the node behaviours with sensor noise.
- `src/ui/` the command board.

Stage 1 (this spec): every node runs in one page as a separate replica, joined by the simulated network. Each node's own belief can be inspected and compared with the truth.

Stage 2: real devices. A phone or laptop joins as a door node and counts with its camera (in-browser person detection, a tracker and a virtual line). Transport between devices is a relay that only forwards messages; each device keeps its own state.

Stage 3: the brief. An LLM (Gemini) writes the commander's brief from a node's belief, and ElevenLabs speaks it. Each room also has a tone, so the board can be heard.

Simulated parts are labelled on screen. Nothing here senses people through smoke; v1's radar is gone and the pitch must not claim it.

## 9. Demo

1. People move through the building; the board follows them.
2. Cut a link. The two sides disagree, visibly: open each node's own view.
3. A person changes room during the cut. Reconnect: the total is right and each room shows why.
4. An "empty" claim ages into "unknown" with no one touching it.
5. Two cut-off responders choose different rooms.
6. The brief is read aloud.

Scripted scenarios make each step repeatable. A recorded run is the backup.

## 10. Interface direction

Not a generic dark dashboard. The reference is the UK fire service's breathing-apparatus entry control board and a fire pre-plan drawing: a drawn floor plan, tally slots, signage colours (safe-condition green, fire red, hazard yellow) on a light drawing surface, condensed grotesque lettering and tabular figures. One accent (fire red) for action; state colours carry meaning and always come with a text label. Square corners throughout. Light and dark both supported.

## 11. Success criteria

- Tests show merge is order-independent and totals survive a partition.
- A sighting is never downgraded to empty by merge or by age.
- Each demo step above works from a scripted scenario.
- A silent room shows unknown, never empty.

## 12. Prior work

FireGuard (VTHacks, radar firefighter helmet); SUAR and ResistX (offline phone meshes for disaster communication); PULSE (low-cost radar rescue node); EWSN 2023 thermal and radar fusion; mmCounter (static people counting). None of those found does room-by-room occupant accounting with confidence for responders. These came from search summaries and were not read in full.
