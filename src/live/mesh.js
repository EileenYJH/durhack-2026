// Joins this device to the mesh. Each device sends its whole state once a
// second and merges whatever it hears. The server in between only forwards.
// Turning the radio off drops traffic in both directions, like losing signal;
// state keeps accumulating locally and is merged when the radio returns.

import { snapshot, merge } from '../core/replica.js';

export function joinMesh({ mesh, id, rep, now, onNews }) {
  const q = `mesh=${encodeURIComponent(mesh)}&id=${encodeURIComponent(id)}`;
  const peers = {}; // peer id -> local time last heard
  let radio = true;
  let online = false;

  const source = new EventSource(`/mesh/stream?${q}`);
  source.onopen = () => (online = true);
  source.onerror = () => (online = false); // EventSource reconnects by itself
  source.onmessage = (e) => {
    if (!radio) return;
    const snap = JSON.parse(e.data);
    peers[snap.from] = now();
    const news = merge(rep, snap, now());
    onNews?.(snap.from, news);
  };

  const timer = setInterval(() => {
    if (!radio) return;
    fetch(`/mesh/send?${q}`, { method: 'POST', body: JSON.stringify(snapshot(rep, now())) }).catch(() => (online = false));
  }, 1000);

  return {
    peers,
    setRadio(on) {
      radio = on;
    },
    get radio() {
      return radio;
    },
    get online() {
      return online;
    },
    leave() {
      clearInterval(timer);
      source.close();
    },
  };
}
