# Evaluation

Measured with `node scripts/evaluate.js 200` on 14 November 2026, and measured again after the building was made data-driven (unsafe empty 0.276%, unknown 2.93%, wrong-empty at the end 0 of 200). Everything here is from the simulation, not from a real building.

## Method

200 runs of 110 simulated seconds. Each run has 13 people, a random alarm time, a link cut that severs the east wing for a random period, and up to two random sensor failures. Door sensors miss 3% of crossings. Room sensors miss a motionless person 15% of the time on each reading. Every half second, every live node's belief about every room is compared with the truth (about 830,000 checks of an occupied room).

"Unsafe empty" means a node shows a room as confirmed empty when someone has been in it for more than 2.5 seconds.

## Results

| Version of the rules | Unsafe empty | Shown as unknown while occupied |
|---|---|---|
| First version | 1.008% | 2.27% |
| + an "empty" reading must outlast the last sighting by 8 s | 0.758% | 2.52% |
| + "empty" is trusted for 6 s instead of 22 s | 0.284% | 2.99% |

Current version, other figures:

- An empty room shown as occupied: 5.06% of checks. This is the safe direction and is mostly the few seconds after people leave.
- Agreement after the link returns: mean 5.4 s, worst 25.6 s.
- Rooms wrongly shown empty on the command post at the end of a run: 0 in 200 runs.

## What causes the remaining 0.28%

A breakdown of the unsafe cases showed almost all of them come from stale data across a cut link: a node on the far side still holds a recent "empty" for a room that someone has just walked into. Shortening how long "empty" is trusted bounds that window to 6 seconds, after which the room turns unknown by itself. Cases where the data was fresh were about 1% of the unsafe cases.

The cost is visible in the last column: tightening the rules makes more rooms show as unknown. That is the trade this design makes on purpose.

## Limits

- The sensor error rates are assumptions, not measurements of real sensors.
- 0.28% is not zero. This is a prototype for decision support, not a life-safety system.
- A door counter that has drifted stays wrong until a responder searches the room; the search result expires after 18 seconds and the room is then flagged again.

## With a spreading fire (added 15 November 2026)

The simulation now has heat and smoke that spread through doorways, sensors that fail in the heat, flashover, smoke that blinds cameras and weakens radio, people who collapse from smoke, and firefighters with limited air. Measured with `node scripts/evaluate.js 100`: 100 runs of 110 s, fire spreading at 1x to 3x, a link cut, an 8 s radio jam and up to two extra sensor failures.

| Measure | Result |
|---|---|
| Occupied room shown as confirmed empty (unsafe) | 0.353% of 469,196 checks |
| Occupied room shown as unknown | 3.57% |
| Empty room shown as occupied | 5.9% |
| Rooms wrongly empty on the command post at the end | 0 in 100 runs |
| Sensors destroyed by the end of a run | 56.8% |
| Agreement after the link returns | mean 11.1 s, worst 52.7 s |
| People out | 1,181 of 1,300 (90.8%); 119 lost to the fire |

So with more than half the sensors burnt out, the unsafe rate stayed close to the 0.28% measured without fire. Two rules do that work: a sensor blinded by smoke says nothing instead of saying "empty", and a sensor that goes silent while reading hot is presumed burnt.

### What the measurement made us fix

| Problem found | Before | After |
|---|---|---|
| Firefighters caught in a flashover | 57 in 100 runs | 0, after adding "leave while the way out is still below 240°C" |
| Searches in total | 1,082 | 571, after a cleared room stays cleared while its door counters show nobody has entered, and a room a teammate has just attended is left alone |

### Still weak

- 29.6% of searches repeat a room another firefighter searched in the last 45 s. Most happen while radio is cut or jammed, when two firefighters cannot hear each other's reports.
- With no flashover deaths there were no maydays in these runs, so the mayday response is covered only by a test and by hand, not by this measurement.
- Fire, smoke and survival figures are simple rules chosen to look plausible. They are not a validated fire model, and the 90.8% is a property of this simulation, not a prediction.
