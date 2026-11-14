# DurHack 2026

Our entry for [DurHack 2026](https://durhack-26.devpost.com/), Durham, 14-15 November 2026 (24 hours).

> **Roll Call**: a fire-incident occupancy board that tells responders which rooms are confirmed empty, possibly occupied, occupied (still) or unknown, kept by independent nodes that each decide alone and merge when they can reach each other. Software only. Solo entry. Design: [docs/superpowers/specs/2026-11-14-roll-call-design.md](docs/superpowers/specs/2026-11-14-roll-call-design.md)

Targets: Neptune North (primary), Accenture, the overall prizes, MLH ElevenLabs and Gemini.

## Sponsor challenges (from the opening ceremony slides)

Full notes in [docs/challenges.md](docs/challenges.md). One-line summary:

| Sponsor | Challenge | Prize |
|---|---|---|
| Neptune North | Actors work better together: distributed systems that keep working when comms fail | £1,000 voucher / mechanical keyboards |
| Accenture | Redesign a frustrating "that's just how it works" process with AI / LLMs | see slides |
| RS | Intelligent system that senses, analyses, decides, acts (Arduino UNO Q + camera) | 1st-3rd |
| SGX FX | Protect assets in a trading market storm (risk, early warning, prediction) | see slides |
| Marshall Wace | "New Worlds": open the door to something unexplored | see slides |
| P&G | Receipt-data insights, or sensor approaches for baby/fem care | see slides |
| Raspberry Pi | Improve the world by connecting things that usually aren't | Pico Inventors Kit |
| QRT | Tagged (physical language that encodes digital information) and Spray n' Tag CTF | AirPods Pro / poker sets / £100 keyboard voucher |

## Run it

No build step. Serve the folder and open it:

```bash
python -m http.server 8200
```

Then open http://localhost:8200. Tests: `node --test`.

What you see is a simulation: people, sensors and the radio network are simulated, and every node keeps its own separate copy of the state. Select any node on the plan to see the building as that node believes it.

## Layout

- `docs/` notes, brief, pitch
- `src/core/` replicated state, belief rules, responder assignment (tested)
- `src/sim/` simulated people, sensors and network
- `src/ui/` the command board

## Links

- Slides: https://docs.google.com/presentation/d/1q3omTEBLCsSmGaBdDifoDqNkFxeMxge6hBS9LN3U38o
- Devpost: https://durhack-26.devpost.com/
