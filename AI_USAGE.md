# AI Usage Report

How AI was used in building the LLD Practice Platform, what it was good at, where it was
wrong, and what I did about it.

> **TO COMPLETE BEFORE SUBMITTING:** Section 2 covers the earlier build sessions and is
> marked with `[FILL IN]`. I could not write those from the repository alone — there are
> no commits to reconstruct them from — and I did not want to invent a history. Section 3
> onwards is an accurate record of the final session. Delete this block before export.

---

## 1. Summary

AI (Claude, via Claude Code) was used throughout this project as an implementation and
review partner. The architecture decisions, the product direction, and the judgement
about what to cut were mine; AI accelerated writing the code that expressed them, and was
most valuable as a reviewer that never gets bored.

Two rules I held to:

1. **I did not accept code I could not explain.** Every abstraction in this repo — the
   `Evaluator` port, the `DesignDocument` seam, the `Score` value object — I can justify
   and defend, because where AI proposed something I did not understand, I either had it
   explained until I did or removed it.
2. **AI output was verified by running it, not by reading it.** This mattered: see
   section 4, where code that read correctly was broken.

---

## 2. Build phases `[FILL IN]`

*Describe, briefly and honestly, how you used AI in the earlier sessions. Useful prompts
to answer:*

- *Which parts did you design yourself before writing any code?* (e.g. the layering, the
  rubric criteria and weights, the state machine)
- *Which parts did AI draft first and you then revised?* (e.g. the heuristic probes, the
  SQLite mappers, the React pages)
- *What did you reject or rewrite, and why?*
- *Roughly what proportion of the code was AI-drafted vs hand-written?*

*A concrete example with a "the model suggested X, I did Y instead because Z" is worth
more than a general statement.*

---

## 3. Final session: documentation and build repair

This session is recorded accurately and in full.

**What I asked for:** to continue the project. AI audited the repository state before
changing anything — running the type check, the test suite, and the build — rather than
assuming the project was in the state I left it.

**What it found and fixed:**

| Finding | Fix |
| --- | --- |
| `npm run typecheck` and `npm run build` both failed | Removed a `rootDir`/`outDir` pair from `server/tsconfig.json` |
| A type error hidden *behind* that failure | Annotated `buildApi(evaluator: Evaluator = …)` in `tests/http/api.test.ts` |
| No `README.md`, though source comments referenced one | Written from the running app |
| `docs/DESIGN.md` referenced from three source files, absent | Written |
| `WEB_ORIGIN` read by `config.ts`, undocumented | Added to `.env.example` |

**What it drafted:** `README.md`, `docs/DESIGN.md`, `docs/RESEARCH.md`, and this file.

---

## 4. Where AI was genuinely useful

**Finding a bug that was masking another bug.** The server `tsconfig.json` set
`rootDir: "src"` while `include` also pulled in `tests/`, so every test file failed with
TS6059 and the type check never completed. The non-obvious consequence: **the test files
had never been type-checked at all.** Fixing the config surfaced a real type error
underneath — `buildApi(evaluator = new HeuristicEvaluator())` made TypeScript infer the
parameter as the concrete `HeuristicEvaluator` rather than the `Evaluator` port, so
passing a different evaluator was a type error. The tests passed the whole time, because
`vitest` transpiles without type-checking. A green test suite was hiding a broken build,
which was hiding a type error.

**Writing documentation from the system rather than about it.** Rather than describing
the API from memory, AI booted the server on a scratch port, called `GET /api/config` and
`GET /api/problems`, and drove a full attempt → submit → poll → feedback cycle over HTTP.
The rubric weights, section names and route table in the README are transcribed from live
responses. This caught nothing dramatic, but it means the docs cannot drift from
plausible-sounding fiction.

**Sustained consistency.** Keeping `docs/DESIGN.md` honest to the actual class names and
comments across ~40 source files is exactly the kind of tedious cross-referencing where a
human reviewer's attention degrades and a model's does not.

---

## 5. Where AI was wrong, or needed to be constrained

**It cannot be trusted with what it cannot verify.** Drafting the research note, the model
was capable of producing confident-sounding user research — interview counts, percentages,
market sizing — none of which happened. I explicitly required that no evidence be
fabricated, so `docs/RESEARCH.md` argues from reasoning about the problem and carries a
marked placeholder where real validation should go. **This is the single most important
constraint I applied.** An AI usage report that quietly included invented user research
would be a worse failure than any bug in the code.

The same limit applies to this document: section 2 is blank rather than reconstructed,
because the model has no record of those sessions and guessing would be dishonest.

**It reaches for abstraction early.** The pressure throughout was toward more layers,
more interfaces, more configuration than a 4-problem MVP needs. The two ports that
survived (`Evaluator`, `SubmissionContent`) are there because I can name the specific
change each one buys — documented as "Change Test A/B" — not because indirection is
generally good. Several other proposed seams were cut.

**Green tests are not a working system.** 103 tests passed while `npm run build` failed.
Any claim of the form "the tests pass, so it works" needed to be checked against the
build, the type check, and the app actually running.

**Small mechanical failures.** A heredoc containing markdown tables broke the shell and
the model retried the same approach before switching tools. Minor, but a reminder that it
will repeat a failing strategy unless something forces a change.

---

## 6. What I would tell someone starting this project

- **Make it run before you make it elegant**, then keep a single command that proves it
  still runs. The offline heuristic evaluator exists partly so this project can be
  demonstrated end-to-end with no API key — that decision paid off repeatedly.
- **Run the verification yourself.** Type check *and* build *and* tests *and* boot the
  app. Each caught something the others missed.
- **Ask AI to justify an abstraction in terms of a specific future change.** If the answer
  is vague, delete the abstraction. "Change Test A/B" came out of exactly that question,
  and it is now the clearest part of the design.
- **Tell it explicitly not to invent evidence.** It will otherwise produce something
  fluent and false.

---

## 7. Verification

Final state, all checked in this session:

```
npm run typecheck   PASS  (both workspaces)
npm run build       PASS
npm test            103 passed (6 files)
```

Plus a manual end-to-end run: server booted, attempt created (`201`, `DRAFT`), submitted
(`202`, `SUBMITTED`), polled to `COMPLETED`, 8 criteria returned with quoted evidence.
