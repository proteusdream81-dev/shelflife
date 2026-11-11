import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

function runDryRun({ includeActorMessages }) {
  const directory = mkdtempSync(join(tmpdir(), "shelflife-migration-dry-run-"));
  try {
    const snapshot = {
      metadata: {
        snapshotId: "dry-run-test",
        exportedAt: "2026-11-10T00:00:00.000Z",
        consistent: true,
        ...(includeActorMessages ? {
          actorHistoryExport: {
            complete: true,
            writeQuiesced: true,
            retentionLimitPerRoom: 300,
            messageCount: 0,
            enumeratedGroupIds: [],
            exportedAt: "2026-11-10T00:00:00.000Z",
            exportedBy: "test-operator",
            exporterVersion: "1.0.0",
          },
        } : {}),
      },
      entities: {
        AccountDeletionRequest: [], Block: [], Book: [], BookGroup: [],
        BookSearchCache: [], ClubSearchCache: [], Comment: [], Follow: [],
        GroupInvite: [], PlacesCache: [], RateLimitHit: [], ReaderSearch: [],
        ReleaseReminder: [], Report: [], Shelf: [],
        User: [{ id: "legacy-reader", full_name: "Reader" }],
        Waitlist: [], WaitlistAttempt: [],
      },
      ...(includeActorMessages ? { actorMessages: [] } : {}),
    };
    const mappings = [{
      base44UserId: "legacy-reader",
      firebaseUid: "firebase-reader",
      status: "verified",
      proofMethod: "operator-verified",
      verifiedAt: "2026-11-10T00:00:00.000Z",
      verifiedBy: "test-operator",
    }];
    const snapshotPath = join(directory, "snapshot.json");
    const mappingPath = join(directory, "identity-map.json");
    writeFileSync(snapshotPath, JSON.stringify(snapshot));
    writeFileSync(mappingPath, JSON.stringify(mappings));
    return spawnSync(process.execPath, [
      "scripts/migration/dry-run.mjs",
      "--snapshot", snapshotPath,
      "--identity-map", mappingPath,
    ], { encoding: "utf8" });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("dry-run blocks rehearsal readiness when actor history is missing even without quarantined records", () => {
  const result = runDryRun({ includeActorMessages: false });
  assert.equal(result.status, 2);
  assert.match(result.stdout, /"readyForRehearsal": false/);
  assert.match(result.stderr, /actor-history-export-missing/);
  assert.doesNotMatch(result.stdout, /structurally ready for a separately approved/);
});

test("dry-run reports readiness only when all planner gates pass", () => {
  const result = runDryRun({ includeActorMessages: true });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /"readyForRehearsal": true/);
  assert.match(result.stdout, /structurally ready for a separately approved non-production rehearsal/);
});