/**
 * Static webview harness.
 *
 * Serves the generated self-contained `media/index.html` with an in-browser
 * `acquireVsCodeApi` stub injected. Every page
 * load gets its own fresh copy of the fixture bundle held in browser memory,
 * so specs never share state and can run in parallel.
 */

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SCENARIOS, createBundle } from './bundle.mjs';

const harnessRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = join(harnessRoot, '..', '..', '..');
const mediaRoot = join(repositoryRoot, 'media');
const require = createRequire(import.meta.url);
const model = require(join(repositoryRoot, 'src', 'webview', 'board-model.js'));

const NONCE = 'ledgerboard-webview-harness';
const INLINE_NONCE = 'bGVkZ2VyYm9hcmQ';

function renderHtml(scenario) {
  const template = readFileSync(join(mediaRoot, 'index.html'), 'utf8');
  if (scenario === 'standalone') {
    return template;
  }
  const bundle = createBundle(model, scenario);
  const bundleTag = `<script type="application/json" id="harnessBundle" nonce="${NONCE}">`
    + `${JSON.stringify(bundle).replaceAll('<', '\\u003c')}</script>`;
  const clientSource = readFileSync(join(harnessRoot, 'client.js'), 'utf8')
    .replaceAll('</script', '<\\/script');
  const clientTag = `<script nonce="${NONCE}">\n${clientSource}\n</script>`;

  return template
    .replaceAll(INLINE_NONCE, NONCE)
    .replace('<!-- LEDGERBOARD_HOST -->', `${bundleTag}\n    ${clientTag}`);
}

function send(res, status, contentType, body) {
  res.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': contentType,
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

function handleRequest(req, res) {
  try {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/' || url.pathname === '/index.html') {
      const requested = url.searchParams.has('standalone')
        ? 'standalone'
        : (url.searchParams.get('scenario') ?? 'default');
      const scenario = SCENARIOS.includes(requested) ? requested : 'default';
      send(res, 200, 'text/html; charset=utf-8', renderHtml(requested === 'standalone' ? requested : scenario));
      return;
    }
    send(res, 404, 'text/plain; charset=utf-8', 'Not found');
  } catch (error) {
    console.error('Harness request failed:', error?.stack ?? error);
    send(res, 500, 'text/plain; charset=utf-8', 'Internal server error');
  }
}

/** Start the harness on `port` (0 picks a free port) and resolve its base URL. */
export async function startHarness(port = 0) {
  const server = createServer(handleRequest);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  const address = server.address();
  const boundPort = typeof address === 'object' && address ? address.port : port;
  return {
    url: `http://127.0.0.1:${boundPort}/`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
