# LLD Practice Platform

Practice Low-Level Design the way it is actually assessed: attempt a problem, write a
structured design, get criterion-by-criterion feedback that cites your own words, then
try again and see whether you moved.

Most interview-prep tools grade code. Design has no test suite to run against, so the
hard part is making feedback *explainable* — every score here points at the sentences it
came from, and the rubric is public before you write a word.

---

## Quick start

Requires **Node >= 22.5** (the server uses the built-in `node:sqlite`, so there is no
native module to compile and no ORM codegen step).

```bash
npm install
npm run dev
```

- Web app → http://localhost:5173
- API → http://localhost:4000

**No API key is needed.** With no `.env` at all the platform runs the entire loop using
the deterministic heuristic evaluator, so a reviewer can clone and demo it offline. To
use a real model instead, copy `.env.example` to `.env` and set one key:

```bash
cp .env.example .env
# then set ANTHROPIC_API_KEY=... (or OPENAI_API_KEY=...)
```

The running app tells you which evaluator it chose and why — see `GET /api/config`, and
the banner in the UI.

### Other commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Server + web together, with reload |
| `npm test` | 105 tests (domain, application, evaluators, HTTP) |
| `npm run typecheck` | Type checks both workspaces |
| `npm run build` | Type check + production web bundle |
| `npm run seed` | Writes the built-in problems into the database |
| `npm start` | Server only |

---

## The loop

```
Pick a problem  →  Write the design  →  Structural check  →  Submit
                          ↑                                    │
                          │                                    ▼
                   Attempt N+1  ←──  Read feedback  ←──  Scored against the rubric
```

An attempt moves through an explicit state machine
([AttemptStatus.ts](server/src/domain/attempt/AttemptStatus.ts)):

```
DRAFT ──submit──▶ SUBMITTED ──start──▶ EVALUATING ──▶ COMPLETED (terminal)
                       ▲                     │
                       │                     └──▶ FAILED
                       └──── resubmit ───────────┘
                                          └── retry ──▶ EVALUATING
```

`COMPLETED` is terminal on purpose. "Try again" creates attempt N+1 rather than
overwriting attempt N — that is what makes the progress comparison honest. A `FAILED`
evaluation (model timeout, provider down) keeps your submission and offers a retry, so a
flaky provider never costs you work.

### Two gates, deliberately separated

1. **Structural check** — deterministic, instant, free. Are the required sections
   present and substantial enough to judge? Runs before anything is sent anywhere
   (`POST /api/attempts/:id/structural-check`). A submission that cannot be evaluated is
   rejected with `422` and a list of exactly which checks failed.
2. **Judgement** — the rubric scoring. This is the only part an LLM ever touches.

Keeping these apart means the expensive, non-deterministic step is never asked to do a
job that a string length check can do, and the error messages stay specific.

---

## What you submit

Ten sections, nine required ([SubmissionSchema.ts](server/src/domain/submission/SubmissionSchema.ts)):

`requirements` · `assumptions` · `classes` · `responsibilities` · `relationships` ·
`interfaces` · `patterns` *(optional)* · `flows` · `edge_cases` · `tradeoffs`

Structured text rather than a freeform essay or a diagram tool: it is enough structure to
attribute feedback to a section, without asking someone to learn a modelling notation
during a 35-minute exercise.

## How it is scored

Eight weighted criteria ([Rubric.ts](server/src/domain/evaluation/Rubric.ts)), published
to the UI before you start:

| Criterion | Weight |
| --- | --- |
| Requirement understanding | 1.0 |
| Class responsibilities | 1.4 |
| Coupling and cohesion | 1.2 |
| Encapsulation and interfaces | 1.1 |
| Abstraction and patterns | 1.0 |
| Extensibility | 1.2 |
| Edge cases and testability | 1.1 |
| Quality of explanation | 1.0 |

Class responsibilities carries the most weight because it is the thing LLD interviews
actually turn on. Each criterion returns a score, a band, **evidence quoted from your
submission**, and what would raise it — never a bare number.

## Problems

| Problem | Difficulty | Time |
| --- | --- | --- |
| Parking Lot | Starter | 35 min |
| Vending Machine | Starter | 30 min |
| Elevator System | Core | 40 min |
| Movie Ticket Booking | Advanced | 45 min |

---

## Architecture

```
server/src/
  domain/          Attempt, Submission, Evaluation, Rubric — no framework imports
  application/     PracticeService, EvaluationCoordinator — orchestration
  evaluators/      heuristic/ (offline, deterministic) · llm/ (Anthropic, OpenAI)
  infrastructure/  SQLite, config, problem content
  interfaces/http/ Express routes + DTOs
  composition-root.ts   the one file that picks concrete implementations
web/src/
  pages/           Library · Problem detail · Workspace/Attempt · History
  api/             typed client
```

Dependencies point inwards. `domain/` imports nothing from Express, SQLite or any model
provider, which is why the whole application can be wired against in-memory repositories
in tests without a single mock of the business rules.

**The evaluator is a port.** `Evaluator` is an interface with `supports()` and
`evaluate()`; `HeuristicEvaluator` and `LlmEvaluator` are two implementations, and
[composition-root.ts](server/src/composition-root.ts) is the only file that knows which
one is live. Adding a rule-based or human evaluator means adding it there — nothing in
`domain/` or `application/` changes, because nothing there names an evaluator.

That decision is also what makes the offline demo possible, and it is what makes the
tests fast: 103 tests run in ~1.3s because the state machine, structural rules,
coordinator and progress calculation under test are the production ones, with only the
clock, ids and evaluator substituted.

### Notable choices

- **`node:sqlite` over better-sqlite3/Prisma** — no native build step, no codegen, so
  `npm install && npm run dev` works on a clean machine. Cost: a Node >= 22.5 floor.
- **Evaluation runs in the background.** `POST /submission` returns `202` immediately and
  the client polls. Nothing holds an HTTP connection open for a model call, and
  `LLM_TIMEOUT_MS` bounds it.
- **No accounts.** A learner id is generated into `localStorage` and sent as
  `x-learner-id`. Enough to make attempt history real without building auth the product
  does not need yet.
- **Weights and rubric live in the domain**, not in a prompt, so the heuristic and LLM
  evaluators are scored against the same definition.

---

## API

All learner-scoped routes take an `x-learner-id` header.

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Liveness + pending evaluation count |
| `GET` | `/api/config` | Active evaluator, rubric, submission schema |
| `GET` | `/api/problems` | Library, with per-learner stats |
| `GET` | `/api/problems/:id` | Full problem definition |
| `POST` | `/api/attempts` | Start an attempt (`200` + `resumed` if a draft is open) |
| `GET` | `/api/attempts` | Attempt history |
| `GET` | `/api/attempts/:id` | One attempt with status and failure info |
| `PATCH` | `/api/attempts/:id/draft` | Save draft sections |
| `POST` | `/api/attempts/:id/structural-check` | Deterministic pre-flight |
| `POST` | `/api/attempts/:id/submission` | Submit → `202` (`200` if already submitted) |
| `GET` | `/api/attempts/:id/evaluation` | Scored feedback once complete |
| `POST` | `/api/attempts/:id/evaluation/retry` | Re-run a failed evaluation |

---

## Configuration

Every value is optional; see [.env.example](.env.example).

| Variable | Default | Notes |
| --- | --- | --- |
| `EVALUATOR` | `auto` | `auto`, `heuristic` or `llm`. `llm` fails at startup if no key |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | – | Provide one to enable real evaluation |
| `ANTHROPIC_MODEL` | `claude-sonnet-5` | |
| `OPENAI_MODEL` | `gpt-4o-mini` | |
| `LLM_TIMEOUT_MS` | `60000` | Then the attempt is `FAILED` and retryable |
| `PORT` | `4000` | |
| `DATABASE_PATH` | `data/lld-practice.db` | `:memory:` is supported |
| `PERSISTENCE` | `sqlite` | `memory` runs the same app on the in-memory repositories |
| `AWAIT_EVALUATIONS` | on when `VERCEL` is set | Finish the evaluation before answering the submit request |
| `DEMO_EVALUATION_DELAY_MS` | `1200` | Makes the status transitions visible when demoing |
| `WEB_ORIGIN` | `http://localhost:5173` | CORS origin for the API |

`EVALUATOR=llm` refuses to boot without a key rather than silently degrading — a demo
that quietly stops using the model is worse than one that will not start.

---

## Deployment (Vercel)

One Vercel project serves both halves from one origin: the Vite build is the static
output, and the whole Express app runs behind a single serverless function at
[api/index.ts](api/index.ts), routed there by the `/api/(.*)` rewrite in
[vercel.json](vercel.json). No CORS, no API base URL.

Project settings that matter — **Root Directory must be the repository root**, not `web/`;
everything else (install, build, output, function limits) comes from `vercel.json`.

Environment variables to set:

| Variable | Value | Why |
| --- | --- | --- |
| `PERSISTENCE` | `sqlite` | Real adapter; falls back to memory if `node:sqlite` is missing |
| `DATABASE_PATH` | `/tmp/lld.db` | The only writable path a function has, private to one instance |
| `AWAIT_EVALUATIONS` | `true` | Implied by `VERCEL`; explicit so the environment reads honestly |
| `EVALUATOR` | `llm` or `auto` | |
| `ANTHROPIC_API_KEY` | your key | Set `ANTHROPIC_BASE_URL` too if the key is for a proxy |
| `LLM_TIMEOUT_MS` | `45000` | Must stay under the function's 60s `maxDuration` |
| `DEMO_EVALUATION_DELAY_MS` | `0` | No artificial delay in production |

`GET /api/health` reports which persistence adapter is live and whether evaluations are
being awaited, so the deployed shape is checkable without shell access.

**What the serverless host costs, stated plainly.** Two host constraints are handled as
configuration rather than as a second code path, and neither is free:

- *Evaluations are awaited.* The instance is frozen the moment it responds, so work
  started after the response never finishes. `AWAIT_EVALUATIONS` makes the submit request
  wait for the evaluator; the client's contract is unchanged, its first poll simply
  already sees `COMPLETED`. An evaluation slower than `maxDuration` is lost rather than
  retryable.
- *Attempt state is per-instance.* The problem catalogue is seeded from code, so it is
  complete everywhere, but `/tmp` belongs to one instance and is gone when that instance
  is recycled. A learner whose next request lands on a fresh instance sees that attempt
  gone. History is therefore a demo of the feature, not a durable record.

Both disappear on a long-running host: `npm start` with the default `PERSISTENCE=sqlite`
gives durable attempts and background evaluation, which is what the application was
designed for. Making them disappear on Vercel means a hosted database behind the existing
`AttemptRepository` / `EvaluationRepository` ports — a new adapter in
[composition-root.ts](server/src/composition-root.ts), and nothing above it.

---

## Tests

```bash
npm test
```

| Suite | Covers |
| --- | --- |
| `domain/` | State machine transitions, structural rules, scoring |
| `application/` | Full practice flow against in-memory repositories |
| `evaluators/` | Heuristic probes, verdict parsing, timeout and failure paths |
| `http/` | Real routes over real SQLite mappers (in-memory), including `422` and retry |
