/**
 * manimani kotoba — registry.
 *
 * Plaintext path (coverageSnapshot): sdk.write / sdk.read — public aggregate
 * counters, no user content.
 * E2E path (intake + artifact): sdk.encryptedWrite / sdk.encryptedRead — private
 * user fragments + derived content sealed in the kotoba envelope
 * (ADR-2605181100), read-cap = owner DID. The substrate never sees plaintext
 * rawText / project titles / derived artifacts.
 *
 * LLM classification / processing INFERENCE stays etzhayyim (consent-capability); the
 * resulting artifact DATA migrates here (E2E).
 */

import type { Etzhayyim } from "@etzhayyim/sdk";
import {
  ARTIFACT_INNER_TYPE,
  COVERAGE_COLLECTION,
  INTAKE_INNER_TYPE,
  artifactRkey,
  intakeRkey,
  isProjectKind,
  isSensitivityOrd,
  isSourceKind,
  isUint,
  isWindowDays,
  snapshotDidFor,
  snapshotRkey,
  type ArtifactBody,
  type ArtifactView,
  type CoverageInput,
  type CoverageOutput,
  type CoverageSnapshotRecord,
  type CoverageSnapshotView,
  type GetIntakeInput,
  type GetIntakeOutput,
  type GetSnapshotInput,
  type GetSnapshotOutput,
  type IntakeBody,
  type IntakeView,
  type ListArtifactsInput,
  type ListArtifactsOutput,
  type ListIntakesInput,
  type ListIntakesOutput,
  type ListSnapshotsInput,
  type ListSnapshotsOutput,
  type RecordArtifactInput,
  type RecordArtifactOutput,
  type RecordIntakeInput,
  type RecordIntakeOutput,
  type RecordSnapshotInput,
  type RecordSnapshotOutput,
} from "./types.js";

const PAGE_LIMIT = 100;
const DEFAULT_MAX_SCAN = 10_000;

// ─── Coverage snapshot (PLAINTEXT) ──────────────────────────────────

export async function recordSnapshot(e: Etzhayyim, input: RecordSnapshotInput): Promise<RecordSnapshotOutput> {
  if (!input.snapshotId) return { status: "rejected", error: "missingRequiredFields" };
  if (!isUint(input.intakeCount) || !isUint(input.projectCount) || !isUint(input.artifactCount)) {
    return { status: "rejected", error: "invalidCount" };
  }
  const windowDays = input.windowDays ?? 7;
  if (!isWindowDays(windowDays)) return { status: "rejected", error: "invalidWindowDays" };
  const rkey = snapshotRkey(input.snapshotId);
  const existing = await e
    .read<CoverageSnapshotRecord>({ collection: COVERAGE_COLLECTION, rkey })
    .catch(() => ({ records: [] }));
  if (existing.records[0]?.value) {
    return {
      status: "alreadyExists",
      snapshotUri: existing.records[0].uri,
      did: existing.records[0].value.did,
      snapshotId: input.snapshotId,
    };
  }
  const now = new Date().toISOString();
  const did = snapshotDidFor(input.snapshotId);
  const record: CoverageSnapshotRecord = {
    did,
    snapshotId: input.snapshotId,
    intakeCount: input.intakeCount,
    projectCount: input.projectCount,
    artifactCount: input.artifactCount,
    windowDays,
    generatedAt: input.generatedAt ?? now,
    createdAt: now,
  };
  const receipt = await e.write({ collection: COVERAGE_COLLECTION, record: record as unknown as Record<string, unknown>, rkey });
  return { status: "recorded", snapshotUri: receipt.uri, did, snapshotId: input.snapshotId };
}

export async function listSnapshots(e: Etzhayyim, input: ListSnapshotsInput = {}): Promise<ListSnapshotsOutput> {
  const limit = Math.min(input.limit ?? 50, 200);
  const resp = await e.read<CoverageSnapshotRecord>({ collection: COVERAGE_COLLECTION, cursor: input.cursor, limit });
  const items: CoverageSnapshotView[] = resp.records
    .filter((r) => input.windowDays === undefined || r.value.windowDays === input.windowDays)
    .map((r) => ({ ...r.value, snapshotUri: r.uri }));
  return { items, cursor: resp.cursor, total: items.length };
}

export async function getSnapshot(e: Etzhayyim, input: GetSnapshotInput): Promise<GetSnapshotOutput> {
  if (!input.snapshotId) return { error: "invalidSnapshotId" };
  const rkey = snapshotRkey(input.snapshotId);
  const resp = await e
    .read<CoverageSnapshotRecord>({ collection: COVERAGE_COLLECTION, rkey })
    .catch(() => ({ records: [] }));
  const hit = resp.records[0];
  if (!hit?.value) return { error: "notFound" };
  return { snapshot: { ...hit.value, snapshotUri: hit.uri } };
}

// ─── Intake (E2E-ENCRYPTED, PII / private fragment) ─────────────────

export async function recordIntake(e: Etzhayyim, input: RecordIntakeInput): Promise<RecordIntakeOutput> {
  if (!input.intakeId || !input.projectSlug || !input.projectTitle) return { status: "rejected", error: "missingRequiredFields" };
  if (!isSourceKind(input.sourceKind)) return { status: "rejected", error: "invalidSourceKind" };
  if (!isProjectKind(input.projectKind)) return { status: "rejected", error: "invalidProjectKind" };
  if (input.sourceKind === "text" && !input.rawText) return { status: "rejected", error: "missingRawText" };
  if (input.sourceKind !== "text" && !input.sourceUri) return { status: "rejected", error: "missingSourceUri" };
  const sensitivityOrd = input.sensitivityOrd ?? 2;
  if (!isSensitivityOrd(sensitivityOrd)) return { status: "rejected", error: "invalidSensitivityOrd" };
  const body: IntakeBody = {
    intakeId: input.intakeId,
    sourceKind: input.sourceKind,
    rawText: input.rawText,
    sourceUri: input.sourceUri,
    lang: input.lang,
    sensitivityOrd,
    projectSlug: input.projectSlug,
    projectTitle: input.projectTitle,
    projectKind: input.projectKind,
    ingestedAt: input.ingestedAt ?? new Date().toISOString(),
  };
  const receipt = await e.encryptedWrite<Record<string, unknown>>({
    innerType: INTAKE_INNER_TYPE,
    record: body as unknown as Record<string, unknown>,
    recipients: input.recipients ?? [],
    rkey: intakeRkey(input.intakeId),
  });
  return { status: "recorded", uri: receipt.uri, keyId: receipt.keyId, intakeId: input.intakeId };
}

async function scanIntakes(e: Etzhayyim, maxScan: number): Promise<IntakeView[]> {
  const out: IntakeView[] = [];
  let cursor: string | undefined;
  while (out.length < maxScan) {
    const page = await e.encryptedRead<IntakeBody>({ innerType: INTAKE_INNER_TYPE, cursor, limit: PAGE_LIMIT });
    for (const r of page.records) {
      out.push({ ...r.value, uri: r.uri, sender: r.sender, createdAt: r.createdAt });
    }
    if (!page.cursor || page.records.length === 0) break;
    cursor = page.cursor;
  }
  return out;
}

export async function listIntakes(e: Etzhayyim, input: ListIntakesInput = {}): Promise<ListIntakesOutput> {
  const limit = Math.min(input.limit ?? 50, 200);
  const all = await scanIntakes(e, DEFAULT_MAX_SCAN);
  const filtered = all.filter(
    (i) =>
      (!input.projectSlug || i.projectSlug === input.projectSlug) &&
      (!input.projectKind || i.projectKind === input.projectKind),
  );
  return { items: filtered.slice(0, limit), total: filtered.length };
}

export async function getIntake(e: Etzhayyim, input: GetIntakeInput): Promise<GetIntakeOutput> {
  if (!input.intakeId) return { error: "invalidIntakeId" };
  const all = await scanIntakes(e, DEFAULT_MAX_SCAN);
  const found = all.find((i) => i.intakeId === input.intakeId);
  if (!found) return { error: "notFound" };
  return { intake: found };
}

// ─── Artifact (E2E-ENCRYPTED, derived private content) ──────────────

export async function recordArtifact(e: Etzhayyim, input: RecordArtifactInput): Promise<RecordArtifactOutput> {
  if (!input.artifactId || !input.intakeId) return { status: "rejected", error: "missingRequiredFields" };
  const validKinds = ["facts_jsonl", "todos_jsonl", "summary_text", "raw_passthrough", "error"];
  if (!validKinds.includes(input.artifactKind)) return { status: "rejected", error: "invalidArtifactKind" };
  if (typeof input.content !== "string") return { status: "rejected", error: "invalidContent" };
  const body: ArtifactBody = {
    artifactId: input.artifactId,
    intakeId: input.intakeId,
    artifactKind: input.artifactKind,
    content: input.content,
    modelId: input.modelId,
    errorText: input.errorText,
    producedAt: input.producedAt ?? new Date().toISOString(),
  };
  const receipt = await e.encryptedWrite<Record<string, unknown>>({
    innerType: ARTIFACT_INNER_TYPE,
    record: body as unknown as Record<string, unknown>,
    recipients: input.recipients ?? [],
    rkey: artifactRkey(input.artifactId),
  });
  return { status: "recorded", uri: receipt.uri, keyId: receipt.keyId, artifactId: input.artifactId };
}

async function scanArtifacts(e: Etzhayyim, maxScan: number): Promise<ArtifactView[]> {
  const out: ArtifactView[] = [];
  let cursor: string | undefined;
  while (out.length < maxScan) {
    const page = await e.encryptedRead<ArtifactBody>({ innerType: ARTIFACT_INNER_TYPE, cursor, limit: PAGE_LIMIT });
    for (const r of page.records) {
      out.push({ ...r.value, uri: r.uri, sender: r.sender, createdAt: r.createdAt });
    }
    if (!page.cursor || page.records.length === 0) break;
    cursor = page.cursor;
  }
  return out;
}

export async function listArtifacts(e: Etzhayyim, input: ListArtifactsInput = {}): Promise<ListArtifactsOutput> {
  const limit = Math.min(input.limit ?? 50, 200);
  const all = await scanArtifacts(e, DEFAULT_MAX_SCAN);
  const filtered = all.filter(
    (a) =>
      (!input.intakeId || a.intakeId === input.intakeId) &&
      (!input.artifactKind || a.artifactKind === input.artifactKind),
  );
  return { items: filtered.slice(0, limit), total: filtered.length };
}

// ─── Coverage rollup ────────────────────────────────────────────────

export async function coverage(e: Etzhayyim, input: CoverageInput = {}): Promise<CoverageOutput> {
  const maxScan = Math.min(input.maxScan ?? DEFAULT_MAX_SCAN, DEFAULT_MAX_SCAN);
  let coverageSnapshotCount = 0;
  let cursor: string | undefined;
  while (coverageSnapshotCount < maxScan) {
    const page = await e.read<CoverageSnapshotRecord>({ collection: COVERAGE_COLLECTION, cursor, limit: PAGE_LIMIT });
    coverageSnapshotCount += page.records.length;
    if (!page.cursor || page.records.length < PAGE_LIMIT) break;
    cursor = page.cursor;
  }
  const intakes = await scanIntakes(e, maxScan);
  const artifacts = await scanArtifacts(e, maxScan);
  const intakesByKind: Record<string, number> = {};
  for (const i of intakes) intakesByKind[i.projectKind] = (intakesByKind[i.projectKind] ?? 0) + 1;
  const artifactsByKind: Record<string, number> = {};
  for (const a of artifacts) artifactsByKind[a.artifactKind] = (artifactsByKind[a.artifactKind] ?? 0) + 1;
  return {
    coverageSnapshotCount,
    intakeCount: intakes.length,
    artifactCount: artifacts.length,
    intakesByKind,
    artifactsByKind,
    truncated: coverageSnapshotCount >= maxScan || intakes.length >= maxScan || artifacts.length >= maxScan,
  };
}
