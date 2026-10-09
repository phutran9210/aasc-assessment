import { assertMockMode, demoOptionsFromEnvironment } from './demo-environment.js';
import { runDemo } from './demo-flow.js';

async function main(): Promise<void> {
  assertMockMode();
  const summary = await runDemo(demoOptionsFromEnvironment(), (line) => console.log(line));
  console.log(
    JSON.stringify(
      {
        lead: { id: summary.lead.id, bitrixLeadId: summary.lead.bitrixLeadId },
        deal: {
          id: summary.deal.id,
          bitrixDealId: summary.deal.bitrixDealId,
          stage: summary.deal.stageSemantics,
        },
        exports: summary.exports,
      },
      null,
      2,
    ),
  );
}

void main().catch((error: unknown) => {
  console.error(`Demo failed: ${error instanceof Error ? error.message : 'unknown error'}`);
  process.exitCode = 1;
});
