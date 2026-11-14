# Roll Call: design spec

Date: 2026-11-14. Event: DurHack 2026 (14-15 November, 24 hours). Team: solo.
Primary target: RS challenge (sense, analyse, decide, trigger an action). Secondary: Neptune North (resilience when comms fail).

## 1. Problem

In a building fire, responders do not know who is still inside. Door counters (laser beams) miscount when people pass together, cameras go blind in smoke, and motion sensors miss people who are lying still. Today's practice is a warden roll call against a register, which misses visitors and gives no location. The decision to risk a search depends on this information.

## 2. Goal

A prototype that gives an incident commander a per-room status board:

- **Confirmed empty**: door counts and room sensors agree, readings are recent.
- **Possibly occupied**: sensors disagree, or the count is above zero.
- **Occupied, still**: a person is detected by breathing, with no movement.
- **Unknown**: sensor is silent, stale or blind. Never shown as empty.

Each room shows a confidence value and the age of its last reading.

Stretch goal: a suggested route and rescue priority (section 7).

## 3. Scope

Minimum version (build first):

- One door and one room, then a second room if time allows.
- Radar for presence and door tracking, camera for counting in clear air.
- Fusion, room status logic, dashboard, buzzer and status light.

Out of scope: certified life-safety behaviour, identification of individuals, real smoke or fire, real building networks.

## 4. Architecture

Components, each with one job:

1. **Door node**: camera plus radar facing a doorway. Outputs crossing events (direction, count, per-sensor confidence). Flags disagreement between sensors.
2. **Room node**: radar (optional thermal) inside the room. Outputs a presence state (empty, moving, still) and a confidence.
3. **Fusion engine**: keeps a running headcount per room. Door events update it, room presence corrects it. If a room sensor sees someone while the count says zero, presence wins and the room is "possibly occupied".
4. **Visibility estimator**: scores camera visibility from 0 to 100 using contrast, edge sharpness and brightness. Lowers the camera's weight as visibility falls, so radar takes over.
5. **Safety layer** (microcontroller): reads sensors, drives buzzer, lights and relay. Works if the laptop or camera software crashes.
6. **Dashboard**: floor plan with room states, confidence, reading age and an event log.

Data flow: sensors, then fusion, then room state, then dashboard and alarms. Every event carries a timestamp and a confidence, so staleness is automatic.

### Camera pipeline

- Person detection: a small pre-trained detector (YOLO nano or MobileNet-SSD, or the UNO Q App Lab object-detection example filtered to "person"). Low resolution, a few frames per second.
- Counting: centroid or ByteTrack-style tracker plus a virtual line across the doorway, +1 or -1 by direction.
- Mount high or overhead so people walking together do not hide each other.

### Wireless link and failure behaviour (Neptune North angle)

- Nodes send small messages (room, count, confidence, timestamp) over ESP-NOW or Wi-Fi in the demo. A real building would use a mesh or LoRa with batteries.
- Each node keeps its own last state and sounds its own alarm without the laptop.
- On reconnect, nodes resend buffered readings and the board catches up.
- A node that goes silent turns to Unknown.
- Demo: cut the link, show a node still working, reconnect, show the board recover.

## 5. Demo plan

Judges are the actors. Sensors on a tripod at a doorway, a taped "room" zone behind it.

1. Problem statement (20 s).
2. Two judges walk through together: count shows +2, sensors agree.
3. Drift correction: force the count to 0 while someone stands in the zone, room flips to possibly occupied with the reason shown.
4. Smoke: cover the camera lens, visibility score falls, radar holds the person, a person standing still shows as occupied, still.
5. Alarm and cut-off: buzzer, red light, relay switches a lamp or small fan.
6. Commander view: ranked rooms with confidence and reading age.
7. Limits stated honestly (20 s).

Fallbacks: recorded backup video of the full run, and a simulated-data mode on the laptop. Simulated parts must be labelled "SIMULATED" on screen and live parts "LIVE". A screen showing smoke footage cannot test the radar, so the still-person beat must use a real person.

## 6. Risks and mitigations

| Risk | Mitigation |
|---|---|
| No UNO Q available | Ask RS team for a written substitute (section 8) or move the idea to Marshall Wace or Accenture |
| No radar module in the loan library | Thermal array, then camera only with "unknown when blind" behaviour |
| Radar counting is noisy | Room-presence correction, wording of "possibly occupied", no precision claims |
| Radar module cannot see still people | Test with a seated person first, prefer a module that reports breathing |
| Solo integration time | Minimum version first, one door and one room |
| Over-claiming | Prototype for decision support, limits stated, no survival percentages |
| Sprinklers, hot air and heat affect radar and nodes | State as untested open problems, add a sensor-health input so a failing node reports Unknown |

## 7. Stretch: route and rescue priority

- Model the building as a small graph (rooms, corridors, exits). Link cost comes from temperature, smoke or VOC level and flame seen by the camera. A link with flames is blocked.
- Shortest-path search gives the lowest-risk route to a room with a person. Raising a hazard slider reroutes it.
- Output is a **rescue priority score**, not a survival probability. Inputs: breathing detected, time since movement, local temperature and smoke, route hazard and distance. It is an unvalidated heuristic, always shown with its reasons and the label "suggested, based on sensor data only". The commander decides.
- Demo with simulated hazard sliders on the laptop.

## 8. Hardware list and substitutes

Stock in the RS loan library is unknown. Ask RS in writing whether a substitute is allowed before building around one. Use low-voltage loads only (no mains) and tell an organiser before using a loud buzzer.

| Role | Preferred | Substitute 1 | Substitute 2 | Last resort |
|---|---|---|---|---|
| Main board | Arduino UNO Q (4 GB) | Raspberry Pi 4 or 5 plus an ESP32 or Arduino | Laptop plus ESP32 | Laptop only (loses the independent safety layer) |
| Sensor and alarm microcontroller | UNO Q microcontroller side | ESP32 DevKit (WROOM) | ESP32-S3, Arduino Nano ESP32, Raspberry Pi Pico W | Arduino Uno or Nano (no Wi-Fi) |
| Camera | Supplied USB camera | Any UVC USB webcam | Nicla Vision, Raspberry Pi camera | Phone camera streamed over Wi-Fi |
| Radar, door and presence | HLK-LD2450 (24 GHz, tracks up to 3 targets) | RD-03D (24 GHz, multi-target) | Seeed 60 GHz breathing module (MR60BHA2) for still people | HLK-LD2410 (one target, good at still presence) |
| Smoke-proof backup sensor | Thermal array, MLX90640 | AMG8833 (8x8 thermal) | PIR plus ultrasonic (HC-SR04) | None |
| Temperature and hazard sensing (stretch) | BME680 (temperature, humidity, gas) | SGP30 (VOC) plus DS18B20 (temperature) | MQ-2 or MQ-135 gas sensor, DHT22 | Simulated values on the laptop |
| Alarm | Active piezo buzzer | Passive buzzer | Speaker on laptop | None |
| Status lights | Red and green LEDs with 220 ohm resistors | WS2812 LED strip | Onboard board LEDs | None |
| Cut-off | 1-channel 5 V opto-isolated relay module | Solid-state relay module | Transistor driving a 5 V fan or lamp | Show the relay click only |
| Load to switch | Small 5 V fan or low-voltage lamp | LED lamp on a USB port | A motor (loan library) | Indicator LED |
| Manual control (optional) | Modulino Knob | Push button | Laptop keyboard | None |
| USB and power | Powered USB hub (supplied), USB-C power bank | Laptop USB ports | Any 5 V USB charger | None |
| Wiring and mounting | Breadboard, jumper wires, tripod or clamp | Cardboard stand, tape, cable ties | Mini tripod for a phone | None |

Radar modules are mostly 3.3 V or 5 V UART devices, so check voltage and TX/RX crossing when wiring.

## 9. Open questions (resolve in the first hour)

1. Does the library stock any radar or presence sensor, and which?
2. Will RS accept a substitute for the UNO Q? Get it in writing.
3. Does the supplied camera work with the chosen board?
4. Which radar can detect a seated, still person in a quick test?

## 10. Prior work (to cite)

- FireGuard (VTHacks, radar firefighter helmet, devpost.com/software/fire-guard).
- PULSE, a low-cost 24 GHz radar search-and-rescue node (IIT, EIT 2026).
- EWSN 2023, thermal plus mmWave radar fusion for people detection when vision degrades.
- mmCounter (arXiv 2512.10357), static people counting with radar.
- 8x8 thermopile doorway counter (PMC8231657) and the Milesight VS351 commercial counter.
- Infineon radar entrance counter example, TI people-tracking reference designs, ESPHome LD2450 and RD-03D components.

These came from search summaries and have not been read in full. Check them before quoting figures.

## 11. Success criteria

- Two people crossing together are counted correctly in a live run.
- A forced miscount is corrected by room presence and the dashboard shows why.
- Covering the camera shifts trust to radar and the room stays occupied.
- A silent node shows Unknown, never empty.
- A physical action (buzzer, light, relay) is visible.
- A recorded backup demo exists.
