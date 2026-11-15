// The demo guide: walks the presenter through every case, one scene at a time.
//
// The incident is paused while the guide is open, so the fire never outruns
// the person talking. "Do it" does the step's action (exactly what a click on
// the board would do), plays the incident just long enough to show the
// effect, then holds again so it can be explained. Arrow keys move between
// steps; Enter does the step.

import { ROOMS, ROOM_IDS, DOORS, doorsOf, isHall, exitDoors, route } from '../core/building.js';

export function createGuide(api) {
  const { sim, act, press, setViewer, setPaused, $ } = api;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let cancelled = 0; // bumped when the presenter moves on, to stop a scene that is playing

  // ---- choosing good targets at the moment of the click ----------------------------
  const firefighters = () => sim().nodes.filter((n) => n.kind === 'responder');
  const busy = (n) => n.mission || n.forcing || n.escort || firefighters().some((m) => m.escort === n.id);
  const free = () => firefighters().filter((n) => n.alive && n.status === 'ok' && !busy(n));
  const insideFree = () => free().filter((n) => n.room !== 'OUT' && !sim().rooms[n.room].burning);
  const goodLink = () =>
    sim()
      .links()
      .filter((l) => !l.severed && l.q > 0 && l.a.kind !== 'responder' && l.b.kind !== 'responder' && l.a.alive && l.b.alive)
      .sort((x, y) => Math.hypot(y.a.x - y.b.x, y.a.y - y.b.y) - Math.hypot(x.a.x - x.b.x, x.a.y - x.b.y))
      .find((l) => api.detourPath(l.a.id, l.b.id, l.key));
  // The sensor of a room the command post believes someone is in: the case that
  // shows the point (it never turns empty). Failing that, any working sensor.
  const occupiedSensor = () => {
    const s = sim();
    const post = api.beliefOf('POST');
    const working = s.nodes.filter((n) => n.kind === 'room' && n.alive && !isHall(n.room) && !s.rooms[n.room].burning);
    const rank = (n) => ({ still: 0, occupied: 1, possible: 2 })[post[n.room]?.state] ?? (s.people.some((p) => p.room === n.room && p.mode !== 'lost') ? 3 : 9);
    return working.sort((a, b) => rank(a) - rank(b))[0] ?? s.nodes.find((n) => n.kind === 'room' && n.alive);
  };
  const doorOnARoute = () => {
    const s = sim();
    for (const f of firefighters()) for (const w of f.path ?? []) if (w.door && !s.blocked.has(w.door) && !exitDoors().includes(w.door)) return w.door;
    return Object.keys(DOORS).find((d) => !s.blocked.has(d) && !exitDoors().includes(d));
  };
  // A room with a single doorway that is not an exit: if it collapses, whoever is inside is trapped.
  const oneDoorRooms = () => {
    const s = sim();
    return ROOM_IDS.filter((r) => !isHall(r) && !s.rooms[r].burning && s.rooms[r].heat < 80 && doorsOf(r).length === 1 && !exitDoors().includes(doorsOf(r)[0]) && !s.blocked.has(doorsOf(r)[0]));
  };
  const farRoom = () => {
    const s = sim();
    const burning = ROOM_IDS.filter((r) => s.rooms[r].burning);
    const centre = (r) => ({ x: ROOMS[r].x + ROOMS[r].w / 2, y: ROOMS[r].y + ROOMS[r].h / 2 });
    const distFromFire = (r) => Math.min(...burning.map((b) => Math.hypot(centre(r).x - centre(b).x, centre(r).y - centre(b).y)), 1e9);
    return ROOM_IDS.filter((r) => !isHall(r) && !s.rooms[r].burning).sort((a, b) => distFromFire(b) - distFromFire(a))[0];
  };
  const said = (re, since) => sim().log.some((e) => e.n > since && re.test(e.text));
  const bannerSays = (re) => !$('event').hidden && re.test($('event-title').textContent);
  const logMark = () => sim().log[0]?.n ?? 0;

  // ---- scrolling: keep the top of the page (clock, counts, buttons) in view ------------
  const top = () => window.scrollTo({ top: 0, behavior: 'smooth' });
  const show = (sel, block = 'center') => document.querySelector(sel)?.scrollIntoView({ behavior: 'smooth', block });

  // ---- playing a scene ------------------------------------------------------------------
  // Runs the incident until `until()` is true or `max` seconds of it have passed, then holds.
  async function play(status, { seconds = 8, until = null, max = seconds, label = 'Playing' } = {}) {
    const ticket = cancelled;
    setPaused(false);
    const start = sim().t;
    while (sim().t - start < max) {
      if (ticket !== cancelled) return false;
      if (until && until()) break;
      if (!until && sim().t - start >= seconds) break;
      status(`${label}… ${Math.max(0, Math.ceil(max - (sim().t - start)))} s`);
      await sleep(200);
    }
    if (until) await sleep(1500); // a moment to see it happen
    if (ticket !== cancelled) return false;
    setPaused(true);
    return true;
  }
  const held = 'Paused. Explain it, then press Next.';

  // ---- the steps ------------------------------------------------------------------------
  const STEPS = [
    {
      title: 'The board',
      say: 'ARIA is an orchestra with no one beating time. Every sensor, door counter and firefighter is a player with its own copy of the building. There is no central server holding the truth.',
      watch: 'The plan: coloured rooms are what the command post believes. White dots are where people really are (simulation only). The firefighters R1 to R3 arrive at the entrance.',
      doLabel: 'Start the incident',
      async do(status) {
        top();
        setPaused(true);
        press('reset');
        await sleep(200);
        press('alarm');
        await play(status, { seconds: 8 });
      },
    },
    {
      title: 'Search order',
      say: 'The common goal is to find everyone. Nobody hands out rooms: each firefighter works out the whole team\'s plan from its own copy, with the same rules, and follows its own part. No radio call needed.',
      watch: 'The three triangles heading for different rooms. Then the search order, just below the plan: the room to search first, and why.',
      doLabel: 'Play, then show the search order',
      async do(status) {
        top();
        press('speak');
        if (await play(status, { seconds: 8 })) show('.board', 'start');
      },
    },
    {
      title: 'Kill a sensor',
      say: 'A sensor burns out in a room we believe someone is in. The easy mistake is to read silence as "empty". ARIA never does: the room becomes "possibly occupied", then unknown, and only a search by a firefighter can make it empty.',
      watch: 'The crossed-out sensor. Its room goes to striped "Possibly occupied", not green "Confirmed empty". The banner says what to expect for that room.',
      doLabel: 'Kill a sensor',
      async do(status) {
        top();
        const n = occupiedSensor();
        if (!n) return 'No working sensor left to kill.';
        act('kill', n.id);
        await play(status, { seconds: 10 });
      },
    },
    {
      title: 'Inspect: each node has its own picture',
      say: 'Every node keeps its own picture. Here is the building as firefighter R2 believes it, from R2\'s own copy.',
      watch: 'The heading changes to "as believed by Responder 2".',
      doLabel: "Show R2's picture",
      async do() {
        top();
        act('inspect', 'R2');
      },
    },
    {
      title: 'Cut the link',
      say: 'The fire takes out the radio between the two wings. Parts drop out, but the piece goes on: each side keeps working from what it last heard, and rooms nobody can hear from turn unknown, never empty.',
      watch: 'The red line down the middle. Then, below the plan, "What each node believes": the columns now disagree.',
      doLabel: 'Cut the link',
      enter: () => setViewer('POST'),
      async do(status) {
        top();
        if (!sim().cut) press('cut');
        if (await play(status, { seconds: 10 })) show('.matrix');
      },
    },
    {
      title: 'Back in time',
      say: 'When the players can hear each other again, they are back in time within seconds. No referee and no shared clock: every record carries its age.',
      watch: 'The green banner "All nodes agree again after … s".',
      doLabel: 'Restore the link',
      async do(status) {
        top();
        if (sim().cut) press('cut');
        await play(status, { until: () => bannerSays(/agree again/i), max: 30 });
      },
    },
    {
      title: 'Sever a link',
      say: 'Now just one radio link fails. The news does not need that link: it goes around it, passed on by the other players.',
      watch: 'The red dashed line is the lost link; the moving blue route is the way the news goes around it.',
      doLabel: 'Sever a link',
      async do(status) {
        top();
        const l = goodLink();
        if (!l) return 'No link with a way around it right now. Press Do it again in a moment.';
        act('sever', l.key);
        await play(status, { seconds: 6 });
      },
    },
    {
      title: 'Collapse a doorway',
      say: 'A doorway collapses. The first firefighter to reach it reports it, and from then on every route, on every device, avoids it.',
      watch: 'The cross on the doorway, and the firefighters re-routing around it.',
      doLabel: 'Collapse a doorway',
      async do(status) {
        top();
        const d = doorOnARoute();
        if (!d) return 'No doorway left to collapse.';
        act('door', d);
        await play(status, { seconds: 10 });
      },
    },
    {
      title: 'Trapped by a collapse',
      say: 'Now we send a firefighter into a room with one door, and that door collapses. They call a mayday straight away, and the nearest teammate comes on their own and forces the doorway open.',
      watch: '"Mayday: trapped", a teammate breaking off, "forces the collapsed doorway" (about 10 s), then "has a way out again".',
      doLabel: 'Trap a firefighter',
      async do(status) {
        top();
        const rooms = oneDoorRooms();
        const crew = free();
        if (!rooms.length) return 'No room with a single doorway is left standing. Use "Firefighter down" next.';
        if (crew.length < 2) return 'Not enough free firefighters for a rescue right now. Press Do it again in a moment.';
        // the free firefighter nearest to a one-door room goes in
        let best = null;
        for (const f of crew) {
          for (const r of rooms) {
            const hops = f.room === r ? 0 : route(f.room, r).length;
            if (f.room !== r && !hops) continue; // no way there
            const score = f.room === r ? -1 : hops;
            if (!best || score < best.score) best = { f, r, score };
          }
        }
        if (!best) best = { f: crew[0], r: rooms[0] };
        const { f, r } = best;
        const door = doorsOf(r)[0];
        if (f.room !== r) {
          sim().command(f.id, r);
          const ok = await play(status, { until: () => f.room === r, max: 40, label: `Sending ${f.id} into ${ROOMS[r].name}` });
          if (!ok) return;
          if (f.room !== r) return `${f.id} could not reach ${ROOMS[r].name}. Press Do it again.`;
        }
        if (f.manual) sim().command(f.id, 'AUTO');
        const mark = logMark();
        act('door', door);
        await play(status, { until: () => said(new RegExp(`${f.label} (has a way out again|.* are out)|and ${f.label} are out`), mark), max: 60 });
      },
    },
    {
      title: 'Start a fire',
      say: 'A second fire. Heat and smoke spread through the doorways, sensors burn, and every crew re-plans from its own picture.',
      watch: 'The red room, the temperature rising in the rooms next to it, and sensors crossed out as they reach 250°C.',
      doLabel: 'Start a second fire',
      async do(status) {
        top();
        const r = farRoom();
        if (!r) return 'Every room is already burning.';
        act('ignite', r);
        await play(status, { seconds: 12 });
      },
    },
    {
      title: 'Firefighter down',
      say: 'A firefighter goes down. The nearest free teammate sees it in its own copy, breaks off, walks to them and brings them out, together.',
      watch: 'The red MAYDAY ring, a teammate breaking off, and the two walking out side by side.',
      doLabel: 'Put a firefighter down',
      async do(status) {
        top();
        let f = insideFree()[0];
        if (!f) {
          // nobody free inside yet: play until someone goes in
          await play(status, { until: () => insideFree().length > 0, max: 30, label: 'Waiting for a firefighter to go inside' });
          f = insideFree()[0];
        }
        if (!f) return 'No free firefighter is inside right now. Press Do it again in a moment.';
        const mark = logMark();
        act('mayday', f.id);
        await play(status, { until: () => said(new RegExp(`and ${f.label} are out`), mark), max: 60 });
      },
    },
    {
      title: 'Jam the radio',
      say: 'Total radio loss for ten seconds. Every player keeps going from its own copy. Nothing is lost, and when the radio returns they agree again.',
      watch: '"Radio messages lost" in Live measures goes to 100%, the links stop flashing, then "All nodes agree again after … s".',
      doLabel: 'Jam the radio for 10 s',
      async do(status) {
        top();
        const t0 = sim().t;
        press('jam');
        await play(status, { until: () => sim().t - t0 > 10 && bannerSays(/agree again/i), max: 35 });
      },
    },
    {
      title: 'Fire speed',
      say: 'In a real fire, every second changes the right decision. Speed the fire up and watch the crews pull out sooner.',
      watch: 'Heat spreading faster, more sensors lost, crews pulling out "while the way out is still below 240°C".',
      doLabel: 'Fire at 2x',
      async do(status) {
        top();
        press('fire-speed');
        await play(status, { seconds: 12 });
      },
    },
    {
      title: 'Measured, not claimed',
      say: 'We measured it. Across 100 random fires with more than half the sensors destroyed, an occupied room was shown as empty in about a third of one percent of checks, and never at the end of a run.',
      watch: 'Live measures: sensors alive, radio messages lost, searches, and "Agreed again after".',
      doLabel: 'Show the live measures',
      async do() {
        show('.metrics', 'start');
      },
    },
  ];

  // ---- the panel ------------------------------------------------------------------------
  let i = 0;
  let running = false;
  const panel = $('guide-panel');
  const status = (text) => {
    $('guide-status').textContent = text;
  };
  function render() {
    const s = STEPS[i];
    $('guide-count').textContent = `${i + 1} / ${STEPS.length}`;
    $('guide-title').textContent = s.title;
    $('guide-say').textContent = s.say;
    $('guide-watch').textContent = s.watch;
    $('guide-do').textContent = s.doLabel;
    $('guide-do').disabled = running;
    $('guide-back').disabled = i === 0;
    $('guide-next').textContent = i === STEPS.length - 1 ? 'Finish' : 'Next';
    status(running ? '' : i === 0 ? 'The incident is paused while the guide is open.' : '');
  }
  function go(n) {
    cancelled += 1; // stop a scene that is still playing
    running = false;
    setPaused(true);
    i = Math.max(0, Math.min(STEPS.length - 1, n));
    STEPS[i].enter?.();
    render();
  }
  async function doStep() {
    if (running) return;
    running = true;
    $('guide-do').disabled = true;
    const ticket = cancelled;
    try {
      const msg = await STEPS[i].do(status);
      if (ticket === cancelled) status(msg ?? held);
    } catch (err) {
      status(`Something went wrong: ${err.message}`);
    } finally {
      if (ticket === cancelled) {
        running = false;
        $('guide-do').disabled = false;
      }
    }
  }
  function open() {
    panel.hidden = false;
    document.body.classList.add('guiding');
    $('guide-open').setAttribute('aria-expanded', 'true');
    setPaused(true);
    render();
  }
  function close() {
    cancelled += 1;
    running = false;
    panel.hidden = true;
    document.body.classList.remove('guiding');
    $('guide-open').setAttribute('aria-expanded', 'false');
    setPaused(false);
  }
  $('guide-open').addEventListener('click', () => (panel.hidden ? open() : close()));
  $('guide-close').addEventListener('click', close);
  $('guide-do').addEventListener('click', doStep);
  $('guide-back').addEventListener('click', () => go(i - 1));
  $('guide-next').addEventListener('click', () => (i === STEPS.length - 1 ? close() : go(i + 1)));
  document.addEventListener('keydown', (e) => {
    if (panel.hidden || e.target.closest?.('input, select, textarea')) return;
    if (e.key === 'ArrowRight') go(i + 1);
    else if (e.key === 'ArrowLeft') go(i - 1);
    else if (e.key === 'Enter' && !e.target.closest?.('button')) doStep();
    else if (e.key === 'Escape') close();
  });
  return { open, close, go, doStep, steps: STEPS, get running() { return running; } };
}
