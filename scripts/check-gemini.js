// Checks that Gemini works with the settings in .env, and says which route it
// used. Usage: node scripts/check-gemini.js
// It sends one tiny request. It never prints keys or the project id.

import { createGemini } from '../src/server/gemini.js';

try {
  process.loadEnvFile();
} catch {
  // no .env: environment variables already set are used
}

const gemini = createGemini();
console.log(`Using: ${gemini.describe()}`);
const bad = gemini.problem();
if (bad) {
  console.log(`Not ready: ${bad}`);
  process.exitCode = 1;
} else {
  try {
    const text = await gemini.generate('Reply with the single word OK.', [{ text: 'Check.' }], { temperature: 0, maxTokens: 20 });
    console.log(`Gemini answered: ${text}`);
  } catch (err) {
    console.log(`Failed: ${err.message}`);
    process.exitCode = 1;
  }
}
