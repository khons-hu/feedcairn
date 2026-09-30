# TypeSafe preview pilot

Local experiment for Feedcairn. Nothing here sends notifications or changes the production feed. The app build does not include this directory.

## First run

40 public RSS items, eight per existing official source: OpenAI, DeepMind, Codex, Claude Code and OpenAI Status. Inputs are the title, source name and up to 600 characters of RSS summary, not full articles. The pinned model is `jev-1.13.0`.

Reference labels were assigned by the coding assistant before inference. They are **not independent human ground truth**. Ambiguous items are marked. Attention labels express whether an item would merit attention at publication, not whether an old item should trigger a notification now.

| Measure | Result |
| --- | --- |
| Category agreement with reference | 40/40 |
| Attention agreement with reference | 25/40 |
| Existing rules attention agreement | 29/40 |
| Jev attention agreement, excluding ambiguous references | 21/29 |
| Recommended alerts | 0 |
| Reference alerts missed | 9/9 |
| Input tokens | 28,964 |
| Estimated cost at $42/billion input tokens | $0.001216488 |
| Median / p95 request latency | 294 / 326 ms |

The baseline maps `important` to `notify` and everything else to `show`. It has no `skip` output and its categories differ, so this is only an attention comparison, not a matched category benchmark. Cost is an estimate from returned usage, not a billing receipt. All 40 calls returned valid typed responses.

## Decision

Keep production rules. Jev appears useful for categorization on this sample, but the attention prompt misses every reference alert. Its confidence must not be treated as correctness. Do not enable model-driven push from this result.

This sample is repetitive: eight Codex prereleases, eight Claude releases, eight resolved incidents. It has no opinion examples or ongoing outages, and several DeepMind summaries are empty. Category agreement does not establish general reliability.

Next evaluation should use an independently reviewed held-out set, including full public release excerpts, active and resolved incidents, routine fixes, opinion, unrelated news and multilingual examples. Separate topic relevance from impact instead of putting the whole attention policy in one Choice. Tune only on the development set, then evaluate the held-out set once. Freshness, deduplication and permission to notify must remain deterministic code.

## Reproduce deliberately

From the repository root, put `TYPESAFE_API_KEY` in the ignored `.env` file, then run:

```sh
node --env-file=.env experiments/typesafe/pilot.mjs
```

Each run makes up to 50 paid API requests against the saved sample and overwrites the results. There is no scheduler or automatic retry. It stops on an HTTP error, timeout or invalid answer. The key is sent only to the fixed TypeSafe API endpoint and never written to the results. No private account data is used as model input.

- `sample.json`: saved public feed excerpts and source URLs
- `labels.json`: pre-inference reference labels and ambiguity flags
- `results.json`: per-item predictions, probabilities, baseline and usage
- `metrics.json`: measured summary

Docs consulted: https://docs.typesafe.ai/api.md and https://docs.typesafe.ai/cookbooks/rerank_typesafe.md

## Second pilot: independent dimensions

`policy-v2.mjs` asks relevance, impact and suppression as three parallel Noul questions. Code combines their probabilities using provisional thresholds fixed before the run. No threshold was adjusted after seeing these results. `run-v2.mjs` reuses the original 40 items and adds 20 explicitly synthetic challenge fixtures. They include ongoing/resolved incidents, research, opinion, irrelevant marketing, an embedded instruction attack and six languages. Fixtures and expected labels were authored before inference by the same assistant. **This is not an independently reviewed or representative held-out benchmark.** Original data is development data, since its first-run results informed this design.

| Measure | V1 | V2 |
| --- | --- | --- |
| Original sample attention agreement | 25/40 | 27/40 |
| Original reference alerts found | 0/9 | 4/9 |
| Original extra alerts vs reference | 0 | 2 |
| Existing rules agreement on original sample | 29/40 | 29/40 |

The 20 synthetic cases matched 15/20 references, finding 5/9 intended alerts without extra alerts. The baseline matched 6/20, but this artificial set was deliberately constructed to exercise gaps in keyword rules, so it is not evidence of overall superiority. Slovak, Hungarian and Polish launch fixtures were under-prioritized. German and Spanish launch fixtures passed. One case per language is insufficient to estimate multilingual quality. The single embedded instruction attack was skipped, not proof of general injection resistance.

V2 used 30,497 input tokens, estimated $0.001280874 at the same pricing assumption. Median latency was 264 ms, p95 339 ms across 60 sequential calls. All calls succeeded. Five local policy tests passed (uncertainty, suppression, relevance, intended alerts and invalid answers).

**Decision: do not replace production rules or enable model-driven notifications.** Splitting the questions improves recall but still loses to the baseline on the original sample and misses critical regression fixes. Sparse source summaries and ambiguous reference judgments remain limitations. Do not lower thresholds just to improve this development score. The next useful evidence is richer public source excerpts and independent human review of disputed priorities, followed by an untouched evaluation set. Existing results remain preserved separately.

Run deliberately from the repository root (up to 60 API calls, overwrites V2 results):

```sh
node --test experiments/typesafe/policy-v2.test.mjs
node --env-file=.env experiments/typesafe/run-v2.mjs
```

This remains local experimental code, not imported by the app, scheduled, deployed or used for delivery. No public README/portfolio feature claim is warranted.

## Third pilot: suppress incident reports, not regression fixes

V2's suppression question incorrectly conflated resolved service incidents with bug-fix releases. V3 explicitly distinguishes these. Thresholds remain unchanged. A diagnostic Gemini item now includes a short paragraph fetched from its original public article confirming API availability, rather than an empty RSS summary. This is a paired diagnostic with both prompt and input changes, not an isolated causal experiment.

V3 was evaluated once on ten previously unused RSS items (positions 9–10 from each official feed), plus two separately reported known-failure diagnostics. References were frozen before inference by the same assistant. The fresh set is unseen by the model in our prior pilots but is small, not independently human-reviewed and still source/release-heavy. No tuning or rerunning followed these results.

- Fresh sample: 7/10 action agreement, equal to existing rules. One of two reference alerts found, one extra alert. Disagreements: a customer case study shown rather than skipped, a transcription model launch not alerted, a minor regression fix alerted.
- Diagnostics: 2/2, recovering the enriched Gemini launch and the blocking API regression fix. Existing rules also match both.
- Usage: 6,445 input tokens, estimated $0.00027069. Median 311 ms, p95 815 ms across 12 calls.
- Five deterministic policy tests pass. They test routing and rejection of invalid values, not the semantic correctness of the model.

**Outcome:** the two diagnosed failures are addressed on their examples, but there is still no evidence that model-selected notifications outperform the existing rules. Stop prompt tuning here. Keep this experiment local. A useful future use is optional category/relevance metadata for browsing, with deterministic rules continuing to own delivery, or a genuinely independent user-labeled evaluation before changing alerts. Do not present this as a deployed feature.

Artifacts: `cases-v3.json`, `policy-v3.mjs`, `run-v3.mjs`, `results-v3.json`, `metrics-v3.json`. The case file retains public source URLs and separates fresh from diagnostic items. To reproduce deliberately: `node --env-file=.env experiments/typesafe/run-v3.mjs` (12 requests, overwrites V3 results).
