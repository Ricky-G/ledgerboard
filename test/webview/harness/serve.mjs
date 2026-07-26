import { startHarness } from './server.mjs';

const port = Number(process.env.LEDGERBOARD_HARNESS_PORT ?? 4173);
const harness = await startHarness(port);

process.stdout.write(`LedgerBoard webview harness listening on ${harness.url}\n`);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    void harness.close().then(() => process.exit(0));
  });
}
