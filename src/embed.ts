// manimani.etzhayyim.com — /embed HTML UI (Phase 6, ADR-2605080800).
//
// Surfaces:
//   /embed?bearer=…        standalone dev mode (insecure, query-string token)
//   /embed                 expects parent to postMessage etzhayyim:embed:auth
//
// What the UI shows:
//   1. Project list  → /xrpc/com.etzhayyim.apps.manimani.listProjects
//   2. Coverage      → /xrpc/com.etzhayyim.apps.manimani.coverage
//   3. Run detail    → /runs/{run_id}
//        when status=interrupted, render pendingClassification.rationale
//        + new project proposal + 3 HITL buttons (approve / reject /
//        reassign) → /xrpc/com.etzhayyim.apps.manimani.resumeRun
//
// Auth model:
//   - The parent (yoro AppShell) iframes /embed and posts
//     `{type:'etzhayyim:embed:auth', token:'sk_live_...'}` once mounted.
//   - As a dev/standalone fallback, `?bearer=...` is honored.
//   - All XRPC calls go to manimani.etzhayyim.com which forwards to
//     bpmn-dispatcher with x-internal-trust HMAC; the embed only sees
//     the public Bearer surface.

const HTML = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>manimani — projects</title>
<style>
:root { color-scheme: light dark; --bg:#fff; --fg:#111; --muted:#888; --border:#e5e5e5; --accent:#2557d6; --warn:#b8530a; --danger:#b00; }
@media (prefers-color-scheme: dark) { :root { --bg:#0f1115; --fg:#e8e8e8; --muted:#777; --border:#22262e; --accent:#7aa6ff; --warn:#ffb066; --danger:#ff8888; } }
* { box-sizing: border-box; }
html, body { margin:0; padding:0; background:var(--bg); color:var(--fg); font:14px/1.5 ui-sans-serif, -apple-system, "Segoe UI", system-ui, sans-serif; }
header { padding:12px 16px; border-bottom:1px solid var(--border); display:flex; gap:12px; align-items:center; flex-wrap:wrap; }
header h1 { font-size:16px; margin:0; font-weight:600; letter-spacing:.02em; }
header .status { font-size:12px; color:var(--muted); }
main { padding:16px; display:grid; gap:16px; max-width:920px; margin:0 auto; }
section { border:1px solid var(--border); border-radius:8px; padding:12px 14px; }
section h2 { font-size:13px; margin:0 0 8px; font-weight:600; text-transform:uppercase; color:var(--muted); letter-spacing:.05em; }
table { width:100%; border-collapse:collapse; font-size:13px; }
th, td { padding:6px 8px; text-align:left; border-bottom:1px solid var(--border); }
th { font-weight:600; color:var(--muted); font-size:11px; text-transform:uppercase; letter-spacing:.04em; }
tr:last-child td { border-bottom:0; }
.pill { display:inline-block; padding:1px 8px; border:1px solid var(--border); border-radius:999px; font-size:11px; }
.pill.active { color:var(--accent); border-color:var(--accent); }
.pill.dormant { color:var(--muted); }
.pill.archived { color:var(--muted); opacity:.6; }
.pill.interrupted { color:var(--warn); border-color:var(--warn); }
.pill.completed { color:var(--accent); border-color:var(--accent); }
.pill.failed, .pill.completed_with_error { color:var(--danger); border-color:var(--danger); }
.coverage { display:grid; grid-template-columns:repeat(auto-fit, minmax(140px,1fr)); gap:8px; }
.kpi { padding:8px 10px; border:1px solid var(--border); border-radius:6px; }
.kpi .v { font-size:22px; font-weight:600; }
.kpi .k { font-size:11px; color:var(--muted); text-transform:uppercase; letter-spacing:.04em; }
form.run-lookup { display:flex; gap:8px; flex-wrap:wrap; }
input[type="text"] { flex:1 1 280px; padding:6px 8px; font:inherit; border:1px solid var(--border); background:transparent; color:inherit; border-radius:6px; }
button { font:inherit; padding:6px 10px; border:1px solid var(--border); background:transparent; color:inherit; border-radius:6px; cursor:pointer; }
button:hover { border-color:var(--accent); color:var(--accent); }
button.primary { border-color:var(--accent); color:var(--accent); }
button.danger { border-color:var(--danger); color:var(--danger); }
button.warn { border-color:var(--warn); color:var(--warn); }
.rationale { background:rgba(127,127,127,.08); padding:10px 12px; border-radius:6px; margin:8px 0; font-style:italic; }
.proposal { display:grid; grid-template-columns:120px 1fr; gap:6px 12px; margin:8px 0; font-size:13px; }
.proposal dt { color:var(--muted); }
.proposal dd { margin:0; }
.tag { display:inline-block; padding:0 6px; border:1px solid var(--border); border-radius:4px; font-size:11px; margin:0 4px 0 0; }
pre { background:rgba(127,127,127,.08); padding:10px; border-radius:6px; overflow:auto; font-size:12px; max-height:240px; }
.muted { color:var(--muted); }
.error { color:var(--danger); }
.actions { display:flex; gap:8px; flex-wrap:wrap; margin-top:8px; }
</style>
</head>
<body>
<header>
  <h1>manimani / 随に</h1>
  <span class="status" id="status">no token</span>
</header>
<main>
  <section>
    <h2>Pending review <span class="muted" style="font-weight:400; font-size:11px" id="pendingCount"></span></h2>
    <div id="pending"><span class="muted">loading…</span></div>
  </section>
  <section>
    <h2>Coverage (last 7d)</h2>
    <div class="coverage" id="cov"><span class="muted">loading…</span></div>
  </section>
  <section>
    <h2>Projects</h2>
    <div id="projects"><span class="muted">loading…</span></div>
  </section>
  <section>
    <h2>Run lookup</h2>
    <form class="run-lookup" id="runForm">
      <input type="text" id="runId" placeholder="run_id (32-char hex)" autocomplete="off" />
      <button type="submit">Open</button>
    </form>
    <div id="runDetail" style="margin-top:12px"></div>
  </section>
</main>
<script>
(() => {
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  let bearer = params.get("bearer") || sessionStorage.getItem("manimani_bearer") || "";
  if (bearer) sessionStorage.setItem("manimani_bearer", bearer);

  const setStatus = (txt, isErr) => {
    const el = $("status");
    el.textContent = txt;
    el.className = "status" + (isErr ? " error" : "");
  };

  // postMessage handshake with parent (yoro AppShell).
  window.addEventListener("message", (ev) => {
    const d = ev?.data;
    if (!d || typeof d !== "object") return;
    if (d.type === "etzhayyim:embed:auth" && typeof d.token === "string") {
      bearer = d.token;
      sessionStorage.setItem("manimani_bearer", bearer);
      setStatus("token received");
      refreshAll();
    }
  });
  try { window.parent?.postMessage({ type: "etzhayyim:embed:ready", nanoid: "manimani" }, "*"); } catch {}

  async function call(path, opts) {
    if (!bearer) throw new Error("no bearer token");
    const headers = Object.assign({ "content-type": "application/json", "authorization": "Bearer " + bearer }, (opts && opts.headers) || {});
    const r = await fetch(path, Object.assign({}, opts, { headers }));
    if (!r.ok) throw new Error(r.status + " " + r.statusText);
    return await r.json();
  }

  function pill(cls, txt) {
    const span = document.createElement("span");
    span.className = "pill " + cls;
    span.textContent = txt;
    return span;
  }

  function fmtTs(s) { return s ? String(s).replace("T", " ").replace("Z", "") : "—"; }

  async function loadPendingQueue() {
    try {
      const data = await call("/xrpc/com.etzhayyim.apps.manimani.listPendingRuns?limit=25");
      const root = $("pending");
      const runs = (data && data.runs) || [];
      $("pendingCount").textContent = runs.length ? "(" + runs.length + ")" : "";
      root.innerHTML = "";
      if (!runs.length) {
        root.innerHTML = '<span class="muted">no runs awaiting review</span>';
        return;
      }
      for (const r of runs) {
        const card = document.createElement("div");
        card.style.borderTop = "1px dashed var(--border)";
        card.style.padding = "10px 0";
        card.style.display = "grid";
        card.style.gap = "6px";

        const top = document.createElement("div");
        top.style.display = "flex";
        top.style.gap = "8px";
        top.style.alignItems = "center";
        top.appendChild(pill("interrupted", "interrupted"));
        const code = document.createElement("code");
        code.style.fontSize = "11px";
        code.style.color = "var(--muted)";
        code.textContent = r.runId;
        top.appendChild(code);
        const ts = document.createElement("span");
        ts.className = "muted";
        ts.style.fontSize = "11px";
        ts.style.marginLeft = "auto";
        ts.textContent = fmtTs(r.startedAt);
        top.appendChild(ts);
        card.appendChild(top);

        const cls = r.pendingClassification || {};
        const proposal = cls.new_project_proposal || cls.newProjectProposal || {};
        if (cls.rationale) {
          const rt = document.createElement("div");
          rt.className = "rationale";
          rt.style.margin = "0";
          rt.textContent = "“" + cls.rationale + "”";
          card.appendChild(rt);
        }

        const meta = document.createElement("div");
        meta.className = "muted";
        meta.style.fontSize = "12px";
        const proposalSummary =
          (proposal.title || proposal.slug || cls.existing_project_id || cls.existingProjectId || "(no proposal)") +
          (proposal.kind ? "  ·  kind=" + proposal.kind : "") +
          (typeof cls.confidence === "number" ? "  ·  conf=" + cls.confidence.toFixed(2) : "");
        meta.textContent = proposalSummary;
        card.appendChild(meta);

        const actions = document.createElement("div");
        actions.className = "actions";
        const approve = document.createElement("button");
        approve.className = "primary";
        approve.textContent = "approve";
        approve.onclick = () => decide(r.runId, "approve");
        const reject = document.createElement("button");
        reject.className = "danger";
        reject.textContent = "reject";
        reject.onclick = () => decide(r.runId, "reject");
        const reassignWrap = document.createElement("span");
        reassignWrap.style.display = "inline-flex";
        reassignWrap.style.gap = "4px";
        const reassignInput = document.createElement("input");
        reassignInput.type = "text";
        reassignInput.placeholder = "targetProjectId";
        reassignInput.style.minWidth = "200px";
        const reassignBtn = document.createElement("button");
        reassignBtn.className = "warn";
        reassignBtn.textContent = "reassign";
        reassignBtn.onclick = () => decide(r.runId, "reassign", reassignInput.value.trim() || null);
        reassignWrap.appendChild(reassignInput);
        reassignWrap.appendChild(reassignBtn);
        const open = document.createElement("button");
        open.textContent = "open";
        open.onclick = () => { $("runId").value = r.runId; loadRun(r.runId); };

        actions.appendChild(approve);
        actions.appendChild(reject);
        actions.appendChild(reassignWrap);
        actions.appendChild(open);
        card.appendChild(actions);

        root.appendChild(card);
      }
    } catch (e) {
      $("pending").innerHTML = '<span class="error">' + e.message + '</span>';
    }
  }

  async function loadCoverage() {
    try {
      const cov = await call("/xrpc/com.etzhayyim.apps.manimani.coverage?windowDays=7");
      const root = $("cov");
      root.innerHTML = "";
      const kpis = [
        ["intakes", cov.intakes ?? 0],
        ["intakes 24h", cov.intakes24h ?? 0],
        ["projects", cov.projects ?? 0],
        ["artifacts", cov.artifacts ?? 0],
        ["unrouted", cov.unroutedCount ?? 0],
        ["runs", cov.runs ?? 0],
      ];
      for (const [k, v] of kpis) {
        const div = document.createElement("div");
        div.className = "kpi";
        div.innerHTML = '<div class="v">' + v + '</div><div class="k">' + k + '</div>';
        root.appendChild(div);
      }
    } catch (e) {
      $("cov").innerHTML = '<span class="error">' + e.message + '</span>';
    }
  }

  async function loadProjects() {
    try {
      const data = await call("/xrpc/com.etzhayyim.apps.manimani.listProjects?limit=50");
      const tbl = document.createElement("table");
      tbl.innerHTML = "<thead><tr><th>slug</th><th>title</th><th>kind</th><th>status</th><th>30d</th><th>last intake</th></tr></thead>";
      const tbody = document.createElement("tbody");
      for (const p of data.projects || []) {
        const tr = document.createElement("tr");
        tr.innerHTML =
          "<td><code>" + escapeHtml(p.slug) + "</code></td>" +
          "<td>" + escapeHtml(p.title) + "</td>" +
          '<td><span class="tag">' + escapeHtml(p.kind) + "</span></td>" +
          "<td></td>" +
          "<td>" + (p.intakeCount30d ?? 0) + "</td>" +
          "<td>" + fmtTs(p.lastIntakeAt) + "</td>";
        tr.children[3].appendChild(pill(p.status, p.status));
        tbody.appendChild(tr);
      }
      tbl.appendChild(tbody);
      $("projects").innerHTML = "";
      $("projects").appendChild(tbl);
      if (!data.projects || !data.projects.length) {
        $("projects").innerHTML = '<span class="muted">no projects yet</span>';
      }
    } catch (e) {
      $("projects").innerHTML = '<span class="error">' + e.message + '</span>';
    }
  }

  async function loadRun(runId) {
    if (!runId) return;
    const root = $("runDetail");
    root.innerHTML = '<span class="muted">loading…</span>';
    try {
      const r = await call("/runs/" + encodeURIComponent(runId));
      renderRun(r, root);
    } catch (e) {
      root.innerHTML = '<span class="error">' + e.message + '</span>';
    }
  }

  function renderRun(r, root) {
    root.innerHTML = "";
    const head = document.createElement("div");
    head.style.display = "flex";
    head.style.gap = "8px";
    head.style.alignItems = "center";
    head.appendChild(pill(r.status || "unknown", r.status || "unknown"));
    const meta = document.createElement("span");
    meta.className = "muted";
    meta.style.fontSize = "12px";
    meta.textContent =
      "run=" + (r.runId || "?") +
      " · intake=" + (r.intakeId || "?") +
      " · started=" + fmtTs(r.startedAt) +
      (r.finishedAt ? " · finished=" + fmtTs(r.finishedAt) : "");
    head.appendChild(meta);
    root.appendChild(head);

    if (r.errorText) {
      const err = document.createElement("div");
      err.className = "error";
      err.style.marginTop = "6px";
      err.textContent = r.errorText;
      root.appendChild(err);
    }

    if (r.status === "interrupted") {
      renderHitlPanel(r, root);
    }

    if (r.artifacts && r.artifacts.length) {
      const h = document.createElement("h3");
      h.style.fontSize = "13px";
      h.style.margin = "12px 0 6px";
      h.textContent = "artifacts";
      root.appendChild(h);
      for (const a of r.artifacts) {
        const pre = document.createElement("pre");
        pre.textContent = JSON.stringify(a, null, 2);
        root.appendChild(pre);
      }
    }
  }

  function renderHitlPanel(r, root) {
    const cls = r.pendingClassification || {};
    const proposal = cls.new_project_proposal || cls.newProjectProposal || {};
    const wrap = document.createElement("div");
    wrap.style.marginTop = "12px";

    if (cls.rationale) {
      const rt = document.createElement("div");
      rt.className = "rationale";
      rt.textContent = "“" + cls.rationale + "”";
      wrap.appendChild(rt);
    }

    const dl = document.createElement("dl");
    dl.className = "proposal";
    addRow(dl, "decision", cls.decision || "(none)");
    addRow(dl, "confidence", typeof cls.confidence === "number" ? cls.confidence.toFixed(2) : "—");
    if (proposal.slug) addRow(dl, "slug", proposal.slug);
    if (proposal.title) addRow(dl, "title", proposal.title);
    if (proposal.kind) addRow(dl, "kind", proposal.kind);
    wrap.appendChild(dl);

    const actions = document.createElement("div");
    actions.className = "actions";

    const approve = document.createElement("button");
    approve.className = "primary";
    approve.textContent = "approve · let it emerge";
    approve.onclick = () => decide(r.runId, "approve");

    const reject = document.createElement("button");
    reject.className = "danger";
    reject.textContent = "reject";
    reject.onclick = () => decide(r.runId, "reject");

    const reassignWrap = document.createElement("span");
    reassignWrap.style.display = "inline-flex";
    reassignWrap.style.gap = "4px";
    const reassignInput = document.createElement("input");
    reassignInput.type = "text";
    reassignInput.placeholder = "targetProjectId (vertex_id)";
    reassignInput.style.minWidth = "240px";
    const reassignBtn = document.createElement("button");
    reassignBtn.className = "warn";
    reassignBtn.textContent = "reassign";
    reassignBtn.onclick = () => decide(r.runId, "reassign", reassignInput.value.trim() || null);
    reassignWrap.appendChild(reassignInput);
    reassignWrap.appendChild(reassignBtn);

    actions.appendChild(approve);
    actions.appendChild(reject);
    actions.appendChild(reassignWrap);
    wrap.appendChild(actions);

    root.appendChild(wrap);
  }

  function addRow(dl, k, v) {
    const dt = document.createElement("dt");
    dt.textContent = k;
    const dd = document.createElement("dd");
    dd.textContent = String(v);
    dl.appendChild(dt);
    dl.appendChild(dd);
  }

  async function decide(runId, decision, targetProjectId) {
    try {
      const body = { runId: runId, decision: decision };
      if (decision === "reassign") {
        if (!targetProjectId) return alert("targetProjectId required");
        body.targetProjectId = targetProjectId;
      }
      const r = await call("/xrpc/com.etzhayyim.apps.manimani.resumeRun", {
        method: "POST",
        body: JSON.stringify(body),
      });
      $("runId").value = r.runId || runId;
      await loadRun(r.runId || runId);
      await Promise.all([loadPendingQueue(), loadCoverage(), loadProjects()]);
    } catch (e) {
      alert("resumeRun failed: " + e.message);
    }
  }

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;","'":"&#39;"}[c]));
  }

  $("runForm").addEventListener("submit", (ev) => {
    ev.preventDefault();
    loadRun($("runId").value.trim());
  });

  function refreshAll() {
    setStatus(bearer ? "ok" : "no token", !bearer);
    if (!bearer) return;
    loadPendingQueue();
    loadCoverage();
    loadProjects();
  }

  // Auto-poll the pending queue every 30s when a token is set.
  // Coverage / projects refresh on the same cadence — they're cheap
  // (single Hyperdrive read each).
  let pollHandle = null;
  function startPoll() {
    if (pollHandle) return;
    pollHandle = setInterval(() => { if (bearer) refreshAll(); }, 30_000);
  }
  startPoll();

  refreshAll();
})();
</script>
</body>
</html>`;

export function renderEmbedHtml(): string {
  return HTML;
}
