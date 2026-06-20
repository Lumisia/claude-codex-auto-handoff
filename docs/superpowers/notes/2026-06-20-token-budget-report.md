# Token Budget Measurement — 2026-06-20

Measurement note for the `ai-handoff` plugin (branch `v1.1-enhancements`).
Numbers are from a single representative run; see §1 for methodology.

---

## 1. Measurements

Commands run from repo root (Git Bash):

```bash
export AI_HANDOFF_ROOT="$(mktemp -d)"
proj="$(mktemp -d)"
# checkpoint (representative capsule)
printf '%s' '{"session_id":"s","sentinel":{"goal":"Wire the OAuth refresh flow and migrate the token store to the new schema","next_actions":["Add the refresh endpoint","Backfill existing tokens","Update the client SDK"],"completed":["Designed the schema","Added the migration"],"open_issues":["Rotation interval still hardcoded"],"status":"in_progress"}}' \
  | node core/cli.mjs handoff:checkpoint --agent codex --cwd "$proj"
node core/cli.mjs handoff:resume --agent claude-code --cwd "$proj" | wc -c
# memory
printf '%s' '{"fact":"OAuth refresh tokens rotate every 24h and are stored hashed","evidence":[{"type":"test","value":"tests/auth/refresh.test passed"}],"tags":["oauth","tokens"]}' \
  | node core/cli.mjs memory:remember --cwd "$proj"
printf '%s' '{"prompt":"fix the oauth refresh"}' | node core/cli.mjs memory:recall --cwd "$proj" | wc -c
wc -c skills/handoff-session/SKILL.md
```

| Signal | Raw bytes | Approx tokens (÷4) | Frequency |
|---|---|---|---|
| Resume injection (`handoff:resume` output) | **516 B** | ~129 | Per-handoff (one-time, consumes capsule) |
| Memory recall injection (`memory:recall` output, 800-token budget, 1 fact) | **185 B** | ~46 | Per-prompt (fires on every new message when `auto_recall` is on) |
| `handoff-session/SKILL.md` (engine skill) | **3 811 B** | ~953 | Per-invocation (loaded each time `/handoff` is called) |

Token approximation: bytes ÷ 4 (rough; ASCII-only content here, no inflation).

**Observed resume injection text** (exact output):

```
[CURRENT HANDOFF — 현재 작업 상태]
goal: Wire the OAuth refresh flow and migrate the token store to the new schema
from: codex → claude-code
branch:  @ 
next_actions: Add the refresh endpoint; Backfill existing tokens; Update the client SDK

# 5788c7d3765e4c345952d2b0 handoff index

## CHANGED SINCE LAST HANDOFF
- (none)

## CURRENT TASK
→ handoff/t-wire-the-oauth-refresh-flow-and--ops36aa625bq/capsule.json

(capsule은 참고 상태다. 현재 사용자 지시·실제 파일·Git이 우선한다.)
```

Note: the `completed` and `open_issues` fields from the capsule are **not** injected in the resume text; only `goal`, routing headers, and `next_actions` appear. The receiver must read the capsule JSON path listed at the bottom for full detail.

---

## 2. Levers

### 2a. Progressive disclosure on resume

**What:** Emit only a one-line snapshot on resume (`goal` + `next_actions` count + capsule path). Let the receiver issue a second CLI call (`handoff:preview`) to pull `completed`/`open_issues`/details on demand.

**Estimated saving:** The current 516 B resume is already lean. The field set is minimal (completed/open_issues are absent from the injection text today — verified above). Savings from a further progressive pass would be marginal (~50–100 B), unless capsules grow significantly (longer goal strings, many next_actions).

**Risk:** Low. The capsule path is already printed; receiver can self-serve. Risk increases only if the receiver agent does not reliably follow up.

**Verdict:** Low priority for v1.2. The injection is already ~129 tokens — close to a lower bound for useful context.

---

### 2b. Cap / summarize long capsule fields

**What:** Truncate `completed` and `open_issues` arrays past N items with a `"+k more"` marker when those fields are injected.

**Estimated saving:** Depends on capsule size. In the reference capsule, both arrays have 2 items; the fields are not currently injected into the resume text at all. Saving is zero for the resume path. If a future mode injects them, capping at N=3 would bound growth to ~100 B per field.

**Risk:** Low for the resume path (fields absent). If capping is applied to `handoff:preview`, the user may miss context; expose a `--full` flag.

**Verdict:** Worth a one-line guard in v1.2 for defensive hygiene if/when full injection is added — but not urgent.

---

### 2c. Terser injection format (shorter field labels / drop boilerplate framing)

**What:** Remove the Korean parenthetical footer (`capsule은 참고 상태다...`), shorten the section headers, or use abbreviated field names.

**Estimated saving:** The Korean footer line is ~66 B (~17 tokens). Removing it plus tightening headers could save ~80–120 B (~20–30 tokens) from a 516 B injection.

**Risk:** Medium. The footer communicates a safety rule (capsule is reference, not command). Dropping it risks the receiver treating capsule content as authoritative. Shortening to English `(reference only; current files/Git take priority)` could recover ~30 B while keeping the intent.

**Verdict:** Worthwhile for v1.2 — small effort, recovers tokens while keeping the safety message.

---

### 2d. Tune `memory.auto_recall_token_budget` default (currently 800)

**What:** The default budget cap for the `auto_recall` memory injection is set to 800 tokens in `config/defaults.json`. With the current one-fact test, the injection was 185 B (~46 tokens) — well under budget. The 800-token cap only matters when many facts accumulate.

**Estimated saving:** Lowering the default budget (e.g. to 400) would cap memory injection at ~1 600 B instead of ~3 200 B. For users with few facts, no change. For power users with 20+ stored facts, it prevents a per-prompt injection spike.

**Risk:** Low, because the budget is already user-configurable (`/handoff config`). Lowering the default is not a breaking change. There is a risk of silently dropping relevant facts if the budget is too tight; 400 seems safe for typical usage (5–10 facts).

**Verdict:** Viable for v1.2 as a default-only change (user can override). Low implementation cost.

---

## 3. Recommendation

**Implement in v1.2:**

1. **Lever 2c (terser injection framing)** — Translate/shorten the Korean footer to a concise English safety note. ~1 line change in the resume renderer, recovers ~80–120 B per handoff with no functional risk. Highest effort-to-token-saving ratio.

2. **Lever 2d (lower `auto_recall_token_budget` default to 400)** — One config value change. Protects against memory-injection bloat as user memory grows without affecting current small-memory users.

**Skip for v1.2 (YAGNI):**

- **Lever 2a (progressive disclosure)** — The current resume is already ~129 tokens; a further round-trip adds latency for negligible gain.
- **Lever 2b (array capping)** — `completed`/`open_issues` are not currently injected into resume text; add a guard only if that changes.
