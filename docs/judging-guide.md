# ARIA judging guide

How to demo ARIA to each track, what every button is for, why there is no central server, and answers to the questions judges are likely to ask.

Everything here was checked against the code and against `docs/evaluation.md`. If a number is not in this guide, do not say it.

---

## 0. The one-paragraph story (use it with every judge)

> In a building fire, the incident commander has to decide, every minute, whether to send crews in to search or to fight the fire from outside. That decision depends on one question nobody can answer well: **who is still inside, and where?** Today the answer comes from a paper roll call at the assembly point, a fire alarm panel that knows about smoke but not people, and radio messages on one crowded channel. And the fire itself destroys the sensors and the radio links as it spreads.
>
> ARIA gives every sensor and every firefighter **their own copy of the picture**. They share what they see whenever they can hear each other. When the radio fails, each one keeps deciding from what it last heard. A room nobody can hear from turns **unknown, never empty**. When the link comes back, they all agree again within seconds.
>
> On top of that, a firefighter can **just talk to Command**, a live ElevenLabs voice that answers from that firefighter's own live data and can be interrupted. And Gemini turns a photo of the evacuation plan on the wall into the building map in about 20 seconds.

**What is real and what is simulated.** The fire, the people and the sensors are simulated in the browser. The software that would run on real devices is real: the belief rules, the copying between devices, the search assignment, the routing, the phone app, the voice agent and the Gemini import. Say this up front. Judges trust you more for it.

---

## 1. Before the judges arrive

| Check | How |
|---|---|
| Main screen | Laptop, `https://durhack-2026-production.up.railway.app/` (the board). Press **Reset** so the clock reads 00:00. |
| Firefighter phone | Your phone. On the board, press **Firefighter phones**, scan the QR code, choose **R1**, **Go on air**. The phone must use the `https://` link, or the microphone will not work. |
| Sound | Laptop volume up. The phone's call uses the phone's own speaker and microphone. |
| Voice agent | Press **Talk to Command** once on the phone and say "Command, R1, radio check". Hang up. If it fails, ElevenLabs credits or the agent ID are the problem; use the video for the voice part. |
| Gemini | On the **Building** page, upload `tlc-level-00.webp` once. If Gemini is slow or fails, the built-in building still works for everything else. |
| Backup | `demo-video/aria-demo-small.mp4` on the laptop, ready to play. If the Wi-Fi dies, show the video and keep talking. |
| Not shown | The camera nodes (**Live nodes** page) are a future extension. Do not open it. The `dashboard.html` page is also not part of this demo. |

---

## 2. Every screen and button, and what it is for

### 2.1 The main board (`index.html`): the simulation and the command post's screen

**Top bar: numbers**

| Item | What it shows | Why it is there |
|---|---|---|
| **Incident clock** | Time since the simulation started. | Gives every log line and every reading a time. |
| **Believed inside** | How many people the command post *believes* are inside, from its own copy. | This is what a commander would actually see. |
| **Actually inside** | The real number, known only because this is a simulation. | Lets judges see when belief and truth differ. A real system would not have this number. |
| **Rooms unknown** | Rooms the command post has no fresh information about. | The honest answer when sensors burn or radio drops. Unknown is never shown as empty. |

**Top bar: buttons**

| Button | What it does | When to use it in the demo |
|---|---|---|
| **Building** | Opens the building editor (section 2.3). | To show the photo import. |
| **Live nodes** | Opens the camera node page. **Future extension: do not demo.** | Mention only: "real cameras and door counters join the same way." |
| **Raise alarm** | Starts the fire alarm. People start to leave, firefighters arrive and start searching. Changes to **Alarm active**. | The start of every demo. |
| **Cut the link** | Splits the radio network into two halves (east and west wing). Nodes on one side cannot hear the other side. Press again to restore. | **The key Neptune North moment**: both halves keep working, then agree again. |
| **Pause** | Freezes the simulation. | When a judge asks a question and you want to point at something. |
| **Speed 1x** | Changes the simulation speed. | Speed up a slow part; keep 1x while explaining. |
| **Reset** | Starts a fresh incident with the same building. | Between judges. |
| **Firefighter phones** | Shows the QR code and link for a phone to join as a firefighter. Shows how many phones are on air. | Before the phone part of the demo. |

**The "Break it" bar: chaos you cause on purpose**

Pick a mode, then click on the plan. Each one shows what happens when the real world goes wrong.

| Mode / button | Click on | What it simulates | What to point out |
|---|---|---|---|
| **Inspect** (default) | Any sensor or firefighter | Nothing breaks. The plan now shows **the building as that node believes it** (heading: "as believed by Responder 2"). | Every node has its own copy. Click two firefighters on opposite sides of a cut link and their pictures differ. |
| **Sever a link** | A line between two nodes | One radio link fails. | The information takes another path (gossip through other nodes). |
| **Collapse a doorway** | A door | That door becomes impassable. | The first firefighter who reaches it reports it, and every route avoids it from then on. |
| **Kill a sensor** | A sensor | The sensor dies. | Its room goes **unknown**, not empty. |
| **Start a fire** | A room | A new fire in that room. | Heat and smoke spread through doors; sensors near it start to fail; crews re-plan. |
| **Firefighter down** | A firefighter | A mayday for that firefighter. | The nearest free teammate breaks off on their own, walks to them, and brings them out together. |
| **Jam radio 10 s** | (button) | All radio lost for 10 seconds. | Everyone keeps working from their last picture; nothing is lost when it comes back. |
| **Fire speed 1x** | (button) | Makes the fire spread faster. | "Every second changes the decision." |

**The plan**

- **Coloured rooms:** the believed state of each room (see the key: occupied and still, occupied, possibly occupied, unknown, confirmed empty). Heat and smoke show as red and grey overlays. "FLASHOVER" appears when a room reaches 600°C.
- **Small squares and circles:** sensors (door counters and room sensors). A cross means destroyed.
- **Triangles with numbers:** firefighters R1 to R3. A red ring and "MAYDAY" means down. A yellow dashed ring and "PHONE" means someone is steering them from their phone.
- **White lines:** radio links that currently work. A line flashes thicker when it has just carried new information; faint lines are weakened by smoke; red dashed lines are cut.
- **Show real people (simulation only):** white dots for where people really are. Turn it off to show what the commander actually sees.

**The right-hand panel**

| Item | What it is for |
|---|---|
| **Search order** | The rooms to search first, with the reason ("someone not moving, seen 3 s ago"). Every firefighter computes this same list from their own copy, so nobody has to hand out rooms over the radio. |
| **Read the brief** | Writes a short spoken brief for the commander and reads it aloud. **Gemini writes it** from the command post's data, then a check reads it: if Gemini called any room empty that the data does not show as confirmed empty, the brief is thrown away and the rule-based brief is read instead. The line underneath says which brief was used and which voice read it (ElevenLabs, or the browser's voice if ElevenLabs is unavailable). |
| **Voice directions: From / To / Speak the route** | Turn-by-turn directions between two places, avoiding rooms believed to be on fire, read aloud by ElevenLabs. Gemini may smooth the wording, but only if every turn, direction and room name survives unchanged; otherwise the plain steps are read. |
| **Room list (tally)** | Every room with its state, count, confidence and how old the reading is. |

**Lower panels**

| Panel | What it is for |
|---|---|
| **Live measures** | People out, still inside, collapsed, lost, rooms burning, **sensors alive**, **radio messages lost**, firefighters down, searches, **repeated searches**, **reading age**, and **agreed again after** (seconds for every node to hold the same picture after a link comes back). These are the numbers that prove the design works under failure. |
| **What each node believes** | A grid: rooms down the side, nodes across the top. Each cell is that node's belief about that room. An **x** column is a dead node. During a cut link you can watch the columns disagree, then match again. |
| **Log** | Every event with its time: fires, sensor losses, searches, orders, refusals, maydays, rescues. |

### 2.2 The firefighter phone (`firefighter.html`)

**Joining:** type the channel code (or scan the QR code), pick R1, R2 or R3, and press **Go on air**.

| Item | What it is for |
|---|---|
| **Header: status, air, room, heat, signal** | Working / Withdrawing / Changing cylinder / MAYDAY; air left; where you are and how hot it is; whether you can hear anyone. |
| **Talk to Command** | Opens a **live voice call** with the ElevenLabs agent. Ask anything ("what's my way out?", "is anyone in Lab 2?", "room clear", "mayday"). It answers only from this firefighter's live data, and you can interrupt it. **End call** hangs up. While the call is open, urgent orders from the incident are spoken into the call, but only when the agent is listening, never on top of it. |
| **Order** | One instruction at a time ("Search Lab 2. Door counts 1 inside."), with turn-by-turn steps underneath. |
| **Your picture** | The building as **this firefighter** believes it, from their own copy. |
| **Tap a room or a green exit** | Take manual control: "go there". ARIA refuses an order into a room believed to be burning, or when the firefighter is withdrawing on low air, and says why on the radio. |
| **Back to auto** | Hand control back to ARIA's automatic search assignment. |
| **Radio** | Messages for this firefighter and for all crews. **Voice off / Voice on** reads them aloud (ElevenLabs). If messages pile up, older routine ones are dropped so the voice keeps up with the fire; urgent ones are kept. |
| **Room clear** | "The room I'm in is empty." Goes into everyone's copy as a search result. |
| **Casualty here** | "I found someone in this room." |
| **Way out?** | Asks for the route to the nearest safe exit. |
| **Mayday** | Asks for confirmation, then raises a mayday. The nearest free teammate breaks off on their own, walks to you, and brings you out together. |

### 2.3 The building editor (`editor.html`)

| Item | What it is for |
|---|---|
| **Photo of a floor plan** | Upload a photo of the fire evacuation plan from the wall. **Gemini reads rooms and doors from it** (as boxes on the photo), then ARIA repairs the gaps: it snaps walls together, adds missing doors and an exit if there is none, and adds a corridor for rooms that would be cut off. The photo stays underneath so a person can check every wall. |
| **Photo underneath / Hide photo** | How strongly the photo shows under the plan. |
| **Check** | Lists problems: a room with no way out, a door on no wall, and so on. **Use this building** stays disabled until the plan passes. |
| **Select and move / Draw room / Add door or exit / Delete** | Fix anything by hand. |
| **Download JSON / Import JSON** | Save and load a building. |
| **Start blank / Built-in building** | Start empty, or go back to the teaching block. |
| **Use this building** | Makes this the building for the simulation and for every phone. |

### 2.4 Camera nodes: future extension (do not demo)

The **Live nodes** page lets a laptop or phone camera join as a door counter or a room sensor, counting people on the device itself (only counts are shared, never images). It uses the same copy-and-share rules as the simulated sensors. **Say:** "Real sensors join the same way. Cameras are our next step; today we show the system with simulated sensors so you can see it under failure." Do not claim it works in smoke: cameras are blinded by smoke, which is exactly why the design must handle sensors going silent.

---

## 3. Demo scripts by track

Each script is about 3 minutes. If you only get 60 seconds, do the steps marked ★.

### 3.1 Neptune North: "Actors work better together"

**Their criteria:** a common goal; independent decisions; keeps working when communication fails; something you are excited about.

**Your angle:** in a fire, **every second changes the right decision, and the radio is the first thing to fail**. ARIA gets the most out of every moment of contact, and keeps everyone deciding well between those moments.

1. ★ **Raise alarm.** "A sensor on every door and in every room, three firefighters and the command post. Each has its own copy of the building. There is no server holding the truth."
2. **Inspect:** click R1, then R3. "Two firefighters, two pictures. Each decides from its own picture."
3. ★ **Search order.** "The common goal is to find everyone. Nobody hands out rooms: each firefighter runs the same rules on its own copy, so they split the rooms without one radio call. If R2 already took Lab 2, R3 sees that claim and goes elsewhere."
4. ★ **Cut the link.** "The fire has taken out the radio between the two wings." Point at **What each node believes**: the columns start to disagree. Rooms that nobody can hear from turn **unknown**, never empty. "Firefighters on each side keep searching from what they last heard."
5. ★ **Cut the link** again to restore it. Point at **Agreed again after … s**. "As soon as they hear each other, they agree again. Nothing is lost, and no clocks needed to match: each record carries its age, not a timestamp."
6. **Start a fire** in a room next to a firefighter. "Heat spreads through the door, the sensor dies (cross), and the room goes unknown. The firefighter pulls out on their own while the way out is still below 240°C. Before we added that rule, 57 firefighters in 100 runs were caught in flashovers. After it, none."
7. ★ **Firefighter down** on R1 (or **Mayday** from the phone). "Nobody assigns the rescue. The nearest free teammate sees the mayday in its own copy, breaks off, walks to R1 and brings them out together."
8. **Jam radio 10 s.** "Total radio loss. Watch the board: everyone keeps going."

**How ARIA makes the most of each moment of contact** (say these while the demo runs):
- **One order per firefighter**, with the reason and the route, instead of a stream of raw sensor data.
- **Search assignment without radio traffic**: because everyone computes the same order, "who takes room 3?" never goes on air.
- **Short, single-sender records**: each piece of information has exactly one owner (a sensor, a door, a firefighter). Copies never conflict, so merging after a cut is instant and safe.
- **Urgent first**: on the phone, routine messages are dropped if they pile up; urgent ones are kept. During a voice call, urgent orders are spoken into the call only when the agent is listening.
- **Unknown is a message too**: silence from a hot room is read as "that sensor is probably burnt", not as "the room is fine".

**What you are excited about:** "This is a swarm problem in real life. The same design works for drones, robots or LLM agents: each actor holds a copy, decides alone, and the copies agree when they meet."

### 3.2 Accenture: redesign a frustrating "that's just how it works" process with AI

**Their criteria:** problem and user pain; innovation; effective use of AI/LLMs; impact and value; prototype and technical execution; responsible AI and feasibility.

**The process everyone accepts:** at the assembly point, someone walks along the line with a register asking "is everyone here?". Badge systems know who came in, not who is still in which room. The fire panel knows where there is smoke, not where there are people. Firefighters search rooms that are already empty, and the one radio channel is full. Everyone treats this as "just how it works".

1. ★ **Building** → upload the evacuation plan photo. "Every building already has this plan on the wall. Gemini turns it into a working map in about 20 seconds, and ARIA repairs the gaps. Today pre-incident plans are drawn by hand, if at all."
2. ★ Back to the board: **Raise alarm**. "The roll call now runs itself, room by room, from sensors and from the firefighters' own reports."
3. ★ **Read the brief.** "Gemini writes the commander's brief from the live data, and ElevenLabs reads it. Responsible AI: the AI never decides. If Gemini calls any room empty that the data does not confirm, we throw the brief away and read the plain rule-based one. The screen says which one you heard."
4. **Talk to Command** on the phone. "A firefighter asks in plain words and gets an answer from live data, instead of waiting for a gap on the radio."
5. **Feasibility:** "It runs in a browser on phones and laptops that already exist. It works without the AI: every AI feature has a rule-based fallback."

### 3.3 Overall prizes (theme: Composition)

**Their criteria:** creativity and innovation; technical competence and execution; research and learning; polish and completion.

**Your angle: impact.** Composition here means many partial, failing pictures composed into one answer you can trust.

1. ★ The story (section 0), then **Raise alarm** and **Cut the link**: "many small pictures, none complete, composed into one answer that stays honest when parts of it fail."
2. ★ **Firefighter down** → rescue. "The system protects the rescuers, not just the occupants."
3. **Research and learning:** show `docs/evaluation.md`. "We measured it: 100 random fires, more than half the sensors destroyed (56.8%), and an occupied room was shown as empty in 0.353% of checks. Zero rooms wrongly empty at the end of any run. Measuring made us fix flashover deaths (57 → 0) and halve the number of searches (1,082 → 571). And we say what is still weak: 29.6% of searches repeat a room while the radio is cut."
4. **Why existing tools fall short** (see the table below).

| What exists today | What it knows | What it misses |
|---|---|---|
| Paper roll call at the assembly point | Who reached the assembly point | Where the missing people are; arrives late |
| Badge / access control | Who badged in | Who is still inside, and which room; tailgating; badges are not people |
| Fire alarm panel | Which detector is in alarm | People. And the detectors burn |
| Firefighter accountability boards (entry control, tally boards) | Which firefighters went in, and their air | The occupants; needs radio to update |
| Camera analytics | People in view | Cameras are blind in smoke and need a network and a server |
| **ARIA** | Each room: occupied, unknown or confirmed empty, with how fresh and how sure; plus firefighters, air, routes | Fire and sensors are simulated; real sensor integration is the next step |

### 3.4 MLH: Best Use of ElevenLabs

**Why voice matters here more than anywhere:**

- **Firefighters cannot look at a screen.** Hands hold a hose, tools or a casualty; gloves are thick; the mask fogs; smoke can mean zero visibility. **Voice is the only interface that works inside a burning building.** Radio is already how they work.
- **A calm human voice lowers stress.** Under heat and fear, people take in short, calm instructions better than robotic ones. The agent is told to speak like an experienced fire officer: short sentences, one instruction at a time, no more than three sentences unless reading directions.
- **Interruption saves lives.** If a firefighter shouts "mayday" while the agent is talking, the agent must stop and act at once. The call uses ElevenLabs' turn-taking model in eager mode, so the firefighter can cut in at any point and the agent answers the new thing.
- **It never makes things up.** The agent knows nothing about the fire except what its four tools return: `get_situation`, `get_directions`, `report`, `mayday`. It must call `get_situation` before answering, read directions back exactly, and never say a room is empty unless the data says confirmed empty.
- **Command can break in.** When the incident changes during a call (a flashover, a new order to withdraw), the phone sends "URGENT FROM COMMAND" into the call, only while the agent is listening, so the agent is never talked over and passes it on in its own words.

**How the voices were chosen, and the feeling in them** (lead with this; it is what makes the entry stand out):

| Who | Voice | Why | Feeling |
|---|---|---|---|
| **Command** (agent, brief, radio) | Alexis Lancaster: warm, gentle, middle-aged British female | The opposite of the fireground. Stands out from mostly male crew voices, so "this is Command" is clear from the first word. British, like the crews it would serve. | **Calm and steady**: short sentences, one instruction at a time. A steady voice says "someone has this under control", so a frightened person follows the instruction. |
| **Firefighter R1** (video) | Adam: firm, cuts through | Must carry through a mask, a radio and noise. | **Real strain**: `eleven_v4` audio tags `[panting]` and `[urgent, out of breath]`, plus a radio filter. |
| **Narrator** (video) | Daniel: steady broadcaster | Neutral, so the story is easy to follow. | Neutral. |

- **Tuned for feeling:** the brief and the radio use expressive settings (stability 0.3, style 0.6), so urgent news *sounds* urgent and still stays clear. The live agent uses steadier settings (stability 0.5, normal speed) on `eleven_v4_turbo`, so Command answers quickly but never sounds rushed.
- **Say it in one line:** "The firefighter sounds like he's in a fire. Command sounds like the calmest person on the radio. That contrast is the design."
- **In the demo:** play the firefighter's panting question from the video, then let the judge hear Command's calm answer live on the phone.

**Where ElevenLabs is used:**

| Feature | ElevenLabs part |
|---|---|
| **Talk to Command** (phone) | ElevenLabs Agents: live two-way voice over WebRTC, client tools, turn model `turn_v3` (eager), TTS `eleven_v4_turbo` for low delay. Our server holds the API key and gives the phone a short-lived token; the agent only accepts calls with a token. |
| **Radio voice** (phone, Voice on) | Text to speech of every radio message, with a queue that drops old routine messages when it falls behind. |
| **Read the brief** / **Speak the route** (board) | Text to speech for the commander. |
| Demo video | Three voices (narrator, firefighter, Command), plus the music made with ElevenLabs Music. |

**Demo (90 s):** ★ on the phone, press **Talk to Command**. Ask "Command, R1, what's my way out?" While it reads the route, **interrupt it**: "Command, mayday, mayday, I'm trapped!" It stops, raises the mayday (watch the board turn red), and tells you to stay put and keep your alarm sounding. Then ask "who is coming?".

### 3.5 MLH: Best Use of Gemini API

**Gemini project number: 577567729000.** Gemini runs on Vertex AI in our Google Cloud project.

| Feature | What Gemini does | The safety net |
|---|---|---|
| **Photo → building** (editor) | Reads the evacuation plan photo and returns every room and door as boxes on the image. | ARIA repairs the geometry, the editor checks it, and the photo stays underneath for a person to verify. **Use this building** stays disabled until the plan is valid. |
| **Commander's brief** (Read the brief) | Writes a short spoken brief from the command post's live data. | If it calls any room empty that the data does not confirm, the brief is discarded and the rule-based brief is read. |
| **Route wording** (Speak the route) | Smooths turn-by-turn steps into natural radio English. | Discarded unless every turn, compass direction, door and room name is unchanged. |
| **The voice agent's brain** | The ElevenLabs agent's language model is Gemini (`gemini-2.5-flash`), deciding which tool to call and how to say the answer. | It can only answer from tool results. |

**The point to make:** "We use Gemini where it is strong (reading messy images, writing natural language) and never let it decide anything safety-critical. Every Gemini output is checked against the data, and every feature still works without it."

**Demo (60 s):** ★ **Building** → upload the photo → show the plan over the photo and the list of repairs → **Use this building** → **Read the brief** and point at "Written by Gemini from Command post's data".

---

## 4. Why no central server, and what happens to the commander

### 4.1 Why "no central" is the right design for a fire

- **The fire attacks the infrastructure.** A central server (or one radio repeater, or one whiteboard) is one thing to lose. When it goes, *everyone* is blind at once, exactly when things are worst.
- **Contact comes and goes.** Inside a building, radio fades behind concrete, in stairwells and in smoke. A design that needs constant contact fails most of the time. ARIA treats contact as a bonus: share whenever you can, decide always.
- **Speed.** Each firefighter decides from the copy in their own hand, with no round trip to a server. In a fire, a decision that waits for the network is a late decision.
- **No conflicts to resolve.** Every record has exactly one owner, the device that wrote it. Two copies can only differ in *how fresh* they are, never in *what is true*, so merging is instant and always gives the same result.
- **Honest about gaps.** When a copy has not heard from a room for a while, it says "unknown". A central screen that froze would keep showing the last answer as if it were current.

**"But you have a server?"** Our server only **forwards** messages between devices (and holds the API keys for Gemini and ElevenLabs). It keeps no picture of the building. If it dies, every device keeps its copy and keeps deciding. In a real deployment the forwarding would go over whatever radio exists: Wi-Fi, Bluetooth or LoRa between devices. The sharing rules do not care how the messages travel.

### 4.2 The commander is still in charge: ARIA does not replace them

**ARIA cannot replace the incident commander, and should not.** The commander carries legal responsibility and makes judgement calls no software should make: whether to send crews in at all, how much risk to accept to save a life, when to switch to defensive firefighting, when to call more crews.

What ARIA replaces is **the single point of truth**: the one whiteboard, the one radio channel, the one person everyone must reach to know anything.

| Today | With ARIA |
|---|---|
| The commander's picture is built from radio messages and is only as good as the last one heard. | The command post is **one node with its own copy**, kept up to date by every sensor and firefighter it can hear. |
| Crews wait on the radio for room assignments. | Crews compute the same search order themselves. The commander's radio time goes to decisions, not bookkeeping. |
| If the command post loses contact, crews lose their instructions. | Crews keep working from their own copy and fall back on safe rules (leave while the way out is still cool, rescue a downed teammate). |
| The commander asks "is anyone in Lab 2?" and waits. | **Read the brief** gives the whole picture in one spoken paragraph, with what is unknown said out loud. |

The commander still **orders**: they can override, redirect and pull crews out. A firefighter can be steered from their phone, and ARIA refuses an order into a room believed to be burning and says why. ARIA is **decision support**: it makes sure the commander's decisions are based on the best and most honest picture available, even when the radio is failing.

---

## 5. Questions and answers

**Accuracy and safety**

**Q: How often does it get it wrong?**
A: Across 100 simulated fires with more than half the sensors destroyed, an occupied room was shown as confirmed empty in 0.353% of checks. At the end of a run, no room was ever wrongly shown empty on the command post (0 of 100). It errs the safe way: an empty room shown as occupied 5.9% of the time, and an occupied room shown as *unknown* 3.57% of the time. These are simulation figures with assumed sensor error rates, not real-world measurements.

**Q: Where does the remaining 0.35% come from?**
A: Almost all of it is stale information across a cut link: a node on the far side still holds a recent "empty" for a room someone has just walked into. We cap how long "empty" is trusted, so after a few seconds the room turns unknown by itself.

**Q: What if every sensor in a room burns?**
A: The room becomes unknown, and stays unknown until a firefighter searches it. A sensor that goes silent while reading hot is presumed burnt, never "all clear". A sensor blinded by smoke says nothing rather than saying "empty".

**Q: Can the AI tell a firefighter a room is empty when it is not?**
A: No. Gemini's brief is checked against the data, and thrown away if it calls any room empty that the data does not confirm. The voice agent may only say "empty" if its tool says "confirmed empty". Search orders and routes come from rules, not from the AI.

**Q: Is this a certified life-safety system?**
A: No. It is a prototype for decision support. The fire model is a set of simple rules, not a validated fire model.

**How it works**

**Q: How do devices agree without a server?**
A: Each piece of information has one owner, which is the only device that can write it. Devices pass copies on whenever they hear each other (gossip). When two copies meet, for each record you keep the newer version from its owner. Because nobody else can write it, there is never a conflict to resolve.

**Q: What about clocks? Devices in a fire won't have synced clocks.**
A: We do not need them. Each record carries how old it is, not a timestamp, and the age grows as the record is passed on.

**Q: How do firefighters avoid searching the same room?**
A: Each firefighter runs the same rules on its own copy, so they reach the same assignment. Each also publishes a claim ("I'm going to Lab 2"), which the others respect. It is not perfect: while the radio is cut, 29.6% of searches repeat a room someone searched in the last 45 seconds, because two firefighters cannot hear each other's reports. Our measurements found that, and it is on our list.

**Q: How fast do they agree again after a link comes back?**
A: In the fire runs, a mean of 11.1 seconds, worst case 52.7 seconds. In runs without fire, a mean of 5.4 seconds.

**Q: How do you route around the fire?**
A: The building is a graph of rooms joined by doors. We search it for the shortest route that avoids rooms believed to be on fire and doors reported impassable, using each firefighter's own copy. (A breadth-first search over doors, not A*.)

**Q: Where would the sensors come from in a real building?**
A: Door counters and room sensors: existing occupancy sensors, door access systems, or cameras that count on the device. Each joins as a node with the same rules. Cameras are our future extension. We know they are blinded by smoke, which is why the design has to handle sensors going silent.

**Q: How would devices talk in a real fire?**
A: Today the messages go through a relay that only forwards. The design works over any link that sometimes delivers messages: Wi-Fi between phones, Bluetooth, LoRa radios, or firefighters carrying data between areas as they move.

**Q: Does it need the internet?**
A: The core (beliefs, search order, routes, the phone's order and picture) runs in the browser on each device. Gemini and ElevenLabs need the internet; without them you get the rule-based brief and the browser's own voice. The phone currently reaches the board through our relay server.

**Voice**

**Q: Will voice work in a breathing mask with alarms going off?**
A: We tested at a desk, not in a mask. Real use would go through the firefighter's existing radio or a bone-conduction headset. The design point stands: hands and eyes are busy, so voice is the interface, and the firefighter must be able to interrupt.

**Q: Why a human-like voice and not a beep or robotic text-to-speech?**
A: People under stress follow calm, natural speech better, and a familiar radio voice is easier to trust. It also lets us use tone: urgent for a mayday, calm for directions.

**Q: What happens if the agent is talking and something urgent happens?**
A: Urgent orders are queued and spoken into the call as soon as the agent is listening, so it is never talked over. The firefighter can also interrupt the agent at any time.

**Gemini**

**Q: What if Gemini reads the floor plan wrong?**
A: ARIA repairs common mistakes (gaps between walls, missing doors, missing exits, rooms with no way out), lists what it repaired, keeps the photo underneath, and will not let you use the building until it passes the checks. A person confirms it. Gemini's reading also varies from run to run; if one fails the checks, you upload the photo again or fix the plan by hand.

**Q: Why not let Gemini make the decisions?**
A: Because a wrong decision in a fire can kill someone, and a language model cannot promise to be right. Rules make the decisions; Gemini reads images and writes words, and every output is checked.

**The bigger picture**

**Q: Who would buy this?**
A: Fire services, for their crews, and building owners, for the sensors. The software runs in a browser on devices people already have.

**Q: Why not just make the central server redundant?**
A: A redundant server still needs every device to reach it. The weak point in a fire is not the server, it is the radio link to it. Our design keeps working when devices cannot reach anything except each other, or nothing at all.

**Q: Privacy?**
A: Sensors share counts and states ("1 person, not moving"), not identities or images. The future camera nodes count on the device and send only the count.

**Q: What would you build next?**
A: Real sensors and cameras as nodes; device-to-device radio instead of the relay; several floors; and working with a fire service to test the voice in real breathing apparatus.

---

## 6. Things not to say

- **Do not repeat the current `DEVPOST.md` draft's numbers or methods.** These are not supported by the code or the measurements:
  - "duplicate searches 2.1% vs 34%" (measured: 29.6% repeated);
  - "median clearance 4:12 vs 7:48";
  - "zero missed victims with ≥2 door cameras";
  - A* routing (it is breadth-first);
  - Bayesian belief updates (it is rule-based);
  - "empty only after 3 consecutive zero-count reports ≥30 s apart";
  - Gemini 1.5 Flash (we use `gemini-3.5-flash` on Vertex AI, and `gemini-2.5-flash` inside the voice agent);
  - Deepgram;
  - property-based tests.

  Use the figures in this guide and in `docs/evaluation.md`.
- Do not say the camera feature works in smoke.
- Do not say ARIA replaces the incident commander.
- Do not call "Actually inside" a real-world number. It exists only because this is a simulation.
