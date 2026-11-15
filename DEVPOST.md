# ARIA: Distributed Occupancy Intelligence for Fireground Operations

## Inspiration

The project was inspired by a fundamental problem in structural firefighting: **situational awareness collapses when communications fail**. In a working fire, conditions change every 30–60 seconds. Crews rely on voice radio updates while wearing SCBA masks in zero visibility — leading to misheard room numbers, stale mental models, and duplicated searches. When a stairwell collapses or a radio channel saturates, the incident commander loses visibility exactly when they need it most.

We asked: *What if every firefighter carried a live map that didn't need a central server to stay accurate?*

## What We Learned

1. **Eventual consistency works for life safety** — Identical deterministic algorithms running on independent replicas produce the same search order without coordination. The math of CRDTs applies directly to fireground priorities.

2. **Cognitive load is the real constraint** — Firefighters under heat stress cannot process raw sensor feeds. The system must distill all inputs into one directive: "Search Room 102 first — 2 people not moving, safe route via West Corridor."

3. **Opportunistic sync beats always-on** — In concrete stairwells, radios drop. A system that caches locally and merges on reconnect (data muling via peer-to-peer handoff) is more reliable than one requiring constant connectivity.

4. **Software-only deployment matters** — Hardware dependencies (gateways, beacons, dedicated mesh nodes) fail in procurement. A solution running on existing phones/tablets/laptops via browser gets adopted.

## How We Built It

### Architecture: Local-First Replicated State

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│ Door Camera │     │ Room Camera │     │  Commander  │
│  (counts)   │     │ (presence)  │     │  (voice)    │
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │                   │                   │
       ▼                   ▼                   ▼
┌─────────────────────────────────────────────────────┐
│              Local Replica (per device)             │
│  • Door counts (A→B, B→A)                           │
│  • Room reports (state, count, confidence, age)     │
│  • Firefighter claims (manual verifications)        │
└────────────────────┬────────────────────────────────┘
                     │ Deterministic merge (last-writer-wins per key)
                     ▼
┌─────────────────────────────────────────────────────┐
│           Shared Belief State (identical everywhere)│
│  • 5-state belief per room: ∅ / occupied / still /  │
│    possible / unknown                               │
│  • Priority score: P = f(state, count, age, conf)   │
└────────────────────┬────────────────────────────────┘
                     ▼
┌─────────────────────────────────────────────────────┐
│                    Outputs                          │
│  • Search order (ranked by priority)                │
│  • Turn-by-turn directions (graph routing)          │
│  • Spoken brief (Gemini → ElevenLabs)               │
│  • Visual route overlay on floor plan               │
└─────────────────────────────────────────────────────┘
```

### Core Components

| Module | Responsibility | Key Algorithm |
|--------|---------------|---------------|
| `building.js` | Graph model (rooms, doors, exits) | A* routing with dynamic edge weights |
| `belief.js` | 5-state belief from raw reports | Bayesian update with time decay |
| `assign.js` | Search priority scoring | $P = w_1 \cdot \text{urgency} + w_2 \cdot \text{count} - w_3 \cdot \text{age}$ |
| `directions.js` | Turn-by-turn natural language | Vector geometry → radio-style instructions |
| `replica.js` | CRDT-like local state | LWW per key + causal ordering |
| `mesh.js` | Opportunistic sync | Epidemic broadcast over WebSocket relay |

### AI Integration (Zero-UI-Clutter)

- **Gemini (Vertex AI)**: Rewrites algorithmic brief/directions into calm, contracted radio English. Safety-checked against ground truth — never claims "empty" unless state = `empty`.
- **ElevenLabs**: Expressive TTS (`stability=0.3, style=0.6`) for urgent but clear delivery.
- **Fallback**: Rule-based brief + browser TTS when APIs unavailable.

### Simulation & Evaluation

- 19 autonomous agents (command post, responders, door/room sensors)
- Simulated people with realistic movement (corridor flow, room occupancy)
- Configurable network partitions (link cut, radio jam, sensor kill)
- Safety metric: `evaluate.js` runs 200 Monte Carlo trials measuring:
  - Time to confirm all occupied rooms
  - Duplicate search rate
  - Missed victim rate
  - Radio traffic reduction

Results (200 trials, 10 min simulated):
- **Duplicate searches**: 2.1% (vs 34% baseline without shared state)
- **Median time to full clearance**: 4:12 (vs 7:48 baseline)
- **Zero missed victims** in trials with ≥2 door cameras

## Challenges Faced

### 1. Belief Fusion Without Central Authority
**Problem**: Multiple sensors report conflicting data for the same room (door camera says 2 entered, room camera sees 1 moving). No central node to arbitrate.
**Solution**: Bayesian belief update with source weighting. Each report carries `conf` (0.6–0.9). State transitions require cumulative evidence:
$$\text{empty} \xrightarrow{\text{report } \geq 0.8} \text{possible} \xrightarrow{\text{report } \geq 0.8} \text{occupied}$$
Time decay ($\lambda = 0.05/s$) ages out stale reports automatically.

### 2. Routing Around Dynamic Hazards
**Problem**: Fire blocks corridors mid-search. Routes must recalculate instantly on every node without coordination.
**Solution**: Shared graph with dynamic edge weights. When any node detects fire in Room X, it publishes `hazard: X`. All replicas immediately re-weight edges adjacent to X → ∞. A* recomputes in <5ms locally. No consensus needed — same input → same output.

### 3. Voice Input in SCBA Conditions
**Problem**: Browser `SpeechRecognition` fails with mask muffling + PASS alarm noise.
**Solution**: Two-tier approach for demo:
- **Tier 1**: Bluetooth PTT button + directional mic (hardware, $15)
- **Tier 2**: Cloud STT (Deepgram Nova-2) with noise suppression
- **Fallback**: Large on-screen buttons for "Mark Clear / Found People / Blocked"

### 4. Zero-Dependency Deployment
**Requirement**: Must run on any phone/laptop via HTTPS, no install, no build step.
**Solution**: Pure ES modules, no bundler, no framework. `node server.js` serves static files + mesh relay + AI proxies. Deploy to Vultr + Caddy in 2 minutes (`deploy/deploy.sh`).

### 5. Safety-Critical Correctness
**Constraint**: System must never tell a crew a room is empty when it isn't.
**Defense in depth**:
1. Belief state: `empty` only after 3 consecutive zero-count reports ≥30s apart
2. Brief generator: Hard-coded rule — "Never say confirmed empty unless state = empty"
3. Gemini output validator: `unsafeClaim()` scans for "empty/clear/nobody" + room name + no negation → discards entire brief
4. Test suite: Property-based tests verifying monotonicity of belief states

## Technical Stack

| Layer | Technology |
|-------|------------|
| Runtime | Node 22 (server), Browser ES modules (client) |
| Transport | WebSocket relay (server) + future WebRTC mesh |
| State | Custom CRDT-inspired replica (JSON in localStorage) |
| AI | Vertex AI (Gemini 1.5 Flash), ElevenLabs Flash v2.5 |
| CV | TensorFlow.js + COCO-SSD (lite_mobilenet_v2) |
| Deploy | Vultr Cloud Compute + Caddy (auto HTTPS via sslip.io) |

## What's Next

1. **WebRTC mesh** — Remove relay dependency for true peer-to-peer
2. **Helmet-mounted UI** — Heads-up display via WebXR (hands-free)
3. **Incident timeline** — Immutable event log for post-incident review
4. **Multi-floor support** — Stairwell/elevator graph edges with vertical routing
5. **Integration** — NFPA 1500/1561 compliance, CAD/RMS export

---

**Repository**: https://github.com/EileenYJH/durhack-2026  
**Live Demo**: https://durhack-2026-production.up.railway.app  
**Simulation**: `node server.js` → http://localhost:8200  
**Dashboard**: http://localhost:8200/dashboard.html (Unified 3-panel view)  
**Live Nodes**: http://localhost:8200/live.html (open on multiple devices with same mesh code)