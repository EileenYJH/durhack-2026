// Layout editor. Edits a working copy of the building, checks it as you go,
// and saves it for the other pages to use.

import { DEFAULT_LAYOUT, normalise, validateLayout, fromRaw, snapToBoundary, distToRect } from '../core/layout.js';
import { fromBoxes, repairLayout, photoFrame } from '../core/planfit.js';
import { setBuilding, searchRooms } from '../core/building.js';
import { directions } from '../core/directions.js';

const $ = (id) => document.getElementById(id);
const svg = $('canvas');
const GRID = 10;
const snap = (v) => Math.round(v / GRID) * GRID;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

const KEY = 'rollcall:layout';
const DRAFT = 'rollcall:draft';
let layout = load();
let tool = 'select';
let selected = null; // { type: 'room' | 'door', id }
let drag = null;
let draft = null; // room being drawn
let backdrop = null; // { url, x, y, w, h } the imported photo, shown under the plan
let backdropOpacity = 0.45;

function load() {
  for (const key of [DRAFT, KEY]) {
    try {
      const raw = localStorage.getItem(key);
      if (raw) return normalise(JSON.parse(raw));
    } catch {
      // ignore a damaged save
    }
  }
  return normalise(DEFAULT_LAYOUT);
}

const TOOL_HELP = {
  select: 'Click a room or door. Drag a room to move it.',
  room: 'Drag on the canvas to draw a room.',
  door: 'Click on a wall. Between two rooms makes a door, on an outer wall makes an exit.',
  delete: 'Click a room or door to remove it.',
};

// ---- geometry helpers ----------------------------------------------------------
function point(e) {
  const p = svg.createSVGPoint();
  p.x = e.clientX;
  p.y = e.clientY;
  const q = p.matrixTransform(svg.getScreenCTM().inverse());
  return { x: q.x, y: q.y };
}
const edgeDistance = (p, r) => {
  const s = snapToBoundary(p, r);
  return Math.hypot(p.x - s.x, p.y - s.y);
};
function uniqueId(prefix, taken) {
  let n = 1;
  while (taken[`${prefix}${n}`]) n += 1;
  return `${prefix}${n}`;
}

// ---- drawing -------------------------------------------------------------------
function render() {
  const rooms = Object.entries(layout.rooms)
    .map(([id, r]) => {
      const sel = selected?.type === 'room' && selected.id === id;
      return `<g class="e-room${r.hall ? ' hall' : ''}${sel ? ' sel' : ''}" data-room="${esc(id)}">
        <rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}"/>
        <text x="${r.x + 12}" y="${r.y + 26}">${esc(r.name)}</text>
        ${r.hall ? `<text class="tag" x="${r.x + 12}" y="${r.y + 44}">corridor, not searched</text>` : ''}
        ${sel ? `<rect class="handle" data-handle="${esc(id)}" x="${r.x + r.w - 9}" y="${r.y + r.h - 9}" width="18" height="18"/>` : ''}
      </g>`;
    })
    .join('');
  const doors = Object.entries(layout.doors)
    .map(([id, d]) => {
      const sel = selected?.type === 'door' && selected.id === id;
      const exit = d.a === 'OUT';
      return `<g class="e-door${exit ? ' exit' : ''}${sel ? ' sel' : ''}" data-door="${esc(id)}" transform="translate(${d.x} ${d.y})">
        <rect x="-10" y="-10" width="20" height="20"/>${exit ? '<text y="-16" text-anchor="middle">EXIT</text>' : ''}</g>`;
    })
    .join('');
  const preview = draft ? `<rect class="e-draft" x="${draft.x}" y="${draft.y}" width="${draft.w}" height="${draft.h}"/>` : '';
  const photo = backdrop ? `<image href="${backdrop.url}" x="${backdrop.x}" y="${backdrop.y}" width="${backdrop.w}" height="${backdrop.h}" opacity="${backdropOpacity}" preserveAspectRatio="none" pointer-events="none"/>` : '';
  svg.innerHTML = `<defs><pattern id="grid" width="${GRID * 5}" height="${GRID * 5}" patternUnits="userSpaceOnUse"><path d="M${GRID * 5} 0 L0 0 0 ${GRID * 5}" class="gridline"/></pattern></defs>
    <rect x="-200" y="-200" width="1600" height="1100" fill="url(#grid)" data-bg="1"/>${photo}<g class="${backdrop ? 'over-photo' : ''}">${rooms}${doors}${preview}</g>`;
}

function panel() {
  $('b-name').value = layout.name;
  $('b-name-top').textContent = layout.name;
  for (const b of document.querySelectorAll('[data-tool]')) b.setAttribute('aria-pressed', String(b.dataset.tool === tool));
  $('tool-help').textContent = TOOL_HELP[tool];

  const sel = $('selection');
  if (selected?.type === 'room' && layout.rooms[selected.id]) {
    const r = layout.rooms[selected.id];
    sel.innerHTML = `<h3>Room</h3>
      <div class="field"><label for="r-name">Name</label><input id="r-name" value="${esc(r.name)}" autocomplete="off"></div>
      <label class="check"><input type="checkbox" id="r-hall" ${r.hall ? 'checked' : ''}> Corridor or lobby (people pass through, not searched)</label>
      <div class="size-row">
        ${['x', 'y', 'w', 'h'].map((k) => `<label>${k.toUpperCase()}<input type="number" step="10" data-size="${k}" value="${r[k]}"></label>`).join('')}
      </div>
      <button id="r-delete">Delete room</button>`;
  } else if (selected?.type === 'door' && layout.doors[selected.id]) {
    const d = layout.doors[selected.id];
    const nm = (id) => (id === 'OUT' ? 'outside' : layout.rooms[id]?.name ?? id);
    sel.innerHTML = `<h3>${d.a === 'OUT' ? 'Exit' : 'Door'}</h3>
      <p>${d.a === 'OUT' ? `Exit from ${esc(nm(d.b))}.` : `Door between ${esc(nm(d.a))} and ${esc(nm(d.b))}.`}</p>
      <button id="d-delete">Delete</button>`;
  } else sel.innerHTML = '<p class="muted">Select a room or door to edit it.</p>';

  const check = validateLayout(layout);
  const items = [
    ...check.errors.map((t) => `<li class="bad">${esc(t)}</li>`),
    ...check.warnings.map((t) => `<li class="warn">${esc(t)}</li>`),
  ];
  $('checks').innerHTML = items.length ? items.join('') : '<li class="good">Every room can be reached from outside. This layout is ready to use.</li>';
  $('use').disabled = !check.ok;

  // Show what the voice directions would say, as a way to check the layout.
  let sample = '';
  if (check.ok) {
    setBuilding(layout);
    const far = searchRooms().at(-1);
    if (far) sample = `Sample, from outside to ${layout.rooms[far].name}: ${directions('OUT', far).join(' ')}`;
  }
  $('sample').textContent = sample;
  $('in-use').textContent = localStorage.getItem(KEY) ? 'Your layout' : 'Built-in';
}

function changed() {
  layout = normalise(layout);
  localStorage.setItem(DRAFT, JSON.stringify(layout));
  render();
  panel();
}

// ---- interaction ---------------------------------------------------------------
svg.addEventListener('pointerdown', (e) => {
  const p = point(e);
  const roomEl = e.target.closest('[data-room]');
  const doorEl = e.target.closest('[data-door]');
  const handle = e.target.closest('[data-handle]');
  svg.setPointerCapture(e.pointerId);

  if (tool === 'delete') {
    if (doorEl) delete layout.doors[doorEl.dataset.door];
    else if (roomEl) removeRoom(roomEl.dataset.room);
    selected = null;
    changed();
    return;
  }
  if (tool === 'room') {
    drag = { kind: 'draw', from: { x: snap(p.x), y: snap(p.y) } };
    draft = { x: drag.from.x, y: drag.from.y, w: 0, h: 0 };
    return;
  }
  if (tool === 'door') {
    addDoorAt(p);
    return;
  }
  if (handle) {
    selected = { type: 'room', id: handle.dataset.handle };
    drag = { kind: 'resize', id: handle.dataset.handle };
  } else if (doorEl) {
    selected = { type: 'door', id: doorEl.dataset.door };
    drag = null;
  } else if (roomEl) {
    const id = roomEl.dataset.room;
    selected = { type: 'room', id };
    drag = { kind: 'move', id, last: { x: snap(p.x), y: snap(p.y) } };
  } else selected = null;
  render();
  panel();
});

svg.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const p = point(e);
  if (drag.kind === 'draw') {
    const x = snap(p.x);
    const y = snap(p.y);
    draft = { x: Math.min(drag.from.x, x), y: Math.min(drag.from.y, y), w: Math.abs(x - drag.from.x), h: Math.abs(y - drag.from.y) };
  } else if (drag.kind === 'move') {
    const dx = snap(p.x) - drag.last.x;
    const dy = snap(p.y) - drag.last.y;
    if (!dx && !dy) return;
    const r = layout.rooms[drag.id];
    r.x += dx;
    r.y += dy;
    for (const d of Object.values(layout.doors)) {
      if (d.a === drag.id || d.b === drag.id) {
        d.x += dx;
        d.y += dy;
      }
    }
    drag.last = { x: drag.last.x + dx, y: drag.last.y + dy };
  } else if (drag.kind === 'resize') {
    const r = layout.rooms[drag.id];
    r.w = Math.max(40, snap(p.x) - r.x);
    r.h = Math.max(40, snap(p.y) - r.y);
  }
  render();
});

svg.addEventListener('pointerup', () => {
  if (!drag) return;
  if (drag.kind === 'draw') {
    if (draft && draft.w >= 40 && draft.h >= 40) {
      const id = uniqueId('R', layout.rooms);
      layout.rooms[id] = { name: `Room ${id.slice(1)}`, ...draft };
      selected = { type: 'room', id };
      tool = 'select';
    }
    draft = null;
  }
  drag = null;
  changed();
});

function removeRoom(id) {
  delete layout.rooms[id];
  for (const [k, d] of Object.entries(layout.doors)) if (d.a === id || d.b === id) delete layout.doors[k];
}

function addDoorAt(p) {
  const near = Object.entries(layout.rooms)
    .map(([id, r]) => ({ id, dist: edgeDistance(p, r) }))
    .filter((c) => c.dist <= 16)
    .sort((a, b) => a.dist - b.dist);
  if (!near.length) {
    $('tool-help').textContent = 'No wall there. Click closer to a room wall.';
    return;
  }
  const id = uniqueId('d', layout.doors);
  if (near.length >= 2) layout.doors[id] = { a: near[0].id, b: near[1].id, x: p.x, y: p.y };
  else layout.doors[id] = { a: 'OUT', b: near[0].id, x: p.x, y: p.y };
  selected = { type: 'door', id };
  changed();
}

document.addEventListener('keydown', (e) => {
  if ((e.key === 'Delete' || e.key === 'Backspace') && selected && document.activeElement === document.body) {
    if (selected.type === 'room') removeRoom(selected.id);
    else delete layout.doors[selected.id];
    selected = null;
    changed();
  }
});

// ---- panel controls --------------------------------------------------------------
for (const b of document.querySelectorAll('[data-tool]')) {
  b.addEventListener('click', () => {
    tool = b.dataset.tool;
    panel();
  });
}
$('b-name').addEventListener('input', (e) => {
  layout.name = e.target.value;
  localStorage.setItem(DRAFT, JSON.stringify(layout));
  $('b-name-top').textContent = layout.name;
});
$('selection').addEventListener('input', (e) => {
  if (selected?.type !== 'room') return;
  const r = layout.rooms[selected.id];
  if (e.target.id === 'r-name') r.name = e.target.value;
  if (e.target.id === 'r-hall') r.hall = e.target.checked || undefined;
  if (e.target.dataset?.size) {
    const v = Number(e.target.value);
    if (Number.isFinite(v)) r[e.target.dataset.size] = v;
  }
  if (e.target.id === 'r-name') {
    localStorage.setItem(DRAFT, JSON.stringify(layout));
    render();
    return;
  }
  changed();
});
$('selection').addEventListener('click', (e) => {
  if (e.target.id === 'r-delete') removeRoom(selected.id);
  else if (e.target.id === 'd-delete') delete layout.doors[selected.id];
  else return;
  selected = null;
  changed();
});

$('use').addEventListener('click', () => {
  if (!validateLayout(layout).ok) return;
  localStorage.setItem(KEY, JSON.stringify(layout));
  localStorage.removeItem(DRAFT);
  location.href = 'index.html';
});
$('photo-opacity').addEventListener('input', (e) => {
  backdropOpacity = Number(e.target.value) / 100;
  render();
});
$('photo-hide').addEventListener('click', () => {
  backdrop = null;
  $('photo-tools').hidden = true;
  render();
});

$('builtin').addEventListener('click', () => {
  localStorage.removeItem(KEY);
  localStorage.removeItem(DRAFT);
  layout = normalise(DEFAULT_LAYOUT);
  selected = null;
  changed();
});
$('blank').addEventListener('click', () => {
  layout = { name: 'New building', rooms: {}, doors: {} };
  selected = null;
  render();
  panel();
  localStorage.setItem(DRAFT, JSON.stringify(layout));
});
$('download').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(layout, null, 2)], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: `${layout.name.replace(/\W+/g, '-').toLowerCase() || 'building'}.json` });
  a.click();
  URL.revokeObjectURL(url);
});
$('import').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    layout = normalise(fromRaw(JSON.parse(await file.text())));
    selected = null;
    changed();
  } catch {
    $('photo-status').textContent = 'That file is not a layout.';
  }
  e.target.value = '';
});

// ---- photo import ------------------------------------------------------------------
// Turns any picture the browser can open into a JPEG no wider than `max`.
// The quick decoder handles JPEG, PNG, WebP, GIF and BMP. SVG and some others
// only open through an <img> element, so that is the second try. HEIC (the
// iPhone default) and PDF cannot be opened by Chrome or Edge on Windows at all.
function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('undecodable'));
    };
    img.src = url;
  });
}

function unreadable(file) {
  const kind = (file.type || file.name.split('.').pop() || 'this').replace(/^image\//, '').toUpperCase();
  if (/HEI[CF]/.test(kind) || /\.hei[cf]$/i.test(file.name)) return 'This is an HEIC photo (the iPhone default), which the browser cannot open. On the iPhone, set Camera > Formats > Most Compatible, or share the photo as JPEG, then try again.';
  if (/PDF/.test(kind)) return 'This is a PDF. Take a screenshot of the plan, or export the page as PNG, then try again.';
  return `The browser cannot open ${kind} files. Save the plan as JPEG, PNG or WebP and try again.`;
}

async function downscale(file, max = 1400) {
  let source;
  try {
    source = await createImageBitmap(file);
  } catch {
    try {
      source = await loadImage(file);
    } catch {
      throw new Error(unreadable(file));
    }
  }
  const w = source.width || 1200;
  const h = source.height || 800;
  const k = Math.min(1, max / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * k));
  c.height = Math.max(1, Math.round(h * k));
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; // transparent PNG and SVG plans would otherwise turn black
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(source, 0, 0, c.width, c.height);
  return { url: c.toDataURL('image/jpeg', 0.85), w, h };
}

$('photo').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const status = $('photo-status');
  status.textContent = 'Reading the plan. This can take 10 to 20 seconds.';
  try {
    const pic = await downscale(file);
    const r = await fetch('/api/layout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ image: pic.url }) });
    const out = await r.json();
    if (!r.ok) throw new Error(out.error ?? `server returned ${r.status}`);
    const fixed = repairLayout(fromBoxes(out.layout, pic.w, pic.h));
    layout = fixed.layout;
    const f = photoFrame(pic.w, pic.h);
    backdrop = { url: pic.url, x: f.x, y: f.y, w: f.w, h: f.h };
    $('photo-tools').hidden = false;
    selected = null;
    changed();
    const check = validateLayout(layout);
    const head = check.ok
      ? `Imported ${Object.keys(layout.rooms).length} rooms and ${Object.keys(layout.doors).length} doors. The photo is shown underneath: compare and fix anything wrong.`
      : 'Imported, but it still has problems (see Check). Fix them against the photo underneath.';
    status.innerHTML = `${esc(head)}${fixed.notes.length ? `<br><strong>Repaired automatically, please check:</strong><br>${fixed.notes.map(esc).join('<br>')}` : ''}`;
  } catch (err) {
    status.textContent = err.message.startsWith('This ') || err.message.startsWith('The browser') ? err.message : `Could not read the plan: ${err.message}`;
  }
  e.target.value = '';
});

render();
panel();
