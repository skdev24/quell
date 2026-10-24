#!/usr/bin/env node
// Overnight feed for Mubit's reviewer.
//
// Mubit's reviewer reads a limited number of new calls per task per day (200 in
// our project's settings), and the count resets at 00:00 UTC. This script waits
// for the reset, then sends fresh, unique, labelled chat messages through the
// exact moderation task the app uses (same model, prompt and output schema), so
// the day's review budget goes on good examples instead of whatever chat
// happens to be running.
//
// It needs the API to have been built (`pnpm --filter @quell/api build`), but not
// running. Usage:
//   node scripts/feed.mjs                  # wait for the next 00:02 UTC, send 230
//   node scripts/feed.mjs --now --count=3  # send now (for a quick check)
//   node scripts/feed.mjs --dry-run        # generate and build calls, send nothing
import { createRequire } from 'node:module';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const dist = join(here, '..', 'dist');
if (!existsSync(join(dist, 'moderation', 'frozen.js'))) {
  console.error('Build the API first: pnpm --filter @quell/api build');
  process.exit(1);
}

// The same task definition and helpers the app uses, so calls land in the same Mubit task.
const { config } = require(join(dist, 'core', 'config.js'));
const { SYSTEM_PROMPT, RESPONSE_FORMAT, TASK_MODEL, TASK_FINGERPRINT } = require(join(dist, 'moderation', 'frozen.js'));
const { prescan } = require(join(dist, 'moderation', 'prescan.js'));
const { COMMUNITY, CHANNEL } = require(join(dist, 'core', 'community.js'));
const { PERSONAS } = require(join(dist, 'swarm', 'personas.js'));

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);
const COUNT = Number(args.count ?? 230);
const RATE = Number(args.rate ?? 2); // calls started per second
const CONCURRENCY = 4;
const BATCH = 12;
const UNRECORDED = { 'x-middleware-record': 'off' };

const log = (...a) => console.log(new Date().toISOString(), ...a);

async function chat(body, headers = {}) {
  const res = await fetch(`${config.mubitBase}/openai/v1/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${config.mubitKey}`, 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${res.status} ${json?.error?.code ?? ''} ${json?.error?.message ?? ''}`.trim());
  return json;
}

const normalise = (t) => t.toLowerCase().replace(/\s+/g, ' ').trim();

/** Everything already sent or held out, so nothing is repeated or leaks into the benchmark. */
function seenTexts() {
  const seen = new Set();
  const dbPath = join(config.dataDir, 'quell.db');
  if (existsSync(dbPath)) {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    for (const r of db.prepare('SELECT json FROM messages').all()) seen.add(normalise(JSON.parse(r.json).text));
    db.close();
  }
  const evalPath = join(config.dataDir, 'evalset.json');
  if (existsSync(evalPath)) for (const m of JSON.parse(readFileSync(evalPath, 'utf8'))) seen.add(normalise(m.text));
  const feedLog = join(config.dataDir, 'feed-sent.json');
  if (existsSync(feedLog)) for (const t of JSON.parse(readFileSync(feedLog, 'utf8'))) seen.add(normalise(t));
  return seen;
}

function currentRules() {
  const dbPath = join(config.dataDir, 'quell.db');
  if (!existsSync(dbPath)) return [];
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const rules = db.prepare('SELECT json FROM rules ORDER BY created_at').all().map((r) => JSON.parse(r.json).text);
  db.close();
  return rules.slice(-40);
}

// The generator model refuses to write messages that expose someone's details,
// even invented ones, so doxxing examples are built from templates with details
// that are fictional by design: Ofcom's drama-reserved 07700 900xxx numbers,
// example.com emails and made-up streets.
const DOX_TEMPLATES = [
  (n, d) => `lol ${n} lives at ${d.address}, someone go knock`,
  (n, d) => `if you want to yell at ${n} his number is ${d.phone}`,
  (n, d) => `${n}'s personal email is ${d.email}, spam him all you want`,
  (n, d) => `found ${n}'s house: ${d.address}. not hard tbh`,
  (n, d) => `text ${n} at ${d.phone} and tell him the deploy is broken again`,
  (n, d) => `${n} keeps ignoring PRs, his email is ${d.email} and he's at ${d.address}`,
];
const DOX_NAMES = ['devon', 'tobi', 'marco', 'lena', 'raj', 'priya', 'jules', 'kofi', 'ana', 'sam'];
const STREETS = ['Larch Close', 'Mill Road', 'Elm Avenue', 'Quarry Lane', 'Harbour Way', 'Birch Drive'];

function doxxing(n, seen) {
  const out = [];
  for (let i = 0; out.length < n && i < n * 20; i++) {
    const name = DOX_NAMES[Math.floor(Math.random() * DOX_NAMES.length)];
    const d = {
      phone: `07700 900${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}`,
      email: `${name}.${Math.floor(Math.random() * 90 + 10)}@example.com`,
      address: `${Math.floor(Math.random() * 200 + 1)} ${STREETS[Math.floor(Math.random() * STREETS.length)]}`,
    };
    const text = DOX_TEMPLATES[Math.floor(Math.random() * DOX_TEMPLATES.length)](name, d);
    if (seen.has(normalise(text))) continue;
    seen.add(normalise(text));
    out.push(text);
  }
  return out;
}

/** Fresh messages for each persona in proportion to its weight. */
async function generate(seen) {
  const total = PERSONAS.reduce((s, p) => s + p.weight, 0);
  const pool = [];
  for (const p of PERSONAS) {
    const want = Math.max(4, Math.round((COUNT * p.weight) / total));
    const got = [];
    if (p.id === 'doxxer') {
      const authors = ['loose_lips', 'tea_spiller', 'snitch_dev', 'grudge_ops'];
      for (const text of doxxing(want, seen)) {
        got.push({ author: authors[got.length % authors.length], text, persona: p.id, expected: p.expected });
      }
    }
    for (let attempt = 0; attempt < 6 && got.length < want; attempt++) {
      const avoid = got.slice(-15).map((m) => `- ${m.text}`).join('\n');
      const res = await chat(
        {
          model: config.swarmModel,
          temperature: 1.1,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content:
                `You write realistic live-chat messages for a Discord server: ${COMMUNITY.about} ` +
                'Return JSON: {"messages":[{"author":"username","text":"message"}]}. Every message must be clearly different ' +
                '(wording, length 3 to 40 words, tone, typos, emoji). Usernames are short, lowercase and varied. ' +
                'Never use slurs. Any personal details must be invented.',
            },
            {
              role: 'user',
              content: `Write ${BATCH} messages from ${p.brief}` + (avoid ? `\nDo not repeat or paraphrase:\n${avoid}` : ''),
            },
          ],
        },
        UNRECORDED,
      );
      // A refusal has no content; treat it as an empty batch.
      const parsed = JSON.parse(res.choices?.[0]?.message?.content || '{}');
      for (const m of parsed.messages ?? []) {
        const text = String(m.text ?? '').trim().slice(0, 300);
        if (!text || seen.has(normalise(text))) continue;
        seen.add(normalise(text));
        got.push({ author: String(m.author ?? p.authors[0]).trim() || p.authors[0], text, persona: p.id, expected: p.expected });
      }
    }
    pool.push(...got.slice(0, want));
    log(`generated ${Math.min(got.length, want)} × ${p.id}`);
  }
  // Interleave personas so each call's "recent" context looks like real chat.
  return pool.sort(() => Math.random() - 0.5).slice(0, COUNT);
}

/** Exactly the request the app's moderation service sends. */
function request(m, recent, rules) {
  const payload = {
    community: COMMUNITY,
    channel: CHANNEL,
    author: { name: m.author, new_account: m.persona === 'raider' || m.persona === 'scammer' },
    recent,
    message: m.text,
    detected: prescan(m.text),
    community_rules: rules,
  };
  return {
    model: TASK_MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: JSON.stringify(payload) },
    ],
    response_format: RESPONSE_FORMAT,
    reasoning_effort: 'none',
  };
}

async function waitForReset() {
  if (args.now || args['dry-run']) return;
  const target = new Date();
  target.setUTCHours(0, 2, 0, 0);
  if (target <= new Date()) target.setUTCDate(target.getUTCDate() + 1);
  log(`waiting for Mubit's daily reset: sending at ${target.toISOString()} (${target.toLocaleString()} local)`);
  while (Date.now() < target.getTime()) {
    await new Promise((r) => setTimeout(r, Math.min(60_000, target.getTime() - Date.now())));
  }
}

async function main() {
  log(`task ${TASK_MODEL} · fingerprint ${TASK_FINGERPRINT} · ${COUNT} calls at ${RATE}/s`);
  await waitForReset();
  const rules = currentRules();
  log(`${rules.length} community rules in force`);
  const pool = await generate(seenTexts());
  log(`${pool.length} unique messages ready`);

  if (args['dry-run']) {
    console.log(JSON.stringify(request(pool[0], [], rules), null, 2).slice(0, 1500));
    log('dry run: nothing sent');
    return;
  }

  let sent = 0;
  let failed = 0;
  let agree = 0;
  const texts = [];
  let next = 0;
  const worker = async () => {
    while (next < pool.length) {
      const i = next++;
      const m = pool[i];
      const recent = pool.slice(Math.max(0, i - 3), i).map((r) => `${r.author}: ${r.text}`);
      await new Promise((r) => setTimeout(r, (i / RATE) * 1000 - (Date.now() - started)));
      try {
        const res = await chat(request(m, recent, rules));
        const decision = JSON.parse(res.choices?.[0]?.message?.content ?? '{}');
        if (decision.action === m.expected.action) agree++;
        sent++;
        texts.push(m.text);
      } catch (e) {
        failed++;
        log(`call failed: ${e.message}`);
      }
      if ((sent + failed) % 25 === 0) log(`${sent + failed}/${pool.length} (${failed} failed)`);
    }
  };
  const started = Date.now();
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const feedLog = join(config.dataDir, 'feed-sent.json');
  const previous = existsSync(feedLog) ? JSON.parse(readFileSync(feedLog, 'utf8')) : [];
  writeFileSync(feedLog, JSON.stringify([...previous, ...texts]));
  log(`done: ${sent} recorded calls sent, ${failed} failed, ${sent ? Math.round((agree / sent) * 100) : 0}% matched the community's labels`);
}

main().catch((e) => {
  log(`feed failed: ${e.message}`);
  process.exit(1);
});
