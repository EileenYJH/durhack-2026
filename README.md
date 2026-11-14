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

- http://localhost:8200/editor.html is the building editor: draw rooms, add doors and exits, or import a photo of a floor plan (needs `GEMINI_API_KEY`). "Use this building" makes every page work on your layout.
- http://localhost:8200 is the simulation: 19 nodes, each with its own copy of the state, on a network you can cut.
- http://localhost:8200/live.html turns the device into a real node. Open it on several devices or windows with the same mesh code. Roles: command board, door camera (counts people crossing a doorway), room camera (reports presence and whether people are moving).
- Tests: `node --test`. Safety measurement: `node scripts/evaluate.js 200`. Results are in [docs/evaluation.md](docs/evaluation.md).

Optional keys go in `.env` (copy `.env.example`): `GEMINI_API_KEY` (or the Vertex AI settings below) for the written brief, and `ELEVENLABS_API_KEY` for the voice. Without them the brief is rule-based and the browser's own voice reads it.

Phones need HTTPS to use their camera, so a phone camera node needs the server behind an HTTPS address (a tunnel or a hosted copy). A laptop on localhost works as it is.

## Gemini through Vertex AI

Roll Call can call Gemini three ways, set with `GEMINI_PROVIDER`. All give the same brief, floor plan import and rewritten directions.

| `GEMINI_PROVIDER` | What you need | Billed to |
|---|---|---|
| `aistudio` (default) | An AI Studio API key in `GEMINI_API_KEY` | Your AI Studio project |
| `vertex-express` | A Vertex AI API key in `VERTEX_API_KEY` (or `GEMINI_API_KEY`) | Your Google Cloud project |
| `vertex` | `GCP_PROJECT` plus a service account or `gcloud` sign-in | Your Google Cloud project |

**Quickest route, `vertex-express`:** put the key in `.env`, set `GEMINI_PROVIDER=vertex-express`, then enable the Vertex AI API once for the key's project at `https://console.cloud.google.com/apis/library/aiplatform.googleapis.com` (the project needs billing or credits). If it is not enabled, `node scripts/check-gemini.js` says so and links to the right page.

**Full route, `vertex`:**

1. In Google Cloud, create or pick a project with billing or credits, and enable the API:

```bash
gcloud config set project YOUR_PROJECT_ID
gcloud services enable aiplatform.googleapis.com
```

2. Sign in. On your own machine:

```bash
gcloud auth application-default login
```

   On a server, create a service account instead and keep its key file private:

```bash
gcloud iam service-accounts create rollcall
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID --member="serviceAccount:rollcall@YOUR_PROJECT_ID.iam.gserviceaccount.com" --role="roles/aiplatform.user"
gcloud iam service-accounts keys create service-account-key.json --iam-account=rollcall@YOUR_PROJECT_ID.iam.gserviceaccount.com
```

3. In `.env` set `GEMINI_PROVIDER=vertex`, `GEMINI_MODEL=gemini-3.5-flash`, `GCP_PROJECT=YOUR_PROJECT_ID`, `GCP_LOCATION=global`, and for a server `GOOGLE_APPLICATION_CREDENTIALS=/opt/rollcall/service-account-key.json`.
4. Check it: `node scripts/check-gemini.js`.

Key files are git-ignored. Copy one to a server by itself with `scp`, never inside the project folder you deploy.

## Host it on Vultr

A hosted copy gives phones the HTTPS address they need for their cameras, and lets devices on different networks join one mesh.

1. In the Vultr dashboard, deploy a Cloud Compute server: Ubuntu 24.04, the smallest plan, and add your SSH key.
2. Copy `.env.example` to `.env` and add your keys (optional).
3. From this folder:

```bash
bash deploy/deploy.sh <server-ip> .env
```

It installs Node 22 and Caddy, runs Roll Call as a service on localhost, and puts Caddy in front with an automatic HTTPS certificate at `https://<ip-with-dashes>.sslip.io`. No domain is needed. Re-run the same command to update.

The server keeps no data: the mesh relay only forwards messages. The Gemini and ElevenLabs proxies are limited to 30 requests a minute per address so a public copy cannot drain the keys.

## Layout

- `docs/` notes, brief, pitch
- `src/core/` replicated state, belief rules, responder assignment, building layout, directions (tested)
- `src/editor/` the layout editor
- `src/sim/` simulated people, sensors and network
- `src/live/` real device nodes: mesh transport, camera tracker
- `src/ui/` the command board and the brief
- `server.js` static files, mesh relay, Gemini and ElevenLabs proxies
- `scripts/evaluate.js` randomised safety measurement

## Links

- Slides: https://docs.google.com/presentation/d/1q3omTEBLCsSmGaBdDifoDqNkFxeMxge6hBS9LN3U38o
- Devpost: https://durhack-26.devpost.com/
