# manimani.etzhayyim.com — personal knowledge router (LangGraph user-intake routing)

> **⚠️ Substrate/runtime/inference SUPERSEDED (2026-05-29, ADR-2605291100).**
> The persistence (RisingWave/Hyperdrive), inference (Anthropic-direct / RunPod vLLM),
> and runtime (Python LangGraph Server + Granian pool) described below predate the
> religious-corp constitutional wave and are now **prohibited**. The reconciled design
> targets **kotoba EAVT datoms** (the "datomic"), **kotoba StateGraph** (the "langgraph"),
> **Murakumo LiteLLM-only** inference, and Signal E2E PII — see
> `90-docs/adr/2605291100-manimani-kotoba-native-reconciliation-gmail-pc-ingest.md`.
> The **product contract** below (XRPC surface, 4 project kinds, LLM-led classification,
> non-federable default, CF Worker edge-facade role) is **preserved unchanged**.
> Execution backend (`kotodama/manimani/`) was never implemented; Phase 0 contract only.

Authoritative: ADR-2605291100 (kotoba-native reconciliation + Gmail/PC ingest, current) ·
ADR-2605080800 (product contract) + ADR-2605080600 (LangGraph Server, superseded by kotoba
StateGraph) + ADR-2604282300 (CF Worker = edge facade).

## Layer

L3 Dispatcher (CF Worker, edge). State-less. All compute lives in
`mitama-manimani-pool` LangGraph Server (Granian) which calls Anthropic
API (or vLLM Gemma4 on RunPod) via `kotodama.llm.call_tier`, and writes
intake / project / artifact rows to RisingWave directly via Hyperdrive.

## Surfaces

| Path | Purpose |
|---|---|
| `/xrpc/com.etzhayyim.apps.manimani.ingest` | procedure — submit text/url/file_ref/email intake, returns `runId` |
| `/xrpc/com.etzhayyim.apps.manimani.classify` | procedure — re-classify an intake into a different project |
| `/xrpc/com.etzhayyim.apps.manimani.process` | procedure — re-process an intake with a different model / kind |
| `/xrpc/com.etzhayyim.apps.manimani.resumeRun` | procedure — resume a HITL-paused run with `decision: approve|reject|reassign` (Phase 4) |
| `/xrpc/com.etzhayyim.apps.manimani.getProject` | query — fetch project + recent artifacts |
| `/xrpc/com.etzhayyim.apps.manimani.listProjects` | query — list active projects in actor scope |
| `/xrpc/com.etzhayyim.apps.manimani.coverage` | query — counters + 24h delta + unrouted count |
| `/health`, `/_app/meta` | edge probe |

## Project kinds

| kind | Processor | LLM tier | Output (`vertex_manimani_artifact.artifact_kind`) |
|---|---|---|---|
| `knowledge` | `extract_facts` — fact extraction + claim/source split | balanced | `facts_jsonl` |
| `task` | `expand_todo` — action item + due/owner inference | balanced | `todos_jsonl` |
| `memo` | `summarize` — 280-char summary + tag | fast | `summary_text` |
| `unsorted` | `defer_for_user_review` — no LLM call, raw passthrough | — | `raw_passthrough` |

## Auth

- `Bearer sk_live_*` — etzhayyim API key (PDS verifies via `vertex_api_key`)
- `Bearer <ES256-JWT>` — AT Protocol session JWT
- Worker forwards Authorization to PDS service binding
  `/_internal/resolve-auth`, gets `{ did, orgDid, activeDid, productScope }`,
  then HMAC-signs forward to bpmn-dispatcher.

## Forwarding model

```
Client → CF Worker (manimani.etzhayyim.com)
   ↓ auth middleware → PDS_SERVICE binding /_internal/resolve-auth
   ↓ resolved { did, orgDid, activeDid, productScope }
   ↓ POST https://dispatcher.etzhayyim.com/xrpc/com.etzhayyim.apps.manimani.{method}
      headers: x-internal-trust=<HMAC>, x-etzhayyim-{org,actor}-did, x-etzhayyim-trace-id
bpmn-dispatcher (K8s ClusterIP)
   ↓ NSID prefix routing (com.etzhayyim.apps.manimani.* → langgraph backend)
manimani-langgraph (mitama-manimani-pool, Granian :8000)
   ↓ POST /runs — start StateGraph
   ↓ Pregel: parse → classify → route → {extract_facts | expand_todo | summarize | defer} → persist → audit
   → Anthropic / vLLM (LLM tier resolves via kotodama.llm)
   → RisingWave Hyperdrive INSERT (vertex_manimani_intake/project/artifact/run + edge_manimani_belongs_to)
```

## Forbidden

- Direct LLM API calls from this CF Worker. LLM only known to LangGraph Server pod env.
- Direct Hyperdrive INSERT from this CF Worker. Domain writes go from LangGraph nodes only (ADR-0036).
- `sdk.pds.dispatch({ type: "com.atproto.repo.createRecord", ... })` for `com.etzhayyim.apps.manimani.*` — non-federable, default block.
- AT Repo emit (federable) of intake / project / artifact rows. Social derive is opt-in only via explicit `pds.dispatch({type:"app.bsky.feed.post"})` from a downstream actor.
- Adding new XRPC endpoints outside the 6 lexicons in `00-contracts/lexicons/com/etzhayyim/apps/manimani/`. New methods require an ADR addendum + lexicon PR.
- Hardcoded LLM model names in dispatcher routing. Use `resolveModelId()` / `MURAKUMO_DEFAULT_MODEL` SSoT (LLM Model SSoT convention).

## Deploy

```bash
cd 60-apps/etzhayyim-project-manimani
wrangler secret put DISPATCHER_INTERNAL_SECRET  # shared with K8s bpmn-dispatcher-auth
etzhayyim deploy --no-svelte
```

## Smoke

```bash
# 1. Edge health (no auth)
curl https://manimani.etzhayyim.com/health
curl https://manimani.etzhayyim.com/_app/meta

# 2. Submit a text intake (Bearer required)
curl -X POST https://manimani.etzhayyim.com/xrpc/com.etzhayyim.apps.manimani.ingest \
  -H "Authorization: Bearer sk_live_xxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "sourceKind": "text",
    "rawText": "TODO: review the Q3 OKR draft by Friday and ping Alice",
    "lang": "ja"
  }'
# → { "runId": "...", "intakeId": "...", "status": "running", "estimatedSeconds": 3 }

# 3. List projects (auto-emerged on first ingest)
curl https://manimani.etzhayyim.com/xrpc/com.etzhayyim.apps.manimani.listProjects \
  -H "Authorization: Bearer sk_live_xxxxx"

# 4. Re-classify an intake
curl -X POST https://manimani.etzhayyim.com/xrpc/com.etzhayyim.apps.manimani.classify \
  -H "Authorization: Bearer sk_live_xxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "intakeId": "...",
    "newProject": { "slug": "okr-q3", "title": "OKR Q3", "kind": "task" }
  }'

# 5. Coverage snapshot
curl 'https://manimani.etzhayyim.com/xrpc/com.etzhayyim.apps.manimani.coverage?windowDays=7' \
  -H "Authorization: Bearer sk_live_xxxxx"
```
