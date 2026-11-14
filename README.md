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

No build step and no dependencies (Node 22 or newer):

```bash
node server.js
```

- http://localhost:8200 is the simulation: 19 nodes, each with its own copy of the state, on a network you can cut.
- http://localhost:8200/live.html turns the device into a real node. Open it on several devices or windows with the same mesh code. Roles: command board, door camera (counts people crossing a doorway), room camera (reports presence and whether people are moving).
- Tests: `node --test`. Safety measurement: `node scripts/evaluate.js 200`. Results are in [docs/evaluation.md](docs/evaluation.md).

Optional keys go in `.env` (copy `.env.example`): `GEMINI_API_KEY` for the written brief, `ELEVENLABS_API_KEY` for the voice. Without them the brief is rule-based and the browser's own voice reads it.

Phones need HTTPS to use their camera, so a phone camera node needs the server behind an HTTPS address (a tunnel or a hosted copy). A laptop on localhost works as it is.

## Layout

- `docs/` notes, brief, pitch
- `src/core/` replicated state, belief rules, responder assignment (tested)
- `src/sim/` simulated people, sensors and network
- `src/live/` real device nodes: mesh transport, camera tracker
- `src/ui/` the command board and the brief
- `server.js` static files, mesh relay, Gemini and ElevenLabs proxies
- `scripts/evaluate.js` randomised safety measurement

## Links

- Slides: https://docs.google.com/presentation/d/1q3omTEBLCsSmGaBdDifoDqNkFxeMxge6hBS9LN3U38o
- Devpost: https://durhack-26.devpost.com/
