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

  const plan = buildMigrationPlan({ snapshot, identityMappings });
  console.log(JSON.stringify(summarizeMigrationPlan(plan), null, 2));

  if (plan.quarantined.length > 0) {
    console.error("Migration blocked: quarantined records require owner/reference reconciliation.");
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
