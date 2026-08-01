import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, CanvasError, joinSession } from "@github/copilot-sdk/extension";
import { repositoryRootFromExtensionRoot } from "./repository-path.mjs";
import { createSampleBundle } from "./sample-data.mjs";

const extensionRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = repositoryRootFromExtensionRoot(extensionRoot);
const mediaRoot = join(repositoryRoot, "media");
const require = createRequire(import.meta.url);
const model = require(join(repositoryRoot, "src", "webview", "board-model.js"));
const servers = new Map();
const inlineNonce = "bGVkZ2VyYm9hcmQ";

function createState() {
    return {
        rootName: "LedgerBoard preview",
        ...createSampleBundle(model),
    };
}

function renderHtml() {
    const nonce = "ledgerboard-preview";
    const harnessCss = readFileSync(join(extensionRoot, "harness.css"), "utf8");
    const harnessScript = readFileSync(join(extensionRoot, "harness.js"), "utf8")
        .replaceAll("</script", "<\\/script");
    return readFileSync(join(mediaRoot, "index.html"), "utf8")
        .replaceAll(inlineNonce, nonce)
        .replace("connect-src 'none'", "connect-src 'self'")
        .replace(
            "</head>",
            `    <style nonce="${nonce}">\n${harnessCss}\n    </style>\n  </head>`,
        )
        .replace(
            "<!-- LEDGERBOARD_HOST -->",
            `<script nonce="${nonce}">\n${harnessScript}\n    </script>`,
        );
}

function send(res, status, contentType, body) {
    res.writeHead(status, {
        "Cache-Control": "no-store",
        "Content-Type": contentType,
        "X-Content-Type-Options": "nosniff",
    });
    res.end(body);
}

function sendJson(res, status, value) {
    send(res, status, "application/json; charset=utf-8", JSON.stringify(value));
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        req.on("data", (chunk) => {
            size += chunk.length;
            if (size > 2_000_000) {
                reject(new Error("Request body exceeds the preview limit."));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on("end", () => {
            try {
                resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
            } catch {
                reject(new Error("Request body must be valid JSON."));
            }
        });
        req.on("error", reject);
    });
}

function savePreview(state, request) {
    if (!request?.base) {
        throw new Error("The preview received an empty save request.");
    }
    if (request.saveBoard && state.boardSource !== request.base.boardSource) {
        throw new Error("BOARD.md changed in the preview. Reload before saving.");
    }
    if (request.saveConfig && state.configSource !== request.base.configSource) {
        throw new Error("KANBAN-CONFIG.md changed in the preview. Reload before saving.");
    }

    const nextBoardSource = request.saveBoard ? request.nextBoardSource : state.boardSource;
    const nextConfigSource = request.saveConfig ? request.nextConfigSource : state.configSource;
    const before = model.parseBoard(state.boardSource);
    const after = model.parseBoard(nextBoardSource);
    model.parseConfig(nextConfigSource);
    const events = request.saveBoard
        ? model.diffBoardEvents(before, after, new Date().toISOString())
        : [];
    if (events.length > 0 && state.historySource !== request.base.historySource) {
        throw new Error("KANBAN-HISTORY.md changed in the preview. Reload before saving.");
    }

    const nextHistorySource = model.appendHistory(state.historySource, events);
    model.validateBundleSources(nextBoardSource, nextConfigSource, nextHistorySource);
    state.boardSource = nextBoardSource;
    state.configSource = nextConfigSource;
    state.historySource = nextHistorySource;
    return { ...state, events };
}

function broadcast(entry, event) {
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of entry.clients) {
        client.write(payload);
    }
}

async function handleRequest(entry, req, res) {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    try {
        if (req.method === "GET" && url.pathname === "/") {
            send(res, 200, "text/html; charset=utf-8", renderHtml());
            return;
        }
        if (req.method === "GET" && url.pathname === "/api/state") {
            sendJson(res, 200, entry.state);
            return;
        }
        if (req.method === "GET" && url.pathname === "/events") {
            res.writeHead(200, {
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "Content-Type": "text/event-stream",
            });
            res.write(": connected\n\n");
            entry.clients.add(res);
            req.on("close", () => entry.clients.delete(res));
            return;
        }
        if (req.method === "POST" && url.pathname === "/api/save") {
            const request = await readBody(req);
            sendJson(res, 200, savePreview(entry.state, request));
            return;
        }
        if (req.method === "POST" && url.pathname === "/api/reset") {
            entry.state = createState();
            sendJson(res, 200, entry.state);
            return;
        }
        sendJson(res, 404, { message: "Preview route not found." });
    } catch (error) {
        console.error("LedgerBoard preview request failed:", error);
        sendJson(res, 400, {
            message: "Bad request.",
        });
    }
}

async function startServer(instanceId) {
    const entry = {
        clients: new Set(),
        server: null,
        state: createState(),
        url: "",
    };
    entry.server = createServer((req, res) => {
        void handleRequest(entry, req, res);
    });
    await new Promise((resolve) => entry.server.listen(0, "127.0.0.1", resolve));
    const address = entry.server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    entry.url = `http://127.0.0.1:${port}/`;
    servers.set(instanceId, entry);
    return entry;
}

await joinSession({
    canvases: [
        createCanvas({
            id: "ledgerboard-preview",
            displayName: "LedgerBoard preview",
            description: "Renders the live LedgerBoard webview assets against isolated local sample data.",
            actions: [
                {
                    name: "reset_sample",
                    description: "Reset the preview to its original sample board and notify the open canvas.",
                    handler: async (ctx) => {
                        const entry = servers.get(ctx.instanceId);
                        if (!entry) {
                            throw new CanvasError("preview_not_open", "The LedgerBoard preview is not open.");
                        }
                        entry.state = createState();
                        broadcast(entry, { type: "reset" });
                        return {
                            status: "reset",
                            cards: model.parseBoard(entry.state.boardSource)
                                .columns.flatMap((column) => column.cards).length,
                        };
                    },
                },
                {
                    name: "preview_status",
                    description: "Report the number of tickets, people, labels, and history events in the sandbox.",
                    handler: async (ctx) => {
                        const entry = servers.get(ctx.instanceId);
                        if (!entry) {
                            throw new CanvasError("preview_not_open", "The LedgerBoard preview is not open.");
                        }
                        const validation = model.validateBundleSources(
                            entry.state.boardSource,
                            entry.state.configSource,
                            entry.state.historySource,
                        );
                        return {
                            cards: validation.cardCount,
                            labels: validation.config.entities.length,
                            entities: validation.config.entities.length,
                            people: validation.config.people.length,
                            historyEvents: validation.historyEvents.length,
                        };
                    },
                },
            ],
            open: async (ctx) => {
                const entry = servers.get(ctx.instanceId) || await startServer(ctx.instanceId);
                return {
                    title: "LedgerBoard local preview",
                    status: "Sandbox data",
                    url: entry.url,
                };
            },
            onClose: async (ctx) => {
                const entry = servers.get(ctx.instanceId);
                if (!entry) return;
                servers.delete(ctx.instanceId);
                for (const client of entry.clients) client.end();
                await new Promise((resolve) => entry.server.close(resolve));
            },
        }),
    ],
});
