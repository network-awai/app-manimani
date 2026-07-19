/**
 * manimani kotoba — barrel. Personal knowledge router, E2E-split: aggregate
 * coverage snapshot plaintext + intake/artifact private content sealed via
 * kotoba E2E (ADR-2605181100). LLM classification/processing inference stays
 * etzhayyim (consent-capability); resulting artifact DATA migrates here (E2E).
 */
export * from "./types.js";
export {
  recordSnapshot,
  listSnapshots,
  getSnapshot,
  recordIntake,
  listIntakes,
  getIntake,
  recordArtifact,
  listArtifacts,
  coverage,
} from "./registry.js";
