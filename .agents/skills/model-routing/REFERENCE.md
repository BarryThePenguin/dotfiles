# Model Routing Reference

## Benchmark sources

### Primary (webfetch-accessible)

- **Artificial Analysis**: https://artificialanalysis.ai/leaderboards/models
  - Unified Intelligence Index, output speed, latency
  - Covers all Go models plus 100+ others
  - Server-rendered, fully extractable via `webfetch`
  - Default view shows current models only (omit `?status=all`)
  - Note: URL filters (`?weights=open`, `?price=low`, etc.) are client-side only and don't affect `webfetch` results

- **OpenCode /data**: https://opencode.ai/data
  - Usage volume, momentum, session cost, cache ratio
  - Best source for cost trends and adoption signals
  - Server-rendered, fully extractable

### Catalog and pricing

- **models.dev**: `https://models.dev/api.json`
  - Machine-readable JSON catalog OpenCode builds its own model list from (~195 providers)
  - Per-model: `cost.input`/`cost.output`/`cost.cache_read`, `limit.context`/`limit.output`,
    `reasoning_options` (which variants exist), modalities, tool support, `open_weights`
  - Primary source for price, context limits, and variant availability;
    pair with Artificial Analysis for intelligence scores
  - Large response (~4MB) — filter locally by provider rather than reading whole

- **OpenCode Zen catalogs** (OpenAI-compatible `/models` endpoints):
  - `https://opencode.ai/zen/v1/models` — full Zen lineup
  - `https://opencode.ai/zen/go/v1/models` — Go/open-weight subset, includes `-free` variants
  - Inventory of what is routable through Zen; models.dev carries the pricing

### Secondary (partial Go coverage)

- **Aider Polyglot**: https://aider.chat/docs/leaderboards/
  - Multi-language coding (225 Exercism tasks)
  - Covers DeepSeek, Qwen3, Kimi K2 but not MiniMax M3, MiMo, or Qwen3.7 variants
  - Server-rendered, extractable

### Reference only (JS-rendered, not extractable)

- **SWE-bench**: https://www.swebench.com/ — real-world bug fixing
- **LiveCodeBench**: https://livecodebench.github.io/leaderboard.html — competitive programming
- **GSO**: https://gso-bench.github.io/ — software optimization (102 tasks, 5 languages)
- **LM Arena**: https://lmarena.ai/leaderboard/agent — crowdsourced rankings

Note: These leaderboards render data client-side. `webfetch` gets the page shell but not scores. Use them for manual reference or when a browser automation tool is available.

## Reading OpenCode /data

- Session cost: lower matters most for high-volume agents (build, explore);
  higher acceptable for low-frequency agents (plan)
- Cache ratio: 95%+ means cached-read price dominates — validate
  `compaction.keep.tokens` against it

## Cost and quality levers

A model swap is one dial among several. When a proposal targets a cost or
quality signal, check whether a lever addresses it directly:

| Lever              | Config                                        | Effect                                                                |
| ------------------ | --------------------------------------------- | --------------------------------------------------------------------- |
| Variants           | `agents.<n>.model: "provider/model#high"`     | Reasoning effort per agent — often the largest cost dial on one model |
| Custom variants    | `providers.<p>.models.<m>.variants[]`         | Named overlays (`fast`, `deep`) tuned to your usage                   |
| Per-command models | `commands.<name>.model#variant`               | Cheap model for specific slash commands                               |
| Tool output caps   | `tool_output.max_lines` / `max_bytes`         | Bounds token spend on shell/read results                              |
| Context budget     | `compaction.keep.tokens`, `compaction.buffer` | Retained context per session                                          |
| Session warming    | `warming.interval` / `warming.duration`       | Background keep-alive requests — audit as a hidden cost line          |
| Image limits       | `media.image.*`                               | Resize or reject images before tokens are spent                       |
| Subagent fan-out   | `experimental.subagent_depth`                 | Caps concurrent subagent spend                                        |
| Model aliasing     | `providers.<p>.models.<m>.modelID`            | Point a friendly catalog ID at a different upstream model             |
| Local providers    | ollama / lmstudio / vllm auto-discovery       | Free routing for high-volume read-only work                           |

Variant availability is model-specific — confirm against `reasoning_options`
in models.dev before recommending a variant name. The root `model` default
keeps `provider/model` only; variants stick at the agent, command, or session
level.

## Handling conflicts

**High momentum but high cost**:

- Investigate why users adopt it (quality? features?)
- Consider for plan agent if current plan model declining
- Avoid for build agent unless quality gap is large

**Declining momentum but good benchmarks**:

- Users may have found better alternatives
- Check if cheaper model with similar benchmarks exists
- Downgrade if benchmark gap <5% SWE-Pro
