/**
 * check-dev-status.js
 * Scans a Figma file for frames/sections whose devStatus is READY_FOR_DEV.
 * Compares against a local cache (.figma-dev-status-cache.json) to detect
 * *newly* ready screens since the last run.
 *
 * Exits with code 0 and prints node IDs to stdout (one per line) when new
 * ready-for-dev screens are found. The GitHub Actions workflow reads this
 * output and passes it to sync-figma-strings.js.
 *
 * Exits with code 2 when nothing changed (workflow skips sync step).
 *
 * Required env vars:
 *   FIGMA_TOKEN   – Personal Access Token
 *   FIGMA_FILE_ID – The file key from the Figma URL
 */

const https = require("https");
const fs = require("fs");

const FIGMA_TOKEN   = process.env.FIGMA_TOKEN;
const FIGMA_FILE_ID = process.env.FIGMA_FILE_ID || "VUWCkyK8dBIgabuXaNnxJK";
const CACHE_FILE    = ".figma-dev-status-cache.json";

if (!FIGMA_TOKEN || !FIGMA_FILE_ID) {
  console.error("❌ Missing FIGMA_TOKEN or FIGMA_FILE_ID");
  process.exit(1);
}

function figmaGet(apiPath) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: "api.figma.com",
      path: `/v1/${apiPath}`,
      headers: { "X-Figma-Token": FIGMA_TOKEN },
    };
    https
      .get(options, (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => resolve(JSON.parse(raw)));
      })
      .on("error", reject);
  });
}

/**
 * Recursively find nodes with devStatus = READY_FOR_DEV.
 * Figma sets this on FRAME and SECTION nodes.
 */
function findReadyNodes(node, found = []) {
  if (
    node.devStatus?.type === "READY_FOR_DEV" &&
    ["FRAME", "SECTION", "COMPONENT"].includes(node.type)
  ) {
    found.push({ id: node.id, name: node.name });
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) findReadyNodes(child, found);
  }
  return found;
}

async function main() {
  console.error(`🔍 Checking dev status for file: ${FIGMA_FILE_ID}`);

  const data = await figmaGet(`files/${FIGMA_FILE_ID}`);
  if (data.err) throw new Error(`Figma API: ${data.err}`);

  const readyNodes = findReadyNodes(data.document);
  console.error(`   Found ${readyNodes.length} READY_FOR_DEV node(s) in Figma`);

  // Load previous cache
  let cache = {};
  if (fs.existsSync(CACHE_FILE)) {
    try {
      cache = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
    } catch (_) {}
  }

  // Detect newly ready nodes (not in cache or previously not ready)
  const newlyReady = readyNodes.filter((n) => !cache[n.id]);

  // Update cache with ALL currently-ready nodes
  const updatedCache = {};
  for (const n of readyNodes) updatedCache[n.id] = { name: n.name, seenAt: new Date().toISOString() };
  fs.writeFileSync(CACHE_FILE, JSON.stringify(updatedCache, null, 2));

  if (newlyReady.length === 0) {
    console.error("   No new READY_FOR_DEV screens since last run. Skipping sync.");
    process.exit(2); // Workflow checks this exit code
  }

  console.error(`\n🚀 ${newlyReady.length} newly-ready screen(s):`);
  for (const n of newlyReady) {
    console.error(`   • ${n.name} (${n.id})`);
  }

  // Print comma-separated IDs to stdout — captured by the workflow
  process.stdout.write(newlyReady.map((n) => n.id).join(","));
}

main().catch((err) => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});
