#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { buildMigrationPlan, summarizeMigrationPlan } from "./plan.js";

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

async function main() {
  if (process.argv.includes("--help")) {
    console.log("Usage: node scripts/migration/dry-run.mjs --snapshot <snapshot.json> --identity-map <verified-links.json>");
    console.log("Dry-run only. This tool performs no Firestore writes or deletions.");
    return;
  }

  const snapshotPath = arg("--snapshot");
  const mappingPath = arg("--identity-map");
  if (!snapshotPath || !mappingPath) {
    throw new Error("Both --snapshot and --identity-map are required. See --help.");
  }

  const [snapshotText, mappingText] = await Promise.all([
    readFile(snapshotPath, "utf8"),
    readFile(mappingPath, "utf8"),
  ]);
  const snapshot = JSON.parse(snapshotText);
  const identityMappings = JSON.parse(mappingText);

  const plan = buildMigrationPlan({
    snapshot,
    identityMappings,
    waitlistEmailKey: process.env.SHELFLIFE_MIGRATION_WAITLIST_HMAC_KEY || null,
  });
  const summary = summarizeMigrationPlan(plan);
  console.log(JSON.stringify(summary, null, 2));

  // Readiness includes identity coverage and actor-history completeness, not only
  // record quarantine. Never announce rehearsal readiness while any gate is open.
  if (summary.readyForRehearsal !== true) {
    const blockers = summary.readinessBlockers.length > 0
      ? summary.readinessBlockers.join(", ")
      : "migration plan contains no documents";
    console.error(`Migration blocked: ${blockers}.`);
    process.exitCode = 2;
  } else {
    console.log("Plan is structurally ready for a separately approved non-production rehearsal.");
    console.log("No writes performed. Applying a plan is not implemented by this command.");
  }
}

main().catch((error) => {
  console.error(`Migration dry-run failed: ${error.message}`);
  process.exitCode = 1;
});
