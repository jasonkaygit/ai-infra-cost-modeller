# Voice AI Cost & ROI Model

Models the **total cost of ownership, unit economics, infrastructure requirements and ROI**
of deploying Voice AI agents into large-scale telephony / contact-centre environments.

This is **not** a supplier price calculator. It models the complete technology cost stack
behind every Voice AI interaction — voice supplier, telephony, cloud infra, LLM inference,
knowledge retrieval, integration, storage, evaluation, observability, data/analytics, human
escalation, and fixed operational cost — through a **generic, configurable cost rule engine**.

> ⚠️ **All seed prices are SAMPLE DATA.** They are illustrative placeholders and do not
> represent current, quoted, or contracted pricing from any supplier or from AWS. Replace them
> with real pricing before using the model for any decision. Updating prices requires **no code
> changes** — pricing lives entirely in data.

---

## Architecture principle

Supplier and AWS pricing is **never hard-coded in calculation functions**. Every cost is a
`CostComponent` (pure data) carrying a `PricingRule`. A generic engine evaluates any rule
against a resolved `UsageContext`:

```
Scenario (profiles) ──▶ buildUsageContext() ──▶ drivers: Record<UsageDriver, number>
                                                        │
CostComponent[] (data) ──▶ pricingEngine.evaluateComponent() ──▶ per-component annual £ + trace
                                                        │
                                       tco.computeBreakdown() ──▶ CostBreakdown
                                                        │
                                     scenario.computeScenarioResult() ──▶ volumes, ROI, marginal
```

Adding a new AWS service, or swapping DynamoDB for Redshift, is a **data change** (add/toggle a
component). The only reason to touch engine code is to add a genuinely new *pricing model*.

### Layers

| Layer | Location | Responsibility |
|-------|----------|----------------|
| Domain | `src/domain/` | Types, taxonomy, decimal-safe `Money` |
| Engine | `src/engine/` | Pure calculation: usage context, pricing, TCO, ROI, marginal |
| Data | `src/data/` | Seed suppliers, components, scenarios (SAMPLE) |
| Repository | `src/repository/` | Swappable persistence (in-memory now; SQLite/Postgres later) |
| UI | `src/app/` | Next.js dashboard (no financial logic in components) |
| Tests | `tests/` | Node test-runner unit tests |

**No financial logic lives in React components.** The UI only calls engine functions.

---

## Running

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # unit tests (Node test runner via tsx)
npm run typecheck  # strict tsc
```

---

## Cost taxonomy

`VOICE_SERVICE · TELEPHONY_AND_INTEGRATION · AI_AND_COMPUTE · KNOWLEDGE ·
AUDIO_TRANSCRIPT_STORAGE · EVALUATION_AND_ASSURANCE · OPERATIONS_AND_OBSERVABILITY ·
DATA_AND_ANALYTICS · HUMAN_ESCALATION · FIXED_OPERATIONAL`

## Pricing models supported

Fixed monthly/annual, one-off, per call/session/minute/second/request/API call,
per 1k requests, per GB / GB-month / GB transferred, per token / 1k / 1M tokens,
split input/output token rates, hourly compute, provisioned instance, concurrent session,
tiered duration, tiered volume, minimum monthly commitment, bundled allowance,
**stepped infrastructure (capacity-based)**, percentage of traffic, sampled activity.

## Cost classification

Every line is classified `ONE_OFF · FIXED · SEMI_VARIABLE · VARIABLE · STEPPED` and exposed in
the results and the fixed/variable visualisation.

---

## Key modelling decisions (formulas)

**Concurrency (Erlang traffic intensity)**
```
callsPerHour        = annualCalls / operatingDays / operatingHours
avgSimultaneous     = callsPerHour × (avgCallDuration / 60)
peakConcurrent      = (dailyCalls × peakHourPct) × (avgCallDuration/60) × peakToAvgMultiplier
```

**AI cost applies to escalated calls too.** Escalated interactions incur:
`AI interaction duration + telephony duration + subsequent human handling`. AI minutes therefore
include contained, escalated, abandoned and failed legs — never contained-only. Human AHT after
transfer can optionally be reduced by AI pre-processing.

**Stepped infrastructure** does not scale linearly with volume:
```
units = clamp(ceil(peakConcurrency / capacityPerUnit), minUnits, maxUnits)
annual = unitPrice × units × 12
```

**ROI**
```
Baseline        = perContact × volume   (or fullyLoadedAgentCost × agents)
Gross avoided   = Baseline − FutureOperatingCost
Net benefit     = Baseline − FutureOperatingCost − Investment
ROI %           = Net benefit / Investment × 100
Payback (yr)    = Investment / Gross avoided
Break-even vol  = Investment / (perCallBaseline − perCallFuture)
```

**Marginal cost** re-runs the full breakdown at `volume + N` and takes the delta, so fixed and
stepped costs are correctly excluded until a capacity step is crossed. It is **never** `TCO / volume`.

**Decimal-safe money.** All money is stored as integer micro-units (`MONEY_SCALE = 1e6`) so that
summing millions of sub-penny per-token costs never drifts (see `tests/money.test.ts`).

---

## Scenario modes

`BUDGET_LED · VOLUME_LED · ROI_LED · TARGET_SAVINGS · CAPACITY · SUPPLIER_COMPARISON` —
mode-specific outputs are returned in `ScenarioResult.modeExtras` and computed in
`src/engine/scenario.ts`.

---

## Phase 1 scope (delivered)

Core domain model · generic pricing rule engine · cost-component repository · call-volume &
concurrency · containment/escalation model · human baseline · TCO · ROI · marginal cost ·
seed scenarios · scenario configuration UI · executive dashboard · cost waterfall ·
fixed/variable split · component breakdown with calculation traces · supplier comparison ·
sensitivity sliders · **37 passing unit tests**.

## Phase 2 scope (delivered)

- SQLite repository via sql.js — database persisted to IndexedDB
- Multi-scenario save/load/delete with localStorage + IndexedDB dual-write
- Multi-customer portfolio with scenario assignment and per-customer concurrency profiles
- 24-hour concurrency profile editor with presets and drag-to-adjust bars
- Multi-year growth projections (volume, resolution, inflation) with engine-computed TCO
- CSV export of the executive pack
- Cost breakdown drag-and-drop category grouping
- Cost flow diagram and network architecture diagram
- DR overhead slider
- Per-minute cost metrics

## Roadmap (future)

- Full assumptions drawer with source / confirmed-vs-estimated / date-updated per input
- Budget-led and target-savings solver UIs (engine already computes them)
- Multi-currency FX with live rates
- PDF export
