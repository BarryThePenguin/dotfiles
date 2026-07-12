---
name: model-routing
description: Analyze OpenCode Go usage data and update model routing configuration. Use when user mentions model selection, model routing, usage trends, or wants to check if their OpenCode Go model choices are still optimal based on real usage data.
---

# Model Routing

Analyze real-world OpenCode Go usage data to make data-driven model selection decisions.

## Quick start

1. Fetch https://artificialanalysis.ai/leaderboards/models (Intelligence Index, price, speed)
2. Fetch https://opencode.ai/data (usage volume, momentum, session cost, cache ratio)
3. Read current config: `~/.config/opencode/opencode.jsonc` (or `.json`)
4. Compare current choices against the data
5. Propose changes with reasoning
6. Apply after user confirmation

## Analysis workflow

### Step 1: Fetch and parse the data

Use `webfetch` on both sources:

**Artificial Analysis** (`https://artificialanalysis.ai/leaderboards/models`):

- Unified Intelligence Index (composite benchmark score)
- Blended price per 1M tokens
- Output speed (tokens/s)
- Latency (TTFT)
- Context window
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

### Step 2: Read current config

Read `~/.config/opencode/opencode.jsonc` (or `.json`). Note the current:

- `model` (default)
- `agent.build.model`
- `agent.plan.model`
- `agent.explore.model`
- `agent.general.model`
- `small_model`

### Step 3: Compare and identify changes

**Filter criteria by agent role** (apply after fetching):

| Agent                   | Intelligence | Price     | Speed     | Rationale                             |
| ----------------------- | ------------ | --------- | --------- | ------------------------------------- |
| `build`/`general`       | 40+          | <$0.50/1M | any       | High volume, balance quality and cost |
| `plan`                  | 45+          | any       | any       | Low frequency, prioritize reasoning   |
| `explore`/`small_model` | any          | <$0.10/1M | >80 tok/s | High volume, cost-critical, read-only |

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

- Intelligence Index from Artificial Analysis
- Momentum from OpenCode /data
- Session cost comparison

### Step 5: Apply after confirmation

Edit `~/.config/opencode/opencode.jsonc` (or `.json`). Verify with `opencode debug config`.

## Advanced features

See [REFERENCE.md](REFERENCE.md) for:

- Complete benchmark source list and accessibility matrix
- How to interpret conflicting signals (high momentum but high cost)
- Historical context and trend analysis methodology
