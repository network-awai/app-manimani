/**
 * manimani kotoba — personal knowledge router. E2E-split per founder directive
 * 2026-06-03 (PII / private content migrate when E2E-safe) + ADR-2605181100
 * (kotoba E2E encrypted-record envelope) + ADR-2606011400 (Consensys) +
 * ADR-2605291100 (kotoba-native reconciliation, manimani non-federable default).
 *
 * SPLIT:
 *   PUBLIC (plaintext AT records) — aggregate coverage snapshot: per-actor
 *   counters (intakes / projects / artifacts by kind / status). NO titles, NO
 *   raw content, NO subject text. Frontable open aggregate metadata, mirrors
 *   the real `com.etzhayyim.apps.manimani.coverage` surface.
 *
 *   SENSITIVE / PII (kotoba E2E, com.etzhayyim.encrypted.record):
 *     - intake (rawText + project slug/title + sensitivityOrd up to 3=PII Tier3)
 *       — the user's scattered private fragments. The app is atStandard:false /
 *       non-federable; project titles are user-authored personal content ("OKR
 *       Q3" … medical / legal). Sealed via sdk.encryptedWrite, read-cap = owner
 *       DID. The substrate never sees plaintext.
 *     - artifact (extracted facts / todos / summary content) — derived private
 *       content, same E2E envelope.
 *
 *   STAYS etzhayyim (consumed via consent-capability) — LLM classification /
 *   processing INFERENCE execution (extract_facts / expand_todo / summarize via
 *   Anthropic / vLLM / Murakumo LiteLLM). The regulated GPU/LLM inference *act*,
 *   not the resulting data — the artifact DATA migrates (E2E).
 *
 * AT-Lexicon: no float — sensitivityOrd + all counts are integers.
 */

// Plaintext public aggregate collection.
export const COVERAGE_COLLECTION = "com.etzhayyim.apps.manimani.coverageSnapshot";
// E2E inner-type NSIDs (body shape inside the encrypted envelope).
export const INTAKE_INNER_TYPE = "com.etzhayyim.apps.manimani.intake";
export const ARTIFACT_INNER_TYPE = "com.etzhayyim.apps.manimani.artifact";

export const MANIMANI_DID_PREFIX = "did:web:manimani.etzhayyim.com:" as const;

export type ProjectKind = "knowledge" | "task" | "memo" | "unsorted";
export type SourceKind = "text" | "url" | "file_ref";
export type ArtifactKind =
  | "facts_jsonl"
  | "todos_jsonl"
  | "summary_text"
  | "raw_passthrough"
  | "error";

export const PROJECT_KINDS: readonly ProjectKind[] = ["knowledge", "task", "memo", "unsorted"];

// ─── Coverage snapshot (PLAINTEXT, public aggregate) ────────────────

export interface CoverageSnapshotRecord {
  did: string;
  snapshotId: string;
  /** Total intakes counted in this snapshot. */
  intakeCount: number;
  /** Total projects counted in this snapshot. */
  projectCount: number;
  /** Total artifacts counted in this snapshot. */
  artifactCount: number;
  /** windowDays the snapshot summarizes (1-90). */
  windowDays: number;
  generatedAt: string;
  createdAt: string;
}
export interface CoverageSnapshotView extends CoverageSnapshotRecord {
  snapshotUri: string;
}
export interface RecordSnapshotInput {
  snapshotId: string;
  intakeCount: number;
  projectCount: number;
  artifactCount: number;
  windowDays?: number;
  generatedAt?: string;
}
export interface RecordSnapshotOutput {
  status: "recorded" | "alreadyExists" | "rejected";
  snapshotUri?: string;
  did?: string;
  snapshotId?: string;
  error?: string;
}
export interface ListSnapshotsInput {
  windowDays?: number;
  limit?: number;
  cursor?: string;
}
export interface ListSnapshotsOutput {
  items: CoverageSnapshotView[];
  cursor?: string;
  total: number;
}
export interface GetSnapshotInput {
  snapshotId: string;
}
export interface GetSnapshotOutput {
  snapshot?: CoverageSnapshotView;
  error?: string;
}

// ─── Intake (E2E-ENCRYPTED, PII / private fragment) ─────────────────

export interface IntakeBody {
  intakeId: string;
  sourceKind: SourceKind;
  /** Raw user-supplied content (text) — private. */
  rawText?: string;
  /** http(s):// for url, b2:// for file_ref. */
  sourceUri?: string;
  lang?: string;
  /** integer 0-3: 0=public 1=internal 2=private 3=PII Tier3. */
  sensitivityOrd: number;
  /** project the intake is bound to — slug + title are user-authored content. */
  projectSlug: string;
  projectTitle: string;
  projectKind: ProjectKind;
  ingestedAt: string;
}
export interface IntakeView extends IntakeBody {
  uri: string;
  sender: string;
  createdAt: string;
}
export interface RecordIntakeInput {
  intakeId: string;
  sourceKind: SourceKind;
  rawText?: string;
  sourceUri?: string;
  lang?: string;
  sensitivityOrd?: number;
  projectSlug: string;
  projectTitle: string;
  projectKind: ProjectKind;
  ingestedAt?: string;
  /** Extra DIDs to grant read-cap (owner always included). */
  recipients?: string[];
}
export interface RecordIntakeOutput {
  status: "recorded" | "rejected";
  uri?: string;
  keyId?: string;
  intakeId?: string;
  error?: string;
}
export interface ListIntakesInput {
  projectSlug?: string;
  projectKind?: ProjectKind;
  limit?: number;
  cursor?: string;
}
export interface ListIntakesOutput {
  items: IntakeView[];
  cursor?: string;
  total: number;
}
export interface GetIntakeInput {
  intakeId: string;
}
export interface GetIntakeOutput {
  intake?: IntakeView;
  error?: string;
}

// ─── Artifact (E2E-ENCRYPTED, derived private content) ──────────────

export interface ArtifactBody {
  artifactId: string;
  intakeId: string;
  artifactKind: ArtifactKind;
  /** Derived content (facts jsonl / todos jsonl / summary / passthrough). */
  content: string;
  modelId?: string;
  errorText?: string;
  producedAt: string;
}
export interface ArtifactView extends ArtifactBody {
  uri: string;
  sender: string;
  createdAt: string;
}
export interface RecordArtifactInput {
  artifactId: string;
  intakeId: string;
  artifactKind: ArtifactKind;
  content: string;
  modelId?: string;
  errorText?: string;
  producedAt?: string;
  recipients?: string[];
}
export interface RecordArtifactOutput {
  status: "recorded" | "rejected";
  uri?: string;
  keyId?: string;
  artifactId?: string;
  error?: string;
}
export interface ListArtifactsInput {
  intakeId?: string;
  artifactKind?: ArtifactKind;
  limit?: number;
  cursor?: string;
}
export interface ListArtifactsOutput {
  items: ArtifactView[];
  cursor?: string;
  total: number;
}

// ─── Coverage rollup ────────────────────────────────────────────────

export interface CoverageInput {
  maxScan?: number;
}
export interface CoverageOutput {
  coverageSnapshotCount?: number;
  intakeCount?: number;
  artifactCount?: number;
  intakesByKind?: Record<string, number>;
  artifactsByKind?: Record<string, number>;
  truncated?: boolean;
  error?: string;
}

// ─── Validation + helpers ───────────────────────────────────────────

export function isUint(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0;
}
export function isSensitivityOrd(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 3;
}
export function isWindowDays(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 90;
}
export function isProjectKind(k: unknown): k is ProjectKind {
  return typeof k === "string" && (PROJECT_KINDS as readonly string[]).includes(k);
}
export function isSourceKind(k: unknown): k is SourceKind {
  return k === "text" || k === "url" || k === "file_ref";
}
export function snapshotDidFor(id: string): string {
  return `${MANIMANI_DID_PREFIX}snap:${id.toLowerCase()}`;
}
function slug(id: string): string {
  return id.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}
export function snapshotRkey(id: string): string {
  return `snap-${slug(id)}`;
}
export function intakeRkey(id: string): string {
  return `intake-${slug(id)}`;
}
export function artifactRkey(id: string): string {
  return `artifact-${slug(id)}`;
}
