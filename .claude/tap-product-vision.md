# Tap: Meta-Harness for Interface Automation

## One Sentence

**AI searches for the best way to operate each interface, then any agent replays it forever at zero cost.**

---

## What Tap Is

Tap is a Meta-Harness system: an outer-loop that lets AI iteratively discover, evaluate, and refine interface automation strategies. The output — a "tap" — is the winning strategy from this search process.

```
Same runtime + different tap = different success rate.
A good tap turns a 30% success operation into 99%.
```

This is the Harness Engineering insight applied to interfaces: the automation strategy (tap) matters as much as the execution engine (runtime).

---

## Value Formula

```
Tap Value = Reachable Interfaces × Strategy Stability × Distribution Breadth × Replay Count
```

| Multiplier | What | Lever |
|------------|------|-------|
| Reachable Interfaces | How many apps/sites AI can operate | More runtimes (browser, macOS, Android, iOS) |
| Strategy Stability | How long before a tap breaks | Meta-Forge iterative refinement + health monitoring |
| Distribution Breadth | How many people use each tap | tap-skills repo + `tap update` |
| Replay Count | How often each tap runs | MCP makes AI the consumer → 100x human frequency |

---

## Core Architecture

```
┌──────────────────────────────────────────────────┐
│  Meta-Forge: Iterative Search Loop                │
│                                                    │
│  1. Read history (code + traces + scores)          │
│  2. Propose new tap strategy                       │
│  3. Evaluate (run on real interface, collect trace) │
│  4. Archive everything to filesystem               │
│  └─→ repeat until converged                        │
│                                                    │
│  Proposer: Coding Agent (Claude Code + Opus)       │
│  History:  Full filesystem, not compressed summary  │
│  Output:   Best tap on Pareto frontier              │
└───────────────────┬──────────────────────────────┘
                    │
┌───────────────────▼──────────────────────────────┐
│  Tap Registry                                      │
│  ~/.tap/taps/{site}/{name}.tap.js                  │
│  Each tap = winning strategy from Meta-Forge search│
│  + complete evolution history in ~/.tap/history/    │
└───────────────────┬──────────────────────────────┘
                    │ tap.run(site, name, args) → rows
┌───────────────────▼──────────────────────────────┐
│  Runtime (platform-native execution)               │
│  Browser: eval(JS) + CDP escape hatches            │
│  macOS:   eval(JXA)                                │
│  Android: eval(ADB/UIAutomator)                    │
│  iOS:     eval(XCUITest)                           │
│                                                    │
│  Executes tap + collects trace → feeds back to     │
│  Meta-Forge for next iteration                     │
└──────────────────────────────────────────────────┘
```

---

## Meta-Forge: The Search Loop

### Algorithm

```
Meta-Forge(target, tasks, runtime, N_iterations):

  // 1. Initialize
  seed ← forge_inspect(target) + generate seed tap
  D ← filesystem("~/.tap/history/{site}/{name}/")
  evaluate(seed, tasks, runtime) → store to D

  // 2. Search loop
  for t = 1...N:
    proposer reads D (grep, cat, diff — full access)
    proposer proposes new tap (based on trace analysis)
    evaluate(new_tap, tasks, runtime) → store to D

  // 3. Select best
  best ← Pareto frontier of D (success_rate vs latency)
  symlink best → ~/.tap/taps/{site}/{name}.tap.js
```

### Filesystem Structure (Complete History)

```
~/.tap/history/wechat/app-search/
├── inspect.json                      # forge_inspect results (AX tree, menus, APIs)
├── search-skill.md                   # domain-specific guidance for proposer
├── seed/
│   ├── tap.js                        # seed code
│   ├── score.json                    # { success_rate: 0.3, latency_ms: 15000 }
│   ├── reasoning.md                  # proposer's reasoning
│   └── traces/
│       ├── run-001.json              # full execution trace
│       ├── run-002.json
│       └── run-003.json
├── iter-01/
│   ├── tap.js                        # iteration 1 code
│   ├── diff.patch                    # diff from parent
│   ├── parent → ../seed              # which version it was based on
│   ├── reasoning.md                  # "seed failed at step 3 because..."
│   ├── score.json                    # { success_rate: 0.7, latency_ms: 12000 }
│   └── traces/
│       ├── run-001.json
│       ├── run-002.json
│       └── run-003.json
├── iter-02/
│   └── ...
└── best → iter-02/                   # symlink to current best
```

### Execution Trace Format

Each trace captures every operation, enabling the proposer to diagnose failures:

```json
{
  "input": { "query": "发票整理" },
  "steps": [
    { "action": "eval", "code": "Application('WeChat').activate()...",
      "duration_ms": 1200, "result": {"title":"Weixin","x":0,"y":33,"w":1512,"h":949} },
    { "action": "eval", "code": "...click search bar...",
      "duration_ms": 800, "result": null },
    { "action": "eval", "code": "...paste query...",
      "duration_ms": 1500, "result": null },
    { "action": "eval", "code": "...Enter + wait for search...",
      "duration_ms": 6000, "result": "search page loaded" },
    { "action": "eval", "code": "...Select All + Copy...",
      "duration_ms": 1300, "result": "2561 chars extracted" }
  ],
  "output": { "rows": 3, "columns": ["title","content"] },
  "total_ms": 10800,
  "success": true
}
```

Failed trace example (enables proposer to diagnose):

```json
{
  "steps": [
    { "action": "eval", "code": "...activate + getWindows...",
      "duration_ms": 1200, "result": {"title":"Weixin",...} },
    { "action": "eval", "code": "...click + paste + Enter...",
      "duration_ms": 3800, "result": null },
    { "action": "eval", "code": "...Select All + Copy...",
      "duration_ms": 500, "error": "Can't get object",
      "diagnosis": "Edit menu has no 'Select All' — search page not loaded yet" }
  ],
  "success": false,
  "failure_step": 2,
  "error": "Can't get object"
}
```

### Search Skill (Minimal Human Guidance)

The only human-provided input. Describes the search space, not the solution:

```markdown
# Search Skill: {site}/{name}

## Goal
Find the most reliable strategy to: {description}

## Filesystem
- ~/.tap/history/{site}/{name}/ — all prior versions, scores, traces
- ~/.tap/taps/{site}/{name}.tap.js — current best (you improve this)

## Runtime Capabilities
- page.eval(code) — execute platform-native code
  Browser: JavaScript in page DOM
  macOS: JXA (Application, System Events, CGEvent, clipboard)
  Android: ADB shell / UIAutomator
- page.nav(target) — navigate to URL or activate app
- page.find(query) — search UI tree for element
- page.click(target) — click element
- page.type(target, text) — type into element
- page.screenshot() — capture screen
- page.waitFor(condition) — wait for state

## Evaluation
- Run tap with 3 different inputs
- Measure: success_rate, avg_latency, result_quality
- Store complete trace (every step + result + timing + errors)

## Tap Format
export default {
  site: "{site}",
  name: "{name}",
  runtime: "extension" | "macos" | "playwright",
  app: "AppName",  // macOS only
  columns: ["col1", "col2"],
  args: { key: { type: "string", required: true } },
  health: { min_rows: 1, non_empty: ["col1"] },
  async run(page, args) { ... return rows; },
  async cleanup(page) { ... }
}

## Constraints
- You may use ANY strategy (API, DOM, AX, eval, multi-step, single-eval...)
- You may NOT modify runtime code or evaluation logic
- Prefer: API > semantic targeting > structural selector > coordinates
- Prefer: state-based waiting > fixed delays
```

---

## Tap Lifecycle

### Phase 1: forge_inspect (Discovery)

Scan target interface, return capabilities. Platform-specific but structurally uniform:

```
Browser inspect:
  { apis: [...], ssrState: {...}, framework: "React", domStructure: [...] }

macOS inspect:
  { windows: [...], menuBar: {...}, axTree: [...], appleScriptDict: [...] }

Android inspect:
  { activities: [...], uiTree: [...], services: [...] }
```

### Phase 2: Meta-Forge (Search)

Proposer iterates, guided by search skill and complete history:

```
Iteration 1: "inspect shows API endpoint. Let me try page.fetch."
  → score: 0.99 (API works, fast, stable)
  → done. No further iterations needed.

OR:

Iteration 1: "No API. Try DOM extraction with SSR state."
  → score: 0.8 (works but misses dynamic content)

Iteration 2: "trace shows dynamic content loads after 2s. Add waitFor."
  → score: 0.95

Iteration 3: "combine SSR for initial data + waitFor for dynamic.
  Also found that iter-01's selector breaks on mobile layout.
  Use aria-label instead of class name."
  → score: 0.99
```

### Phase 3: tap.run (Replay)

Zero AI. Deterministic execution of the best strategy.

```
tap.run("github", "trending") → 25 rows, 200ms
tap.run("wechat", "app-search", {query: "发票"}) → 3 rows, 11s
```

### Phase 4: Health Monitoring

Continuous validation. Degraded taps trigger re-forge:

```
tap doctor
  github/trending     ✓ 25 rows, 180ms (healthy)
  wechat/app-search   ✓ 3 rows, 11s (healthy)
  douyin/hot          ✗ 0 rows, timeout (DEGRADED → trigger re-forge)
```

### Phase 5: Re-Forge (Self-Healing)

When a tap degrades, Meta-Forge resumes from history:

```
Proposer reads ~/.tap/history/douyin/hot/:
  "iter-03 was working until 2026-04-01. Score dropped to 0.
   Trace shows: API endpoint returns 403.
   Douyin likely changed their API auth.
   Let me try the DOM extraction approach from iter-01
   (which scored 0.6) and improve it."
  → iter-04: DOM extraction + new selectors
  → score: 0.9
```

The complete history means re-forge doesn't start from zero. It builds on all prior experience.

---

## Runtime Design

### Principle: eval IS the kernel

Each platform has one primary primitive — eval in its native language. Everything else is either a convenience wrapper or a sandbox escape hatch.

```
Browser runtime:
  Core:    eval(JS in DOM)
  Escapes: pointer(CDP), keyboard(CDP), screenshot(CDP), cookies, upload
  Why escapes: browser sandbox restricts page JS

macOS runtime:
  Core:    eval(JXA)
  Escapes: none needed (JXA is unsandboxed)
  Design:  single eval per operation sequence (prevents focus switching)

Android runtime (future):
  Core:    eval(ADB shell / UIAutomator)
  Escapes: minimal (ADB has broad access)

iOS runtime (future):
  Core:    eval(XCUITest / Accessibility)
  Escapes: some (sandbox restrictions on iOS)
```

### Stdlib: AI's Vocabulary, Not Implementation Constraint

The stdlib operations (click, type, find, waitFor...) serve two purposes:

1. **AI's vocabulary during forge** — named operations AI can reason about
2. **Runtime convenience** — each runtime implements them natively

They are NOT a mandatory abstraction layer. A tap can use pure eval if that's the best strategy. The stdlib exists to help AI forge, not to constrain it.

---

## Distribution

### tap-skills Repository

Community-maintained collection of best taps:

```
tap update → git pull tap-skills → 106+ taps ready to use
```

Each tap in the repo is the BEST version from its Meta-Forge search, with history available for re-forging.

### MCP Integration

Taps are exposed as MCP tools. AI agents call them directly:

```
Claude: "Search WeChat for invoice tools"
  → tap.run("wechat", "app-search", {query: "发票整理"})
  → 3 rows of structured results
  → Claude interprets and responds
```

MCP is the consumption layer. Meta-Forge is the production layer. The flywheel:

```
More AI usage → more traces → better Meta-Forge input → better taps → more AI usage
```

---

## What Tap Does NOT Do

1. **Does not force unified primitives across platforms** — each runtime uses its natural execution model
2. **Does not generate taps in one shot** — iterative search, not one-time generation
3. **Does not compress history** — full traces, not summaries (15 percentage points difference)
4. **Does not predefine search strategy** — AI decides what approach to try
5. **Does not assume taps are permanent** — Build to Delete, every tap can be replaced by a better one

---

## Implementation Priorities

### Now (what exists)
- [x] tap.run / tap.list / forge pipeline
- [x] Browser runtime (Extension + Playwright)
- [x] macOS runtime (JXA)
- [x] MCP integration
- [x] 106 skills across 50+ sites
- [x] Runtime auto-routing (tap.runtime + tap.app)
- [x] Multi-agent tab isolation
- [x] Health contracts (min_rows, non_empty)

### Next (Meta-Forge MVP)
- [ ] Execution trace collection (every tap.run saves trace to history)
- [ ] History filesystem structure (~/.tap/history/)
- [ ] forge_inspect for macOS (AX tree + menu bar + AppleScript dict)
- [ ] Search skill template
- [ ] Meta-Forge loop: read history → propose → evaluate → archive
- [ ] `tap doctor` health monitoring + degradation detection

### Later
- [ ] Automatic re-forge on degradation
- [ ] Cross-tap knowledge transfer (patterns discovered for one site help another)
- [ ] Android runtime
- [ ] iOS runtime
- [ ] Community Meta-Forge (share histories, not just best taps)
