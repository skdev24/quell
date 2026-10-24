<p align="center">
  <img src="docs/images/hero.png" alt="Quell: live-chat moderation that learns your community" width="100%" />
</p>

# Quell

**Live-chat moderation that learns your community from every correction.** Built on
[Mubit](https://mubit.ai) for Night Shift London.

Generic AI moderation doesn't know a community's house rules. It allows ticket touts and
job spam in one server and blocks harmless in-jokes in another. Moderators end up fixing
the same mistakes every stream. Quell turns each of those fixes into a rule that applies
immediately, and into training data for an open model of the community's own, trained and
served by Mubit.

<p align="center">
  <img src="docs/images/how-it-works.png" alt="How Quell works: chat, Mubit, moderator correction, rule and replay, your own model" width="100%" />
</p>

## What it looks like

### The Mod View

Twitch-style moderator console: the **AutoMod queue** of what needs a human, the **channel
and model** in the middle, and **live chat** on the right with mod actions on hover.

<img src="docs/images/mod-view.png" alt="Quell Mod View" width="100%" />

### Correcting a mistake

A generic model can't know Shipyard bans selling in chat, so it allowed *"selling 2 spare
ShipyardConf tickets"*. The moderator hovers the line, picks **Remove**, edits the rule and
clicks **Teach the model**. The rule applies at once, and similar messages are re-judged
through Mubit as corrected training examples.

<table>
  <tr>
    <td width="50%"><img src="docs/images/correction.png" alt="Correcting a message in the AutoMod queue" /></td>
    <td width="50%"><img src="docs/images/model-panel.png" alt="Model panel: workload, agreement, benchmark" /></td>
  </tr>
  <tr>
    <td><sub>Correct to <b>removed</b>, with the rule the model will learn.</sub></td>
    <td><sub>How much chat needs no moderator, agreement with your mods, and the held-out benchmark.</sub></td>
  </tr>
</table>

### The viewer side

Viewers join from a QR code (**Scan to chat**) on their phones. Like Twitch AutoMod, held
and removed messages never reach other viewers; the sender is told what happened.

<table>
  <tr>
    <td width="33%"><img src="docs/images/join-phone.png" alt="Join screen with username and chat rules" /></td>
    <td width="33%"><img src="docs/images/viewer-phone.png" alt="Viewer chat on a phone, with a removed scam message" /></td>
    <td width="34%"><img src="docs/images/viewer-desktop.png" alt="Viewer page on a wide screen" /></td>
  </tr>
  <tr>
    <td><sub>Pick a username, read the house rules.</sub></td>
    <td><sub>A scam from this viewer: removed, and only they can see why.</sub></td>
    <td><sub>Wide screens get the player-and-chat layout.</sub></td>
  </tr>
</table>

## Results

Measured in this repo's test runs. The benchmark uses 114 held-out messages with known
correct answers, scored through Mubit with recording off, so it never trains the task.

| Setup | Agrees with mods | Scams caught | Typical latency | Cost / 1,000 msgs |
|---|---|---|---|---|
| GPT (`gpt-6-luna`), before corrections | 83% | 14/14 | 1.27 s | — |
| **GPT + 4 moderator corrections** | **90%** | 14/14 | 1.22 s | — |
| Open Qwen3 (`qwen3-30b-a3b-instruct-2507`), untrained | 79% | 8/14 | 2.48 s | $0.055 |
| Your Mubit adapter (Qwen3 trained on your corrections) | serves automatically once it passes Mubit's tests | | | |

- **~90% of chat handled with no moderator** (allowed, redacted, or removed with high confidence).
- **House-rule breaks:** a generic model allowed 4/4 in every run; after one correction each, new look-alikes came out right 4/4.
- **Raids:** a 120-message raid costs about 2 model calls; copies are answered from a duplicate cache.
- **Throughput:** 300 concurrent calls through Mubit with no rate-limit errors.

## How it uses Mubit

| | Where | What it does |
|---|---|---|
| One frozen task | `apps/api/src/moderation/frozen.ts` | Model, system prompt and JSON schema define the Mubit task. They're fingerprinted, and the API refuses to start if they change, because that would start a new task and reset its examples. |
| Every call through Mubit | `apps/api/src/core/mubit.service.ts` | OpenAI SDK pointed at `https://api.mubit.ai/openai/v1`; OpenRouter models via `/compat/openrouter/v1`. |
| Corrections → examples | `apps/api/src/moderation/corrections.service.ts` | Correction → rule → embeddings find similar messages → re-judged as recorded calls, which Mubit keeps as training examples. |
| Clean training data | `moderation.service.ts`, `swarm/` | Raid copies hit a cache instead of the model; generation, embeddings and benchmark calls carry `x-middleware-record: off`, so only real moderation calls train. |
| Feeding the reviewer | `apps/api/scripts/feed.mjs` | Mubit's reviewer reads ~200 new calls per task per day (reset 00:00 UTC). This sends fresh, unique, labelled calls right after the reset. |

## Run it

```bash
pnpm install
cp apps/api/.env.example apps/api/.env   # then set MUBIT_API_KEY
pnpm dev                                  # API on :4000, web on :3100
```

- Mod View: http://localhost:3100
- Viewer page (phones on the same Wi-Fi): **Scan to chat** in the top bar, or `http://<laptop-ip>:3100/join`
- Clean slate: **Demo → Reset demo** (keeps the Mubit task lock)

### Two-minute demo

Everything is on the **Demo** menu, starting from **Reset demo**:

1. **Go live.** Chat runs at 2 messages a second.
2. **Post the mistakes.** Troll bait, ticket selling, recruiting and self-promo break house rules the model can't know.
3. **Correct each one** from the chat (hover → action → edit rule → **Teach the model**).
4. **Post look-alikes.** New messages of the same kinds now come out right.
5. **Scam wave**, then **Raid**.
6. **Benchmark → Run again**, then the Mubit console for the task and its kept examples.

### Feed Mubit's reviewer overnight

```bash
pnpm --filter @quell/api build
cd apps/api && nohup caffeinate -is node scripts/feed.mjs --count=230 > data/feed.log 2>&1 &
```

`--now` sends immediately, `--dry-run` builds the calls without sending.

### Regenerate these images

With the app running: `node scripts/screenshots.mjs`. It stages a session through the
Demo API, captures the screens with your installed Chrome, and renders `docs/showcase/*.html`.

## Repo map

| Path | What |
|---|---|
| `apps/api` | NestJS API: moderation worker pool, corrections, swarm, metrics, benchmark, live stream (SSE), SQLite via `node:sqlite` |
| `apps/web` | Next.js 15 + Tailwind v4 + Motion: Mod View (`/`) and viewer page (`/join`) |
| `packages/shared` | Types shared by both |
| `research` | Notes and probes from mapping Mubit's API and console |
| `docs` | README images and the pages that render them |
