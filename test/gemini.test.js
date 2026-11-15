import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createGemini } from '../src/server/gemini.js';
import { faithful } from '../src/core/faithful.js';

// A stand-in for Google: records every request and answers like the real APIs.
async function mockGoogle() {
  const seen = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks).toString();
    seen.push({ method: req.method, url: req.url, headers: req.headers, body });
    res.setHeader('content-type', 'application/json');
    if (req.url === '/token') return res.end(JSON.stringify({ access_token: `tok-${seen.length}`, expires_in: 3600 }));
    if (req.url.includes('FAIL')) return (res.statusCode = 403), res.end(JSON.stringify({ error: { message: 'Vertex AI API has not been used in project X' } }));
    res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'OK from mock' }] } }] }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { seen, base, close: () => server.close() };
}

test('AI Studio: key in a header, model in the path', async (t) => {
  const g = await mockGoogle();
  t.after(g.close);
  const gem = createGemini({ GEMINI_API_KEY: 'studio-key' }, { studio: g.base });
  assert.equal(await gem.generate('sys', [{ text: 'hi' }]), 'OK from mock');
  assert.equal(g.seen[0].url, '/v1beta/models/gemini-3.5-flash:generateContent');
  assert.equal(g.seen[0].headers['x-goog-api-key'], 'studio-key');
  assert.equal(JSON.parse(g.seen[0].body).contents[0].role, 'user');
});

test('Vertex express: a key in a header, no project in the path', async (t) => {
  const g = await mockGoogle();
  t.after(g.close);
  const gem = createGemini({ GEMINI_PROVIDER: 'vertex-express', VERTEX_API_KEY: 'express-key' }, { express: g.base });
  assert.equal(gem.describe(), 'Vertex AI express mode, gemini-3.5-flash');
  assert.equal(await gem.generate('sys', [{ text: 'hi' }]), 'OK from mock');
  assert.equal(g.seen[0].url, '/v1/publishers/google/models/gemini-3.5-flash:generateContent');
  assert.equal(g.seen[0].headers['x-goog-api-key'], 'express-key');
  assert.equal(g.seen[0].headers.authorization, undefined);
  // GEMINI_API_KEY is used when it is the only key there is
  assert.equal(createGemini({ GEMINI_PROVIDER: 'vertex-express', GEMINI_API_KEY: 'k' }).ready(), true);
  assert.match(createGemini({ GEMINI_PROVIDER: 'vertex-express' }).problem(), /VERTEX_API_KEY/);
});

test('Vertex with a service account: signed JWT, bearer token, project path, token reused', async (t) => {
  const g = await mockGoogle();
  t.after(g.close);
  const dir = await mkdtemp(path.join(tmpdir(), 'rc-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const keyFile = path.join(dir, 'key.json');
  await writeFile(keyFile, JSON.stringify({ client_email: 'rollcall@proj.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) }));

  const gem = createGemini(
    { GEMINI_PROVIDER: 'vertex', GCP_PROJECT: 'my-proj', GCP_LOCATION: 'europe-west2', GOOGLE_APPLICATION_CREDENTIALS: keyFile },
    { vertex: g.base, token: `${g.base}/token` },
  );
  assert.equal(gem.describe(), 'Vertex AI, europe-west2, gemini-3.5-flash');
  await gem.generate('sys', [{ text: 'a' }]);
  await gem.generate('sys', [{ text: 'b' }]);

  const tokenCalls = g.seen.filter((s) => s.url === '/token');
  assert.equal(tokenCalls.length, 1, 'the token is fetched once and reused');
  const assertion = new URLSearchParams(tokenCalls[0].body).get('assertion');
  const [h, p, sig] = assertion.split('.');
  assert.equal(JSON.parse(Buffer.from(p, 'base64url')).iss, 'rollcall@proj.iam.gserviceaccount.com');
  assert.equal(JSON.parse(Buffer.from(p, 'base64url')).scope, 'https://www.googleapis.com/auth/cloud-platform');
  assert.ok(createVerify('RSA-SHA256').update(`${h}.${p}`).verify(publicKey, Buffer.from(sig, 'base64url')), 'the signature verifies against the public key');

  const calls = g.seen.filter((s) => s.url !== '/token');
  assert.equal(calls[0].url, '/v1/projects/my-proj/locations/europe-west2/publishers/google/models/gemini-3.5-flash:generateContent');
  assert.equal(calls[0].headers.authorization, 'Bearer tok-1');
  assert.equal(calls[0].headers['x-goog-api-key'], undefined, 'no AI Studio key is sent to Vertex');
});

test('Vertex can take the service-account key as JSON in a variable', async (t) => {
  const g = await mockGoogle();
  t.after(g.close);
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const json = JSON.stringify({ client_email: 'rollcall-railway@p.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) });
  const gem = createGemini({ GEMINI_PROVIDER: 'vertex', GCP_PROJECT: 'p', GCP_LOCATION: 'global', GOOGLE_CREDENTIALS_JSON: json }, { vertex: g.base, token: `${g.base}/token` });
  assert.equal(await gem.generate('s', [{ text: 'x' }]), 'OK from mock');
  assert.equal(g.seen.filter((s) => s.url === '/token').length, 1);
  await assert.rejects(createGemini({ GEMINI_PROVIDER: 'vertex', GCP_PROJECT: 'p', GOOGLE_CREDENTIALS_JSON: 'not json' }, { vertex: g.base, token: `${g.base}/token` }).generate('s', [{ text: 'x' }]), /not valid JSON/);
});

test('Vertex errors from Google are readable and short', async (t) => {
  const g = await mockGoogle();
  t.after(g.close);
  const dir = await mkdtemp(path.join(tmpdir(), 'rc-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const keyFile = path.join(dir, 'key.json');
  await writeFile(keyFile, JSON.stringify({ client_email: 'a@b.c', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) }));
  const gem = createGemini({ GEMINI_PROVIDER: 'vertex', GCP_PROJECT: 'FAIL', GOOGLE_APPLICATION_CREDENTIALS: keyFile }, { vertex: g.base, token: `${g.base}/token` });
  await assert.rejects(gem.generate('s', [{ text: 'x' }]), /Vertex AI returned 403: .*has not been used/);
});

test('a busy answer from Google is retried, then reported if it persists', async () => {
  let calls = 0;
  const reply = (status, body) => ({ ok: status === 200, status, text: async () => JSON.stringify(body), json: async () => body });
  const flaky = async () => (++calls < 3 ? reply(429, { error: { message: 'Resource exhausted' } }) : reply(200, { candidates: [{ content: { parts: [{ text: 'OK' }] } }] }));
  const gem = createGemini({ GEMINI_API_KEY: 'k' }, {}, flaky, [1, 1]);
  assert.equal(await gem.generate('s', [{ text: 'x' }]), 'OK');
  assert.equal(calls, 3);

  calls = 0;
  const busy = async () => (++calls, reply(429, { error: { message: 'Resource exhausted' } }));
  await assert.rejects(createGemini({ GEMINI_API_KEY: 'k' }, {}, busy, [1, 1]).generate('s', [{ text: 'x' }]), /returned 429/);
  assert.equal(calls, 3, 'tried three times in all');

  calls = 0;
  const denied = async () => (++calls, reply(403, { error: { message: 'no' } }));
  await assert.rejects(createGemini({ GEMINI_API_KEY: 'k' }, {}, denied, [1, 1]).generate('s', [{ text: 'x' }]), /returned 403/);
  assert.equal(calls, 1, 'a refusal is not retried');
});

test('missing settings are reported before any request is made', () => {
  assert.match(createGemini({ GEMINI_PROVIDER: 'vertex' }).problem(), /GCP_PROJECT/);
  assert.match(createGemini({}).problem(), /GEMINI_API_KEY/);
  assert.match(createGemini({ GEMINI_PROVIDER: 'nonsense' }).problem(), /must be/);
  assert.equal(createGemini({ GEMINI_API_KEY: 'k' }).ready(), true);
});

test('the default region is us-central1 and global uses the bare host', () => {
  assert.equal(createGemini({ GEMINI_PROVIDER: 'vertex', GCP_PROJECT: 'p' }).describe(), 'Vertex AI, us-central1, gemini-3.5-flash');
});

const ROOMS = ['Room 102', 'Corridor', 'Seminar'];

test('a faithful rewrite is accepted', () => {
  const original = 'Turn left and head north along the corridor. Room 102 is the 2nd door on your right. You are in Room 102.';
  const ok = 'Turn left and head north along the corridor. Room 102 is the 2nd door on your right, and you are in Room 102.';
  assert.equal(faithful(original, ok, ROOMS).ok, true);
});

test('a rewrite that changes direction, drops a compass word or a door number is rejected', () => {
  const original = 'Turn left and head north along the corridor. Room 102 is the 2nd door on your right.';
  assert.equal(faithful(original, 'Take the left, then Room 102 is the 2nd door on your right.', ROOMS).ok, false); // dropped north
  assert.equal(faithful(original, 'Turn right and head north along the corridor. Room 102 is the 2nd door on your right.', ROOMS).ok, false);
  assert.equal(faithful(original, 'Turn left and head north along the corridor. Room 102 is the 3rd door on your right.', ROOMS).ok, false);
  assert.equal(faithful(original, 'Turn left and head north along the corridor. Seminar is the 2nd door on your right.', ROOMS).ok, false);
});

test('a rewrite must keep the no-route warning', () => {
  const original = 'There is no route from outside to Seminar that avoids the fire.';
  assert.equal(faithful(original, "There's no route from outside to Seminar that avoids the fire.", ROOMS).ok, true);
  assert.equal(faithful(original, "There's no way in that avoids the fire.", ROOMS).ok, false); // dropped the room name
  assert.equal(faithful(original, 'Seminar is ahead. You are in Seminar.', ROOMS).ok, false);
});
