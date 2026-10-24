# Quell

Live-chat moderation that learns your community from every correction.

Every message in the channel is judged by one fixed moderation task routed through
[Mubit](https://mubit.ai). When a moderator corrects a call, the correction becomes a
community rule, and the corrected message plus similar recent ones are re-judged with
that rule. Mubit records those re-judged calls as kept examples, and trains a Qwen3
adapter on them that takes over the task once it passes its tests.

## Run it

```bash
pnpm install
cp apps/api/.env.example apps/api/.env   # then set MUBIT_API_KEY
pnpm dev                                  # API on :4000, web on :3100
```

- Console: http://localhost:3100
- Crowd page (phones on the same Wi-Fi): `http://<laptop-ip>:3100/join`
- Clean slate before a demo: `pnpm reset` (keeps `apps/api/data/task.lock`)

## Feeding Mubit's reviewer

Mubit's reviewer reads a limited number of new calls per task per day (200 in this
project's settings), resetting at 00:00 UTC. `scripts/feed.mjs` spends that budget on
good examples: it waits for the reset, then sends fresh, unique, labelled messages
through the exact same task (it imports the compiled `frozen.ts`, so the fingerprint
matches), never repeating anything already sent or anything in the held-out benchmark set.

```bash
pnpm --filter @quell/api build
cd apps/api && nohup caffeinate -is node scripts/feed.mjs --count=230 > data/feed.log 2>&1 &
```

`--now` sends immediately, `--dry-run` builds the calls without sending.

## How it fits together

| Part | Where | Notes |
|---|---|---|
| Moderation task | `apps/api/src/moderation/frozen.ts` | Model, system prompt and JSON schema define the Mubit task. They are fingerprinted; the API refuses to start if they change, because that would start a new task and reset its examples. |
| Worker pool | `moderation.service.ts` | One message = one recorded call. `MOD_CONCURRENCY` bounds bursts. A regex safety net always redacts personal information. |
| Corrections | `corrections.service.ts` | Correction → rule → embeddings find similar messages → re-judged as recorded calls (training examples). |
| Swarm | `apps/api/src/swarm` | Personas with ground-truth labels play the community. A generator model tops up their messages; those calls carry `x-middleware-record: off` so they never train. |
| Metrics | `metrics.service.ts` | Agreement with the community's real norms, wrongly blocked, scams caught, personal info hidden, latency. |
| Web | `apps/web` | Next.js 15, Tailwind v4, Motion. Live over server-sent events. |

## Two-minute demo

Everything is on the **Demo** menu in the top bar. Start from **Reset demo**.

1. **Go live.** Chat runs at 2 messages a second.
2. **Post the mistakes.** Four messages break Shipyard's house rules (troll bait, selling tickets, recruiting, self-promo). A generic model can't know those rules, and allows all four (4/4 in every test run).
3. Correct each one: hover the chat line, pick the action, edit the rule, **Teach the model**.
4. **Post look-alikes.** Four new messages of the same kinds now come out right (4/4 in testing).
5. **Scam wave** and **Raid** (150 messages cleared in seconds; copies are answered from the duplicate cache).
6. **Benchmark → Run again** for the held-out numbers, then the Mubit console for the task and its kept examples.

**Scan to chat** shows a QR code for the phone page at the laptop's network address, so judges can post into chat. Phones must be on the same Wi-Fi.
