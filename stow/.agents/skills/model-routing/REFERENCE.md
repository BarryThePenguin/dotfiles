# Model Routing Reference

## Benchmark sources

### Primary (webfetch-accessible)

- **Artificial Analysis**: https://artificialanalysis.ai/leaderboards/models
  - Unified Intelligence Index, blended price, speed, latency
  - Covers all Go models plus 100+ others
  - Server-rendered, fully extractable via `webfetch`
  - Default view shows current models only (omit `?status=all`)
  - Note: URL filters (`?weights=open`, `?price=low`, etc.) are client-side only and don't affect `webfetch` results
  - Filter locally after fetching based on agent role:
    - `build`/`general`: focus on Intelligence 40+, price <$0.50/1M
    - `plan`: focus on Intelligence 45+, price less critical
    - `explore`/`small_model`: focus on price <$0.10/1M, speed >80 tok/s

- **OpenCode /data**: https://opencode.ai/data
  - Usage volume, momentum, session cost, cache ratio
  - Best source for cost trends and adoption signals
  - Server-rendered, fully extractable

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

## Interpreting OpenCode /data metrics

### Top Models

- Volume: total tokens over the time window
- Momentum: % change (positive = growing adoption, negative = declining)
- Use 2M window for stable trends, 1W for recent shifts

### Session Cost

- Average USD per session
- Lower is better for high-volume agents (build, explore)
- Higher acceptable for low-frequency agents (plan)

### Token Cost

- Blended $/1M tokens (input + output + cached)
- Explains why session costs differ between models

### Cache Ratio

- % of input tokens served from cache
- Higher (95%+) means cached-read price dominates
- Validates compaction.prune settings

## Handling conflicts

**High momentum but high cost**:

- Investigate why users adopt it (quality? features?)
- Consider for plan agent if current plan model declining
- Avoid for build agent unless quality gap is large

**Declining momentum but good benchmarks**:

- Users may have found better alternatives
- Check if cheaper model with similar benchmarks exists
- Downgrade if benchmark gap <5% SWE-Pro

**Stable momentum, competitive cost**:

- Keep unless clear better alternative emerges

## Historical context (June 2026)

- DeepSeek V4 Flash: volume leader (7.2T tokens), cheapest ($0.06/1M)
- MiniMax M3: strongest momentum (+79%), best quality-to-cost ratio
- Qwen3.7 Plus: declining (-39%) despite good benchmarks
- Kimi K2.7 Code: surging (+730%) but expensive ($0.70/1M)
- GLM-5.2: new, expensive ($0.90/1M), highest Intelligence (51)
