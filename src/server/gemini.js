// Calls Gemini through Google AI Studio, or through Vertex AI (Google Cloud,
// billed to a project). The rest of the server only sees
// generate(system, parts, options) and does not care which one is in use.
//
// GEMINI_PROVIDER picks the route:
//   aistudio        an AI Studio API key (GEMINI_API_KEY). The default.
//   vertex-express  a Vertex AI "express mode" API key (VERTEX_API_KEY, or
//                   GEMINI_API_KEY if that is the key you have). No project
//                   or sign-in tools needed.
//   vertex          full Vertex AI for a project (GCP_PROJECT). Signs in with
//                   a service-account key file (GOOGLE_APPLICATION_CREDENTIALS),
//                   else the gcloud tool (`gcloud auth application-default login`).
//                   Tokens last about an hour and are reused until just before
//                   they expire.

import { exec } from 'node:child_process';
import { createSign } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

// Newer Gemini models spend part of the output limit on internal reasoning
// before they write anything. This much is added to every request so the
// visible answer is not cut off; the prompts themselves keep answers short.
const REASONING_HEADROOM = 3000;

// When Google says "busy, try again" (429) or has a passing fault (500, 503),
// wait and try again. retryDelays can be shortened in tests.
export function createGemini(env = process.env, endpoints = {}, fetchImpl = fetch, retryDelays = [2500, 7000]) {
  const provider = (env.GEMINI_PROVIDER ?? 'aistudio').toLowerCase();
  const model = env.GEMINI_MODEL ?? 'gemini-3.5-flash';
  const project = env.GCP_PROJECT;
  const location = env.GCP_LOCATION ?? 'us-central1';
  const key = provider === 'vertex-express' ? (env.VERTEX_API_KEY ?? env.GEMINI_API_KEY) : env.GEMINI_API_KEY;
  const credentialsFile = env.GOOGLE_APPLICATION_CREDENTIALS;
  const tokenUrl = endpoints.token ?? 'https://oauth2.googleapis.com/token';

  let cached = null; // { token, until }
  let pending = null;

  async function serviceAccountToken() {
    const sa = JSON.parse(await readFile(credentialsFile, 'utf8'));
    if (!sa.client_email || !sa.private_key) throw new Error('That credentials file is not a service-account key.');
    const now = Math.floor(Date.now() / 1000);
    const part = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const unsigned = `${part({ alg: 'RS256', typ: 'JWT' })}.${part({ iss: sa.client_email, scope: SCOPE, aud: tokenUrl, iat: now, exp: now + 3600 })}`;
    const signature = createSign('RSA-SHA256').update(unsigned).sign(sa.private_key).toString('base64url');
    const r = await fetchImpl(tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!r.ok) throw new Error(`Google sign-in refused the service account (${r.status}).`);
    const out = await r.json();
    return { token: out.access_token, seconds: out.expires_in ?? 3600 };
  }

  // `gcloud` on the PATH, or where the Windows installer puts it for one user.
  // A terminal opened before the install does not have the new PATH yet.
  function gcloudCommands() {
    const found = ['gcloud'];
    if (process.platform === 'win32' && env.LOCALAPPDATA) found.push(`${env.LOCALAPPDATA}\\Google\\Cloud SDK\\google-cloud-sdk\\bin\\gcloud.cmd`);
    return found;
  }

  // The command line is built only from the fixed words below and a path the
  // installer chose, never from request data.
  function runGcloud(command) {
    return new Promise((resolve, reject) => {
      exec(`${command} auth application-default print-access-token`, { timeout: 25_000 }, (err, stdout) => (err ? reject(err) : resolve(stdout.trim())));
    });
  }

  async function gcloudToken() {
    for (const command of gcloudCommands()) {
      try {
        const token = await runGcloud(command.includes(' ') ? `"${command}"` : command);
        if (token) return { token, seconds: 3000 };
      } catch {
        // try the next place
      }
    }
    throw new Error('Could not get a Google Cloud token. Run "gcloud auth application-default login", or set GOOGLE_APPLICATION_CREDENTIALS to a service-account key file.');
  }

  async function accessToken() {
    if (cached && cached.until - Date.now() > 120_000) return cached.token;
    pending ??= (credentialsFile ? serviceAccountToken() : gcloudToken())
      .then(({ token, seconds }) => {
        cached = { token, until: Date.now() + (seconds - 60) * 1000 };
        return token;
      })
      .finally(() => {
        pending = null;
      });
    return pending;
  }

  function target() {
    if (provider === 'vertex') {
      const host = endpoints.vertex ?? (location === 'global' ? 'https://aiplatform.googleapis.com' : `https://${location}-aiplatform.googleapis.com`);
      return { url: `${host}/v1/projects/${project}/locations/${location}/publishers/google/models/${model}:generateContent` };
    }
    if (provider === 'vertex-express') return { url: `${endpoints.express ?? 'https://aiplatform.googleapis.com'}/v1/publishers/google/models/${model}:generateContent` };
    return { url: `${endpoints.studio ?? 'https://generativelanguage.googleapis.com'}/v1beta/models/${model}:generateContent` };
  }

  // Why it cannot be used yet, or null when it is ready to try.
  function problem() {
    if (provider === 'vertex') return project ? null : 'Vertex AI needs GCP_PROJECT in .env.';
    if (provider === 'vertex-express') return key ? null : 'Vertex AI express mode needs VERTEX_API_KEY in .env.';
    if (provider !== 'aistudio') return `GEMINI_PROVIDER must be "aistudio", "vertex-express" or "vertex", not "${provider}".`;
    return key ? null : 'Gemini needs GEMINI_API_KEY in .env (or set GEMINI_PROVIDER to a Vertex AI route).';
  }

  async function generate(system, parts, { temperature = 0.2, maxTokens = 800, responseMimeType } = {}) {
    const bad = problem();
    if (bad) throw new Error(bad);
    const headers = { 'content-type': 'application/json' };
    if (provider === 'vertex') headers.authorization = `Bearer ${await accessToken()}`;
    else headers['x-goog-api-key'] = key;

    const body = JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts }],
      generationConfig: { temperature, maxOutputTokens: maxTokens + REASONING_HEADROOM, ...(responseMimeType ? { responseMimeType } : {}) },
    });
    let r;
    for (let attempt = 0; ; attempt++) {
      r = await fetchImpl(target().url, { method: 'POST', headers, body, signal: AbortSignal.timeout(45_000) });
      const passing = r.status === 429 || r.status === 500 || r.status === 503;
      if (!passing || attempt >= retryDelays.length) break;
      await r.text(); // let the connection go
      await new Promise((done) => setTimeout(done, retryDelays[attempt]));
    }
    if (!r.ok) {
      const label = provider.startsWith('vertex') ? 'Vertex AI' : 'Gemini';
      const detail = (await r.text()).replace(/\s+/g, ' ').slice(0, 240);
      throw new Error(`${label} returned ${r.status}: ${detail}`);
    }
    const out = await r.json();
    const blocked = out.promptFeedback?.blockReason;
    if (blocked) throw new Error(`Gemini declined the request (${blocked}).`);
    const text = out.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('').trim() ?? '';
    if (!text) throw new Error(`Gemini returned no text${out.candidates?.[0]?.finishReason ? ` (${out.candidates[0].finishReason})` : ''}.`);
    return text;
  }

  return {
    provider,
    model,
    problem,
    generate,
    ready: () => problem() === null,
    // Safe to show: never includes keys or the project id.
    describe: () => (provider === 'vertex' ? `Vertex AI, ${location}, ${model}` : provider === 'vertex-express' ? `Vertex AI express mode, ${model}` : `Google AI Studio, ${model}`),
  };
}
