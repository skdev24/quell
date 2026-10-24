<p align="center">
  <img src="docs/images/hero.png" alt="Quell" width="100%" />
</p>

# Quell

Live-chat moderation that learns a community's rules from its moderators.

Generic moderation models don't know house rules: one community bans selling in chat,
another allows it; one treats "kill -9 the intern's process" as a joke, another doesn't.
Moderators end up correcting the same mistakes every stream. In Quell, each correction
becomes a rule that applies immediately and a training example for a task-specific model
trained and served through [Mubit](https://mubit.ai).

Built for Night Shift London, October 2026.

<p align="center">
  <img src="docs/images/how-it-works.png" alt="How Quell works" width="100%" />
</p>

## Screenshots

**Moderator view.** Review queue, channel and model status, and live chat with inline
moderation actions.

<img src="docs/images/mod-view.png" alt="Moderator view" width="100%" />

<table>
  <tr>
    <td width="50%"><img src="docs/images/correction.png" alt="Correcting a decision" /></td>
    <td width="50%"><img src="docs/images/model-panel.png" alt="Model panel" /></td>
  </tr>
  <tr>
    <td><sub>Correcting a decision. The model allowed a ticket sale; the moderator removes it and edits the rule it will learn.</sub></td>
    <td><sub>Share of chat handled without a moderator, agreement with moderators, and the held-out benchmark.</sub></td>
  </tr>
</table>

**Viewer page.** Opened from a QR code. Held and removed messages are hidden from other
viewers; the sender sees what happened.

<table>
  <tr>
    <td width="33%"><img src="docs/images/join-phone.png" alt="Join screen" /></td>
    <td width="33%"><img src="docs/images/viewer-phone.png" alt="Chat on a phone" /></td>
    <td width="34%"><img src="docs/images/viewer-desktop.png" alt="Viewer page on desktop" /></td>
  </tr>
</table>

## How it works

1. Every chat message is judged by a single moderation task: fixed model, system prompt and
   JSON output schema (`allow`, `flag`, `remove` or `redact`, with a reason). Calls go
   through Mubit, which records them and groups them into one task.
2. Decisions the model is unsure of go to the review queue. Allowed, redacted and
   high-confidence removals need no moderator.
3. A moderator's correction becomes a community rule, sent with every later call.
4. Messages similar to the corrected one (by embedding similarity) are judged again with the
   new rule. Mubit keeps those calls as training examples for the task.
5. Mubit trains a Qwen3 adapter on the kept examples, tests it against the provider model,
   and routes traffic to it once it passes.

Only moderation calls are recorded. Message generation, embeddings and benchmark calls are
sent with `x-middleware-record: off`, and repeated messages (such as raids) are answered from
a cache, so the training data stays unique.

## Results

Benchmark: 114 held-out messages with known correct decisions, never used for training.

| Setup | Agreement | Scams caught | p50 latency | Cost / 1k messages |
|---|---|---|---|---|
| `gpt-6-luna`, no rules | 83% | 14/14 | 1.27 s | — |
| `gpt-6-luna`, 4 moderator rules | 90% | 14/14 | 1.22 s | — |
| `qwen3-30b-a3b-instruct-2507`, untrained | 79% | 8/14 | 2.48 s | $0.055 |

Other measurements from test runs:

- 86–93% of chat handled without a moderator.
- Four messages breaking house rules (troll bait, ticket sales, recruiting, self-promotion)
  were allowed in every run before correction; new messages of the same kinds were handled
  correctly after one correction each.
- A 120-message raid required two model calls.
- 300 concurrent requests through Mubit completed without rate-limit errors.

## Architecture

| Component | Location | Notes |
|---|---|---|
| Moderation task | `apps/api/src/moderation/frozen.ts` | Model, prompt and schema are fingerprinted; the API refuses to start if they change, since that would create a new Mubit task. |
| Mubit client | `apps/api/src/core/mubit.service.ts` | OpenAI SDK with base URL `https://api.mubit.ai/openai/v1`; OpenRouter models via `/compat/openrouter/v1`. |
| Moderation queue | `apps/api/src/moderation/moderation.service.ts` | Bounded concurrency, duplicate cache, and a pattern-based check that always redacts personal details. |
| Corrections | `apps/api/src/moderation/corrections.service.ts` | Rule creation and re-judging of similar messages. |
| Benchmark | `apps/api/src/moderation/eval.service.ts` | Scores model setups on the held-out set. |
| Simulated chat | `apps/api/src/swarm` | Labelled personas used for load and for measuring agreement. |
| Web | `apps/web` | Next.js 15, Tailwind CSS 4, Motion. Updates over server-sent events. |

## Getting started

Requires Node.js 24 and pnpm 10.

```bash
pnpm install
cp apps/api/.env.example apps/api/.env   # set MUBIT_API_KEY
pnpm dev                                  # API on :4000, web on :3100
```

- Moderator view: http://localhost:3100
- Viewer page: http://localhost:3100/join (or **Scan to chat** in the top bar for a QR code)

The **Demo** menu in the top bar runs a scripted session: reset, live chat, the four
house-rule messages, follow-up messages after correction, a scam wave and a raid.

### Scripts

| Command | Purpose |
|---|---|
| `node apps/api/scripts/feed.mjs` | Sends a batch of new, labelled moderation calls after Mubit's daily review reset (00:00 UTC). |
| `node scripts/screenshots.mjs` | Regenerates the images in `docs/images` from a running instance. |

## Project structure

```
apps/api         NestJS API (moderation, corrections, benchmark, simulated chat)
apps/web         Next.js app (moderator view at /, viewer page at /join)
packages/shared  Types shared by the API and the web app
docs             README images and the pages they are rendered from
scripts          Screenshot tooling
```
