---
name: model-routing
description: Data-driven OpenCode model routing — analyze real usage data and update model choices and cost levers. Use when the user mentions model selection, model routing, model choice, usage trends, session costs, overpaying for models, or asks which model an agent should use.
---

# Model Routing

Analyze real-world OpenCode Go usage data to make data-driven model selection decisions.

## Analysis workflow

### Step 1: Fetch and parse the data

Use `webfetch` on each source:

**Artificial Analysis** (`https://artificialanalysis.ai/leaderboards/models`):

- Unified Intelligence Index (composite benchmark score)
- Output speed (tokens/s)
- Latency (TTFT)
- Default view shows current models only (omit `?status=all`)
- Note: URL filters (`?weights=open`, `?price=low`, etc.) are client-side only
- Filter locally after fetching based on agent role

**OpenCode /data** (`https://opencode.ai/data`):

- Token volume by model
- Momentum (% change) — use 2M window for stable trends
- Session cost (average $/session)
- Token cost (blended $/1M tokens)
- Cache ratio (% of input tokens served from cache)
- Market share by model author

**models.dev catalog** (`https://models.dev/api.json`):

- Machine-readable JSON — the catalog OpenCode builds its own from (~195 providers)
- Per-model: `cost.input`/`cost.output`/`cost.cache_read`, `limit.context`/`limit.output`,
  `reasoning_options`, modalities, tool support, `open_weights`
- Primary source for price, context limits, and variant availability;
  Artificial Analysis remains the source for intelligence scores
- Large response (~4MB); filter locally by provider

**OpenCode Zen catalogs** (OpenAI-compatible `/models` endpoints):

- `https://opencode.ai/zen/v1/models` — full Zen lineup
- `https://opencode.ai/zen/go/v1/models` — Go/open-weight subset, includes `-free` variants
- Inventory of what is routable through Zen; pair with models.dev for pricing
- Zen-routed models bill through plan subscriptions and rate-limited
  `-free` tiers — models.dev per-token prices do not reflect their marginal cost

### Step 2: Read local state

Read `~/.config/opencode/opencode.jsonc` (or `.json`). Note the current:

- `model` (default, `provider/model` format)
- `agents.build.model`
- `agents.plan.model`
- `agents.explore.model`
- `agents.general.model`
- `agents.title.model`

**Provider constraints on this machine** — follow this ladder in every proposal:

| Provider         | Billing                     | Position                                    |
| ---------------- | --------------------------- | ------------------------------------------- |
| `opencode-go`    | Monthly subscription        | First choice for all roles                  |
| `opencode`       | Free models (no Zen plan)   | Fallback once Go usage runs out             |
| `github-copilot` | Free credits, reset monthly | Last resort, after `opencode` free is spent |

Go limits are dollar-denominated against list prices — $12 per 5h, $30
weekly, $60 monthly — and models carry different usage multipliers: $15-tier
models (Grok 4.5, Kimi K3, GPT 5.6 Luna, DeepSeek V4 Pro, MiMo-V2.5-Pro)
burn quota 4× faster than $60-tier models (GLM-5.x, Kimi K2.x Code, MiniMax
M3, MiMo-V2.5, Qwen Plus). Per-model tables:
https://opencode.ai/docs/go/#usage-limits. Falling back to `opencode` free
models on exhaustion is the designed behavior.

When the fallback reaches `github-copilot`, select from its own catalog — it
carries models the other two lack.

Privacy: exclude models that train on prompts from every proposal. On Go this
is currently `muse-spark-1.2-contributor`; recheck the privacy table at
https://opencode.ai/docs/go/#privacy when the lineup changes.

Subscription quotas replace token price as the cost currency: compare
candidates by consumption per billing window (Go dollars via model
multipliers, copilot credits per session) and use models.dev prices as
tie-breakers within a provider. Check Go quota directly with `go-usage` —
it prints rolling, weekly, and monthly usage percentages with reset times
(`--json` for machine-readable output; `--report` for aggregated local
routing events). `/api/session` remains the source for per-session cost detail.

Model references may carry a variant suffix (`provider/model#variant`), e.g.
`anthropic/claude-opus-4-6#high` — include it when comparing costs, since
reasoning variants change token spend per session. Variant availability is
model-specific; confirm against `reasoning_options` in models.dev. The root
`model` default keeps `provider/model` only — variant selection sticks at the
agent, command, or session level.

Then verify against the running service instead of assuming defaults:

- `opencode2 api get /api/agent` — which agents actually exist (built-ins may
  be overridden or disabled)
- `opencode2 api get /api/session` — recent sessions, each with `agent`,
  `model`, `cost`, and token breakdowns (`output`, `reasoning`,
  `cache.read`/`cache.write`)
- `opencode2 api get /api/model` — catalog actually available in the current
  project; `/api/provider` shows connected providers and `/api/config` the
  merged effective config

Weight personal session data above community aggregates: it shows which agents
actually spend, on which models, at what cost. Filter recommendations to
models present in the catalog; candidates outside it need provider
configuration first.

### Step 3: Compare and identify changes

**Filter criteria by agent role** (apply after fetching):

| Agent             | Intelligence | Price     | Speed     | Rationale                             |
| ----------------- | ------------ | --------- | --------- | ------------------------------------- |
| `build`/`general` | 40+          | <$0.50/1M | any       | High volume, balance quality and cost |
| `plan`            | 45+          | any       | any       | Low frequency, prioritize reasoning   |
| `explore`/`title` | any          | <$0.10/1M | >80 tok/s | High volume, cost-critical, read-only |

Thresholds reviewed 2026-08 — revisit when the market shifts or quarterly.

**Change a model when**:

- Current model has negative momentum > -30% AND a cheaper/better alternative exists
- A model with similar Intelligence Index has 2× lower session cost
- Current model is declining and a higher-momentum alternative is available
- A new model appears with Intelligence 40+ and price <$0.30/1M

**Keep current choices when**:

- Momentum is stable (within ±20%)
- Session cost is competitive (within 2× of alternatives)
- No clear better alternative in the data

### Step 4: Propose changes

Present a table:

| Agent | Current      | Proposed   | Reason                                                |
| ----- | ------------ | ---------- | ----------------------------------------------------- |
| build | qwen3.7-plus | minimax-m3 | M3 +79% momentum, 3× cheaper/session, Intelligence 44 |

Include the data points that drove each recommendation:

- Personal session costs from `/api/session` (which agents spend, on what)
- Intelligence Index from Artificial Analysis
- Momentum from OpenCode /data
- Session cost comparison

Where a cost or quality signal has a direct lever — variant, tool output cap,
context budget, local provider — recommend the lever alongside or instead of a
model swap. See [REFERENCE.md](REFERENCE.md) for the full lever list.

### Step 5: Apply after confirmation

Edit `~/.config/opencode/opencode.jsonc` (or `.json`). Verify with
`opencode2 debug config`, then smoke-test each changed model reference:

```sh
opencode2 run -m <provider/model#variant> "Reply OK"
```

An unknown variant or unavailable model fails resolution here rather than
mid-session.

## Advanced features

See [REFERENCE.md](REFERENCE.md) for:

- Catalog and pricing APIs (models.dev, Zen)
- Cost and quality levers beyond model swaps
- Complete benchmark source list and accessibility matrix
- How to interpret conflicting signals (high momentum but high cost)
