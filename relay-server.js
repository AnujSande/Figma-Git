/**
 * relay-server.js
 * ───────────────────────────────────────────────────────────────────────────
 * A lightweight HTTP relay that:
 *   1. Receives POST requests from Figma webhooks (FILE_VERSION_UPDATE)
 *   2. Calls the Figma API to detect which frames are READY_FOR_DEV
 *   3. Fires a `repository_dispatch` to GitHub Actions with the node IDs
 *
 * Deploy for free on Railway, Render, or Fly.io.
 * Set the deployed URL as your Figma webhook endpoint.
 *
 * Required env vars:
 *   WEBHOOK_PASSCODE   – Must match the passcode set in register-figma-webhook.js
 *   FIGMA_TOKEN        – Personal Access Token
 *   GH_PAT             – GitHub PAT with repo scope
 *   GH_OWNER           – GitHub username or org
 *   GH_REPO            – Repository name
 *   PORT               – (optional) defaults to 3000
 * ───────────────────────────────────────────────────────────────────────────
 */

const http = require("http");
const https = require("https");

const PASSCODE = process.env.WEBHOOK_PASSCODE;
const FIGMA_TOKEN = process.env.FIGMA_TOKEN;
const GH_PAT = process.env.GH_PAT;
const GH_OWNER = process.env.GH_OWNER;
const GH_REPO = process.env.GH_REPO;
const PORT = parseInt(process.env.PORT || "3000", 10);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readBody(req) {
  return new Promise((res) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => res(data));
  });
}

function figmaGet(path) {
  return new Promise((resolve, reject) => {
    https
      .get(
        { hostname: "api.figma.com", path: `/v1/${path}`, headers: { "X-Figma-Token": FIGMA_TOKEN } },
        (r) => {
          let d = "";
          r.on("data", (c) => (d += c));
          r.on("end", () => resolve(JSON.parse(d)));
        }
      )
      .on("error", reject);
  });
}

function githubDispatch(payload) {
  const body = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "api.github.com",
        path: `/repos/${GH_OWNER}/${GH_REPO}/dispatches`,
        method: "POST",
        headers: {
          "Authorization": `Bearer ${GH_PAT}`,
          "Accept": "application/vnd.github+json",
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          "User-Agent": "figma-gh-relay",
        },
      },
      (r) => {
        let d = "";
        r.on("data", (c) => (d += c));
        r.on("end", () => resolve({ status: r.statusCode, body: d }));
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function findReadyNodes(node, found = []) {
  if (node.devStatus?.type === "READY_FOR_DEV" && ["FRAME", "SECTION", "COMPONENT"].includes(node.type)) {
    found.push({ id: node.id, name: node.name });
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) findReadyNodes(child, found);
  }
  return found;
}

// ─── HTTP Server ──────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  // Health check
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200);
    return res.end("ok");
  }

  // Figma webhook endpoint
  if (req.method === "POST" && req.url === "/figma-hook") {
    let event;
    try {
      const raw = await readBody(req);
      event = JSON.parse(raw);
    } catch {
      res.writeHead(400);
      return res.end("Bad JSON");
    }

    // Validate passcode
    if (PASSCODE && event.passcode !== PASSCODE) {
      console.warn("⛔ Invalid passcode from", req.socket.remoteAddress);
      res.writeHead(403);
      return res.end("Forbidden");
    }

    // Acknowledge immediately (Figma expects a fast response)
    res.writeHead(200);
    res.end("accepted");

    // Process asynchronously
    try {
      const fileKey = event.file_key;
      if (!fileKey) return;

      console.log(`📩 Figma event: ${event.event_type} for file ${fileKey}`);

      const fileData = await figmaGet(`files/${fileKey}`);
      const readyNodes = findReadyNodes(fileData.document);

      if (readyNodes.length === 0) {
        console.log("   No READY_FOR_DEV nodes found. Not triggering workflow.");
        return;
      }

      const nodeIds = readyNodes.map((n) => n.id).join(",");
      console.log(`   Found ${readyNodes.length} ready node(s): ${nodeIds}`);

      const ghResult = await githubDispatch({
        event_type: "figma-ready-for-dev",
        client_payload: {
          node_ids: nodeIds,
          file_key: fileKey,
          triggered_at: new Date().toISOString(),
        },
      });

      if (ghResult.status === 204) {
        console.log("   ✅ GitHub Actions workflow triggered.");
      } else {
        console.error("   ❌ GitHub dispatch failed:", ghResult.status, ghResult.body);
      }
    } catch (err) {
      console.error("   ❌ Error processing event:", err.message);
    }

    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

server.listen(PORT, () => {
  console.log(`\n🚀 Figma → GitHub relay listening on port ${PORT}`);
  console.log(`   POST /figma-hook  — Figma webhook endpoint`);
  console.log(`   GET  /health      — Health check\n`);
});
