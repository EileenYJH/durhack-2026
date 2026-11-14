# Evaluation

Measured with `node scripts/evaluate.js 200` on 14 November 2026. Everything here is from the simulation, not from a real building.

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
