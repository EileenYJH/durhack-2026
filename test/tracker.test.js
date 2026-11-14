import test from 'node:test';
import assert from 'node:assert/strict';
import { createTracker } from '../src/live/tracker.js';

function walk(tracker, paths, frames = 20) {
  let net = 0;
  let last;
  for (let f = 0; f <= frames; f++) {
    const k = f / frames;
    const dets = paths.map(([from, to, y]) => ({ x: from + (to - from) * k, y }));
    last = tracker.update(dets, f * 0.1);
    for (const c of last.crossings) net += c;
  }
  return { net, last };
}

test('one person walking through is counted once', () => {
  assert.equal(walk(createTracker(), [[0.1, 0.9, 0.5]]).net, 1);
  assert.equal(walk(createTracker(), [[0.9, 0.1, 0.5]]).net, -1);
});

test('two people side by side are counted as two', () => {
  assert.equal(walk(createTracker(), [[0.1, 0.9, 0.3], [0.12, 0.92, 0.7]]).net, 2);
});

test('two people passing in opposite directions cancel out', () => {
  assert.equal(walk(createTracker(), [[0.1, 0.9, 0.25], [0.9, 0.1, 0.75]]).net, 0);
});

test('someone swaying on the line is not counted', () => {
  const tracker = createTracker();
  let net = 0;
  for (let f = 0; f < 60; f++) {
    const r = tracker.update([{ x: 0.5 + 0.04 * Math.sin(f / 3), y: 0.5 }], f * 0.1);
    for (const c of r.crossings) net += c;
  }
  assert.equal(net, 0);
});

test('a person who stops is reported as not moving', () => {
  const tracker = createTracker();
  let r;
  for (let f = 0; f < 50; f++) r = tracker.update([{ x: 0.3, y: 0.5 }], f * 0.1);
  assert.equal(r.tracks.length, 1);
  assert.equal(r.tracks[0].moving, false);
});

test('a missed frame does not break the track', () => {
  const tracker = createTracker();
  let net = 0;
  for (let f = 0; f <= 20; f++) {
    const dets = f % 4 === 2 ? [] : [{ x: 0.1 + 0.04 * f, y: 0.5 }];
    for (const c of tracker.update(dets, f * 0.1).crossings) net += c;
  }
  assert.equal(net, 1);
});
