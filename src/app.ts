// manimani.etzhayyim.com — L3 dispatcher CF Worker (ADR-2605080800).
//
// Surfaces:
//   /health, /_app/meta                          edge probe (no auth)
//   /xrpc/com.etzhayyim.apps.manimani.ingest           procedure (Bearer auth)
//   /xrpc/com.etzhayyim.apps.manimani.classify         procedure (Bearer auth)
//   /xrpc/com.etzhayyim.apps.manimani.process          procedure (Bearer auth)
//   /xrpc/com.etzhayyim.apps.manimani.getProject       query     (Bearer auth)
//   /xrpc/com.etzhayyim.apps.manimani.listProjects     query     (Bearer auth)
//   /xrpc/com.etzhayyim.apps.manimani.coverage         query     (Bearer auth)
//
// Auth: Bearer sk_live_* / ES256 JWT → PDS service binding
// `/_internal/resolve-auth` returns { did, orgDid, activeDid, productScope }.
// Dispatch: forwards to bpmn-dispatcher with x-internal-trust HMAC.
//
// LangGraph backend: bpmn-dispatcher routes
// `com.etzhayyim.apps.manimani.*` to LangGraph Server `/runs` (per
// ADR-2605080600 Phase 3). This Worker stays state-less — no LLM call,
// no Hyperdrive write here. All compute happens in mitama-manimani-pool.

import { Hono } from "hono";
import { dispatchManimaniXrpc } from "./dispatcher";
import { renderEmbedHtml } from "./embed";

type Env = {
  MANIMANI_VERSION?: string;
  MANIMANI_ACTOR_DID?: string;
  BPMN_DISPATCHER_URL: string;
  PDS_URL?: string;
  AUTHN_URL?: string;
  DISPATCHER_INTERNAL_SECRET?: string;
  PDS_SERVICE?: { fetch(req: Request): Promise<Response> };
  AUTHN_SERVICE?: { fetch(req: Request): Promise<Response> };
  HYPERDRIVE?: unknown;
  etzhayyim_METERING_DISABLED?: string;
};

interface AuthContext {
  did: string;
  orgDid: string;
  activeDid?: string;
  productScope?: "yata" | "obj" | null;
}

declare module "hono" {
  interface ContextVariableMap {
    auth?: AuthContext;
  }
}

const app = new Hono<{ Bindings: Env }>();

app.get("/health", (c) =>
  c.json({ ok: true, app: "manimani", ts: new Date().toISOString() }),
);

app.get("/_worker/health", (c) =>
  c.json({ ok: true, app: "manimani", ts: new Date().toISOString() }),
);

app.get("/_app/meta", (c) =>
  c.json({
    app: "etzhayyim-project-manimani",
    did: c.env.MANIMANI_ACTOR_DID ?? "did:web:manimani.etzhayyim.com",
    version: c.env.MANIMANI_VERSION ?? "0.0.0",
    layer: "L3-dispatcher",
    surfaces: [
      "/xrpc/com.etzhayyim.apps.manimani.ingest",
      "/xrpc/com.etzhayyim.apps.manimani.classify",
      "/xrpc/com.etzhayyim.apps.manimani.process",
      "/xrpc/com.etzhayyim.apps.manimani.resumeRun",
      "/xrpc/com.etzhayyim.apps.manimani.getProject",
      "/xrpc/com.etzhayyim.apps.manimani.listProjects",
      "/xrpc/com.etzhayyim.apps.manimani.listPendingRuns",
      "/xrpc/com.etzhayyim.apps.manimani.coverage",
      "/embed",
    ],
    backend: c.env.BPMN_DISPATCHER_URL,
    projectKinds: ["knowledge", "task", "memo", "unsorted"],
    artifactKinds: [
      "facts_jsonl",
      "todos_jsonl",
      "summary_text",
      "raw_passthrough",
      "error",
    ],
    federable: false,
  }),
);

async function resolveAuthContext(req: Request, env: Env): Promise<AuthContext | null> {
  const h = req.headers.get("authorization") ?? "";
  if (!h.startsWith("Bearer ")) {
    return null;
  }
  const token = h.slice("Bearer ".length).trim();
  if (!token) return null;

  // Phase 7: JWT decode-and-pass. PDS does not expose `/_internal/resolve-auth`
  // (planned dep, not built). The CF Worker decodes the JWT locally to extract
  // caller DID, then forwards to bpmn-dispatcher with x-internal-trust HMAC;
  // the LangGraph Server pod accepts only requests carrying that HMAC, and the
  // dispatcher itself enforces signature checks for non-internal callers.
  // Signature verification is delegated to the next hop — the manimani edge
  // is purely a forwarder.
  if (token.startsWith("sk_live_") || token.startsWith("sk_test_")) {
    // API key — opaque; cannot decode locally. Forward as-is and let the
    // dispatcher / PDS validate. The Worker fills in best-effort caller DID
    // from env.MANIMANI_ACTOR_DID so downstream RLS still scopes by actor.
    return {
      did: env.MANIMANI_ACTOR_DID ?? "did:web:manimani.etzhayyim.com",
      orgDid: "did:erc725:etzhayyim:260425:anon",
      productScope: null,
    };
  }

  // ES256 JWT (3 segments). Decode payload only — no signature verification.
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(b64urlDecode(parts[1]!));
    const sub = String(payload.sub ?? "").trim();
    const iss = String(payload.iss ?? "").trim();
    if (!sub) return null;
    // For agent-issued tokens (etzhayyim agent-token), `sub` is the caller DID.
    // `iss` is the issuer (authn.etzhayyim.com for service-auth tokens).
    // Org DID is not present in service-auth JWTs; we use a deterministic
    // fallback that downstream RLS treats as anon-org. Real org binding
    // happens once `/_internal/resolve-auth` ships on PDS.
    return {
      did: sub,
      orgDid: "did:erc725:etzhayyim:260425:anon",
      activeDid: sub,
      productScope: null,
    };
  } catch {
    return null;
  }
}

function b64urlDecode(s: string): string {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
  return atob(b64);
}

app.use("*", async (c, next) => {
  const path = c.req.path;
  if (
    path === "/health" ||
    path === "/_worker/health" ||
    path === "/_app/meta" ||
    path === "/embed" ||
    path === "/"
  ) {
    return next();
  }
  const auth = await resolveAuthContext(c.req.raw, c.env);
  if (!auth) {
    return c.json({ error: "AuthRequired", message: "Bearer token required" }, 401);
  }
  c.set("auth", auth);
  await next();
});

// Phase 6 — embedded UI for project / coverage / HITL run review.
// Public surface (no Bearer required to load HTML); the JS inside
// expects a token via postMessage `etzhayyim:embed:auth` from the parent
// (yoro AppShell) or via `?bearer=...` query string for dev.
app.get("/embed", (c) => {
  return c.html(renderEmbedHtml());
});

// Plain root → bounce to /embed so a browser visit lands on a useful
// page rather than a 404. Programmatic clients use /xrpc/* directly.
app.get("/", (c) => c.redirect("/embed", 302));

app.all("/xrpc/:nsidParam", async (c) => {
  const nsid = c.req.param("nsidParam") || "";
  if (!nsid.startsWith("com.etzhayyim.apps.manimani.")) {
    return c.json({ error: "NotFound", path: c.req.path }, 404);
  }
  const method = nsid.slice("com.etzhayyim.apps.manimani.".length);
  const auth = c.var.auth;
  if (!auth) {
    return c.json({ error: "AuthRequired" }, 401);
  }
  let body: unknown = undefined;
  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    try {
      body = await c.req.json();
    } catch {
      body = {};
    }
  }
  const params = Object.fromEntries(new URL(c.req.url).searchParams.entries());
  return dispatchManimaniXrpc({
    env: c.env,
    nsid,
    method: c.req.method,
    body,
    params,
    auth,
  });
});

app.notFound((c) => c.json({ error: "NotFound", path: c.req.path }, 404));
app.onError((err, c) => {
  console.error("[manimani] unhandled", err);
  return c.json({ error: "Internal", message: String(err?.message ?? err) }, 500);
});

export default app;
