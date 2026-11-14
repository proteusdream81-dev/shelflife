#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { buildBase44IdentityMappings, buildMigrationPlan, summarizeMigrationPlan } from "./plan.js";

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

async function main() {
  if (process.argv.includes("--help")) {
    console.log("Usage: node scripts/migration/dry-run.mjs --snapshot <snapshot.json> (--identity-map <verified-links.json> | --base44-principals)");
    console.log("Dry-run only. This tool performs no Firestore writes or deletions.");
    return;
  }

  const snapshotPath = arg("--snapshot");
  const mappingPath = arg("--identity-map");
  const useBase44Principals = process.argv.includes("--base44-principals");
  if (!snapshotPath || (!mappingPath && !useBase44Principals) ||
      (mappingPath && useBase44Principals)) {
    throw new Error("Provide --snapshot and exactly one of --identity-map or --base44-principals. See --help.");
  }

  const snapshotText = await readFile(snapshotPath, "utf8");
  const snapshot = JSON.parse(snapshotText);
  const identityMappings = useBase44Principals
    ? buildBase44IdentityMappings(snapshot?.entities?.User, snapshot?.metadata)
    : JSON.parse(await readFile(mappingPath, "utf8"));

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
