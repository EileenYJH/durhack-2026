// The demo guide: walks the presenter through every case, one step at a time.
// Each step says what to say, does the action with one button (exactly what a
// click on the board would do), and says what to watch. Arrow keys move
// between steps; Enter does the step.

import { ROOMS, ROOM_IDS, DOORS, doorsOf, isHall, exitDoors } from '../core/building.js';

export function createGuide(api) {
  const { sim, act, press, setViewer, $ } = api;

  // ---- choosing good targets at the moment of the click ----------------------------
  const firefighters = () => sim().nodes.filter((n) => n.kind === 'responder');
  // inside, working, and not busy rescuing or being rescued
  const insideOk = () => firefighters().filter((n) => n.alive && n.status === 'ok' && n.room !== 'OUT' && !sim().rooms[n.room].burning && !n.escort && !n.mission && !n.forcing && !firefighters().some((m) => m.escort === n.id));
  const goodLink = () =>
    sim()
      .links()
      .filter((l) => !l.severed && l.q > 0 && l.a.kind !== 'responder' && l.b.kind !== 'responder' && l.a.alive && l.b.alive)
      .sort((x, y) => Math.hypot(y.a.x - y.b.x, y.a.y - y.b.y) - Math.hypot(x.a.x - x.b.x, x.a.y - x.b.y))
      .find((l) => api.detourPath(l.a.id, l.b.id, l.key));
  const occupiedSensor = () => {
    const s = sim();
    return (
      s.nodes.find((n) => n.kind === 'room' && n.alive && !isHall(n.room) && !s.rooms[n.room].burning && s.people.some((p) => p.room === n.room && p.mode !== 'lost')) ??
      s.nodes.find((n) => n.kind === 'room' && n.alive && !s.rooms[n.room].burning)
    );
  };
  const doorOnARoute = () => {
    const s = sim();
    for (const f of firefighters()) for (const w of f.path ?? []) if (w.door && !s.blocked.has(w.door) && !exitDoors().includes(w.door)) return w.door;
    return Object.keys(DOORS).find((d) => !s.blocked.has(d) && !exitDoors().includes(d));
  };
  const trapCandidate = () => {
    const s = sim();
    for (const n of insideOk()) {
      if (isHall(n.room)) continue;
      const ds = doorsOf(n.room);
      if (ds.length === 1 && !exitDoors().includes(ds[0]) && !s.blocked.has(ds[0])) return { ff: n, door: ds[0] };
    }
    return null;
  };
  const farRoom = () => {
    const s = sim();
    const burning = ROOM_IDS.filter((r) => s.rooms[r].burning);
    const centre = (r) => ({ x: ROOMS[r].x + ROOMS[r].w / 2, y: ROOMS[r].y + ROOMS[r].h / 2 });
    const distFromFire = (r) => Math.min(...burning.map((b) => Math.hypot(centre(r).x - centre(b).x, centre(r).y - centre(b).y)), 1e9);
    return ROOM_IDS.filter((r) => !isHall(r) && !s.rooms[r].burning).sort((a, b) => distFromFire(b) - distFromFire(a))[0];
  };
  const waitFor = (test, ms) =>
    new Promise((ok) => {
      const t0 = performance.now();
      const tick = () => {
        const v = test();
        if (v || performance.now() - t0 > ms) ok(v);
        else setTimeout(tick, 250);
      };
      tick();
    });
  const show = (sel) => document.querySelector(sel)?.scrollIntoView({ behavior: 'smooth', block: sel === '.plan' ? 'start' : 'center' });

  // ---- the steps ------------------------------------------------------------------------
  const STEPS = [
    {
      title: 'The board',
      say: 'ARIA is an orchestra with no one beating time. Every sensor, door counter and firefighter is a player with its own copy of the building. There is no central server holding the truth.',
      watch: 'The plan: coloured rooms are what the command post believes. White dots are where people really are (simulation only).',
      doLabel: 'Start a fresh incident',
      async do() {
        press('reset');
        await new Promise((r) => setTimeout(r, 300));
        press('alarm');
        show('.plan');
      },
    },
    {
      title: 'Search order',
      say: 'The common goal is to find everyone. Nobody hands out rooms: every firefighter reads the same score, the same rules, on its own copy, so they split the search without a word on the radio.',
      watch: 'Search order on the right: the room to search first, and why. Triangles R1 to R3 head for different rooms.',
      doLabel: 'Read the brief aloud',
      do() {
        press('speak');
        show('.board');
      },
    },
    {
      title: 'Inspect: each node has its own picture',
      say: 'Every node keeps its own picture. Here is the building as firefighter R2 believes it.',
      watch: 'The heading changes to "as believed by Responder 2", and the plan shows R2\'s own copy.',
      doLabel: "Show R2's picture",
      do() {
        show('.plan');
        act('inspect', 'R2');
      },
    },
    {
      title: 'Cut the link',
      say: 'The fire takes out the radio between the two wings. Parts drop out, but the piece goes on: each side keeps searching from what it last heard, and rooms nobody can hear from turn unknown, never empty.',
      watch: 'The red line down the middle. Then the grid "What each node believes": the columns start to disagree.',
      doLabel: 'Cut the link',
      enter: () => setViewer('POST'),
      async do() {
        show('.plan');
        if (!sim().cut) press('cut');
        await new Promise((r) => setTimeout(r, 3500));
        show('.matrix');
      },
    },
    {
      title: 'Back in time',
      say: 'When the players can hear each other again, they are back in time within seconds. No referee, no shared clock: every record carries its age.',
      watch: 'The green banner "All nodes agree again after … s".',
      doLabel: 'Restore the link',
      do() {
        show('.plan');
        if (sim().cut) press('cut');
      },
    },
    {
      title: 'Sever a link',
      say: 'Now just one radio link fails. The news does not need that link: it goes around it, passed on by the other players.',
      watch: 'The red dashed line is the lost link; the moving blue route is the way the news goes around it.',
      doLabel: 'Sever a link',
      do() {
        show('.plan');
        const l = goodLink();
        if (!l) return 'No link with a way around it right now. Try again in a moment.';
        act('sever', l.key);
      },
    },
    {
      title: 'Kill a sensor',
      say: 'A sensor burns out. The easy mistake is to read silence as "empty". ARIA never does: a room nobody can see turns unknown.',
      watch: 'The crossed-out sensor, and its room turning grey "Unknown", never green "Confirmed empty".',
      doLabel: 'Kill a sensor',
      do() {
        show('.plan');
        const n = occupiedSensor();
        if (!n) return 'No working sensor left to kill.';
        act('kill', n.id);
      },
    },
    {
      title: 'Collapse a doorway',
      say: 'A doorway collapses. The first firefighter to reach it reports it, and from then on every route, on every device, avoids it.',
      watch: 'The cross on the doorway, and the firefighters re-routing around it.',
      doLabel: 'Collapse a doorway',
      do() {
        show('.plan');
        const d = doorOnARoute();
        if (!d) return 'No doorway left to collapse.';
        act('door', d);
      },
    },
    {
      title: 'Trapped by a collapse',
      say: 'Now the doorway collapses on a firefighter. They see it, call a mayday straight away, and the nearest teammate comes and forces the doorway open. Nobody had to order it.',
      watch: '"Mayday: trapped", then a teammate breaking off, forcing the doorway (about 10 s), and the trapped firefighter walking out.',
      doLabel: 'Collapse it on a firefighter',
      async do(status) {
        show('.plan');
        let c = trapCandidate();
        if (!c) {
          status('Waiting for a firefighter to be alone in a room with one door…');
          c = await waitFor(trapCandidate, 45000);
        }
        if (!c) return 'No firefighter went into a one-door room. Use "Firefighter down" instead.';
        status('');
        act('door', c.door);
      },
    },
    {
      title: 'Start a fire',
      say: 'A second fire. Heat and smoke spread through the doorways, sensors burn, and every crew re-plans from its own picture.',
      watch: 'The red room, the temperature rising in the rooms next to it, and sensors crossed out as they reach 250°C.',
      doLabel: 'Start a second fire',
      do() {
        show('.plan');
        const r = farRoom();
        if (!r) return 'Every room is already burning.';
        act('ignite', r);
      },
    },
    {
      title: 'Firefighter down',
      say: 'A firefighter goes down. The nearest free teammate sees it in its own copy, breaks off, walks to them and brings them out, together.',
      watch: 'The red MAYDAY ring, the teammate breaking off, and the two walking out side by side.',
      doLabel: 'Put a firefighter down',
      async do(status) {
        show('.plan');
        let f = insideOk()[0];
        if (!f) {
          status('Waiting for a firefighter to go inside…');
          f = await waitFor(() => insideOk()[0], 30000);
        }
        if (!f) return 'No firefighter is inside right now.';
        status('');
        act('mayday', f.id);
      },
    },
    {
      title: 'Jam the radio',
      say: 'Total radio loss for ten seconds. Every player keeps going from its own copy. Nothing is lost, and when the radio returns they agree again.',
      watch: '"Radio messages lost" goes to 100%, the links stop flashing, then "All nodes agree again after … s".',
      doLabel: 'Jam the radio for 10 s',
      do() {
        show('.plan');
        press('jam');
      },
    },
    {
      title: 'Fire speed',
      say: 'In a real fire, every second changes the right decision. Speed the fire up and watch the crews pull out sooner.',
      watch: 'Heat spreading faster, more sensors lost, crews pulling out "while the way out is still below 240°C".',
      doLabel: 'Fire at 2x',
      do() {
        show('.plan');
        press('fire-speed');
      },
    },
    {
      title: 'Measured, not claimed',
      say: 'We measured it. Across 100 random fires with more than half the sensors destroyed, an occupied room was shown as empty in about a third of one percent of checks, and never at the end of a run.',
      watch: 'Live measures: sensors alive, radio messages lost, searches, and "Agreed again after".',
      doLabel: 'Show the live measures',
      do() {
        show('.metrics');
      },
    },
  ];

  // ---- the panel ------------------------------------------------------------------------
  let i = 0;
  let busy = false;
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
    $('guide-do').disabled = busy;
    $('guide-back').disabled = i === 0;
    $('guide-next').textContent = i === STEPS.length - 1 ? 'Finish' : 'Next';
    status('');
  }
  function go(n) {
    i = Math.max(0, Math.min(STEPS.length - 1, n));
    STEPS[i].enter?.();
    render();
  }
  async function doStep() {
    if (busy) return;
    busy = true;
    $('guide-do').disabled = true;
    try {
      const msg = await STEPS[i].do(status);
      status(msg ?? 'Done. Read the banner over the plan.');
    } finally {
      busy = false;
      $('guide-do').disabled = false;
    }
  }
  function open() {
    panel.hidden = false;
    $('guide-open').setAttribute('aria-expanded', 'true');
    render();
  }
  function close() {
    panel.hidden = true;
    $('guide-open').setAttribute('aria-expanded', 'false');
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
  return { open, close, go, doStep, steps: STEPS };
}
