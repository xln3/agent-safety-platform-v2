/**
 * prepare-datasets.ts
 *
 * One-time script to pre-download all evaluation datasets for offline use.
 * Run before deployment: npx ts-node scripts/prepare-datasets.ts
 */

import { prepareAllDatasets, checkAllDatasetStatus } from '../src/services/datasetService';

async function main(): Promise<void> {
  console.log('=== Dataset Preparation ===\n');

  // Show current status
  const statuses = checkAllDatasetStatus();
  console.log('Current status:');
  for (const s of statuses) {
    const icon = s.ready ? '[OK]' : '[--]';
    console.log(`  ${icon} ${s.benchmark} (${s.source}) — ${s.message}`);
  }
  console.log('');

  // Prepare all
  console.log('Downloading datasets...\n');
  const { success, failed } = await prepareAllDatasets();

  // Report
  console.log('\n=== Results ===');
  if (success.length > 0) {
    console.log(`Success (${success.length}): ${success.join(', ')}`);
  }
  if (failed.length > 0) {
    console.log(`Failed (${failed.length}):`);
    for (const f of failed) {
      console.log(`  - ${f.benchmark}: ${f.error}`);
    }
  }

  // Final status
  console.log('\nFinal status:');
  const finalStatuses = checkAllDatasetStatus();
  for (const s of finalStatuses) {
    const icon = s.ready ? '[OK]' : '[--]';
    console.log(`  ${icon} ${s.benchmark} (${s.source}) — ${s.message}`);
  }

  if (failed.length > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
