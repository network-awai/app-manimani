import { describe, it, expect, beforeEach } from "vitest";
import { MockEtzhayyim } from "@etzhayyim/sdk-mock";
import {
  recordSnapshot,
  listSnapshots,
  getSnapshot,
  recordIntake,
  listIntakes,
  getIntake,
  recordArtifact,
  listArtifacts,
  coverage,
} from "../src/index.js";

const OWNER = "did:web:manimani.etzhayyim.com";

describe("manimani kotoba (personal knowledge router, E2E-split)", () => {
  let e: any;
  beforeEach(() => {
    e = new MockEtzhayyim({ did: OWNER });
  });

  describe("coverageSnapshot (PLAINTEXT public aggregate)", () => {
    it("records, dedups, validates, lists/filters, gets", async () => {
      expect((await recordSnapshot(e, { snapshotId: "s1", intakeCount: 12, projectCount: 3, artifactCount: 9, windowDays: 7 })).status).toBe("recorded");
      expect((await recordSnapshot(e, { snapshotId: "s1", intakeCount: 12, projectCount: 3, artifactCount: 9, windowDays: 7 })).status).toBe("alreadyExists");
      expect((await recordSnapshot(e, { snapshotId: "sX", intakeCount: -1, projectCount: 0, artifactCount: 0 })).status).toBe("rejected");
      expect((await recordSnapshot(e, { snapshotId: "sW", intakeCount: 0, projectCount: 0, artifactCount: 0, windowDays: 999 })).status).toBe("rejected");
      await recordSnapshot(e, { snapshotId: "s2", intakeCount: 5, projectCount: 1, artifactCount: 4, windowDays: 30 });
      expect((await listSnapshots(e)).total).toBe(2);
      expect((await listSnapshots(e, { windowDays: 7 })).total).toBe(1);
      const got = await getSnapshot(e, { snapshotId: "s1" });
      expect(got.snapshot?.intakeCount).toBe(12);
      expect(got.snapshot?.snapshotUri).toBeTruthy();
      expect((await getSnapshot(e, { snapshotId: "nope" })).error).toBe("notFound");
    });
  });

  describe("intake (E2E-ENCRYPTED, private fragment)", () => {
    it("seals via encryptedWrite, round-trips via encryptedRead, validates", async () => {
      const ok = await recordIntake(e, {
        intakeId: "i1",
        sourceKind: "text",
        rawText: "TODO: review the Q3 OKR draft by Friday and ping Alice",
        lang: "ja",
        sensitivityOrd: 2,
        projectSlug: "okr-q3",
        projectTitle: "OKR Q3",
        projectKind: "task",
      });
      expect(ok.status).toBe("recorded");
      expect(ok.keyId).toBeTruthy();
      // sensitivityOrd out of range (>3)
      expect((await recordIntake(e, { intakeId: "iX", sourceKind: "text", rawText: "x", sensitivityOrd: 7, projectSlug: "p", projectTitle: "P", projectKind: "memo" })).status).toBe("rejected");
      // text without rawText
      expect((await recordIntake(e, { intakeId: "iY", sourceKind: "text", projectSlug: "p", projectTitle: "P", projectKind: "memo" })).status).toBe("rejected");
      // url without sourceUri
      expect((await recordIntake(e, { intakeId: "iZ", sourceKind: "url", projectSlug: "p", projectTitle: "P", projectKind: "knowledge" })).status).toBe("rejected");
      const got = await getIntake(e, { intakeId: "i1" });
      expect(got.intake?.rawText).toBe("TODO: review the Q3 OKR draft by Friday and ping Alice");
      expect(got.intake?.projectTitle).toBe("OKR Q3");
      expect(got.intake?.sensitivityOrd).toBe(2);
      await recordIntake(e, { intakeId: "i2", sourceKind: "url", sourceUri: "https://example.com/a", projectSlug: "reading", projectTitle: "Reading", projectKind: "knowledge" });
      expect((await listIntakes(e)).total).toBe(2);
      expect((await listIntakes(e, { projectSlug: "okr-q3" })).total).toBe(1);
      expect((await listIntakes(e, { projectKind: "knowledge" })).total).toBe(1);
    });

    it("enforces read-cap: a non-recipient DID cannot decrypt the intake", async () => {
      await recordIntake(e, { intakeId: "i1", sourceKind: "text", rawText: "private medical note", sensitivityOrd: 3, projectSlug: "health", projectTitle: "Health", projectKind: "memo" });
      // A distinct actor (no read-cap) sees zero intakes — isolation by owner DID.
      const outsider: any = new MockEtzhayyim({ did: "did:web:outsider.example" });
      expect((await listIntakes(outsider)).total).toBe(0);
    });

    it("grants read-cap to an explicit recipient", async () => {
      const partner = "did:web:partner.example";
      const r = await recordIntake(e, { intakeId: "i1", sourceKind: "text", rawText: "shared note", sensitivityOrd: 1, projectSlug: "shared", projectTitle: "Shared", projectKind: "knowledge", recipients: [partner] });
      expect(r.status).toBe("recorded");
      expect((await listIntakes(e)).total).toBe(1);
    });
  });

  describe("artifact (E2E-ENCRYPTED, derived private content)", () => {
    it("seals derived content, round-trips, filters by intake/kind", async () => {
      const ok = await recordArtifact(e, { artifactId: "a1", intakeId: "i1", artifactKind: "todos_jsonl", content: '{"todo":"review OKR"}', modelId: "m-balanced" });
      expect(ok.status).toBe("recorded");
      expect(ok.keyId).toBeTruthy();
      expect((await recordArtifact(e, { artifactId: "aX", intakeId: "i1", artifactKind: "bogus" as any, content: "x" })).status).toBe("rejected");
      await recordArtifact(e, { artifactId: "a2", intakeId: "i2", artifactKind: "summary_text", content: "a short summary" });
      expect((await listArtifacts(e)).total).toBe(2);
      expect((await listArtifacts(e, { intakeId: "i1" })).total).toBe(1);
      expect((await listArtifacts(e, { artifactKind: "summary_text" })).total).toBe(1);
      const items = (await listArtifacts(e, { intakeId: "i1" })).items;
      expect(items[0]?.content).toBe('{"todo":"review OKR"}');
    });
  });

  describe("coverage rollup", () => {
    it("counts plaintext snapshots + E2E intakes + E2E artifacts", async () => {
      await recordSnapshot(e, { snapshotId: "s1", intakeCount: 2, projectCount: 1, artifactCount: 2, windowDays: 7 });
      await recordIntake(e, { intakeId: "i1", sourceKind: "text", rawText: "fragment one", sensitivityOrd: 2, projectSlug: "p", projectTitle: "P", projectKind: "knowledge" });
      await recordIntake(e, { intakeId: "i2", sourceKind: "text", rawText: "fragment two", sensitivityOrd: 2, projectSlug: "p", projectTitle: "P", projectKind: "task" });
      await recordArtifact(e, { artifactId: "a1", intakeId: "i1", artifactKind: "facts_jsonl", content: "{}" });
      const cov = await coverage(e);
      expect(cov.coverageSnapshotCount).toBe(1);
      expect(cov.intakeCount).toBe(2);
      expect(cov.artifactCount).toBe(1);
      expect(cov.intakesByKind?.knowledge).toBe(1);
      expect(cov.intakesByKind?.task).toBe(1);
      expect(cov.artifactsByKind?.facts_jsonl).toBe(1);
    });
  });
});
