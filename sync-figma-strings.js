/**
 * sync-figma-strings.js
 * Fetches all text nodes from a Figma screen and writes them
 * as a sorted key-value JSON file.
 *
 * Required env vars:
 *   FIGMA_TOKEN    – Personal Access Token from Figma settings
 *   FIGMA_FILE_ID  – The file key from the Figma URL
 *   FIGMA_NODE_IDS – Comma-separated node IDs of the screens to sync
 *   OUTPUT_PATH    – Where to write the JSON (default: strings/en.json)
 */

const https = require("https");
const fs = require("fs");
const path = require("path");

const FIGMA_TOKEN   = process.env.FIGMA_TOKEN;
const FIGMA_FILE_ID = process.env.FIGMA_FILE_ID  || "VUWCkyK8dBIgabuXaNnxJK";
const FIGMA_NODE_IDS= process.env.FIGMA_NODE_IDS || "1042:55597";
const OUTPUT_PATH   = process.env.OUTPUT_PATH    || "strings/en.json";

if (!FIGMA_TOKEN) {
  console.error("❌ Missing required env var: FIGMA_TOKEN");
  process.exit(1);
}

// ─── Figma API Helper ────────────────────────────────────────────────────────

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
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(raw));
          } catch (e) {
            reject(new Error("Failed to parse Figma response: " + raw));
          }
        });
      })
      .on("error", reject);
  });
}

// ─── Key Generation ──────────────────────────────────────────────────────────

/**
 * Converts a Figma layer name to a clean snake_case key.
 * e.g. "Login Title / Main" → "login_title_main"
 */
function toKey(name) {
  return name
    .toLowerCase()
    .replace(/[\/\\]/g, "_")     // slashes → underscore
    .replace(/[^a-z0-9]+/g, "_") // non-alphanumeric → underscore
    .replace(/^_+|_+$/g, "");    // trim leading/trailing underscores
}

/**
 * Recursively walks the Figma node tree and collects all TEXT nodes.
 * Keys are built by joining the layer-name breadcrumb trail.
 *
 * @param {object} node    - Figma node object
 * @param {string[]} crumbs - ancestor key segments
 * @param {object} result   - accumulator
 */
function extractTexts(node, crumbs = [], result = {}) {
  if (node.type === "TEXT" && node.characters?.trim()) {
    const key = [...crumbs, toKey(node.name)].filter(Boolean).join(".");
    // If the key already exists (duplicate layer name), append a counter
    let finalKey = key;
    let counter = 1;
    while (result[finalKey] !== undefined) {
      finalKey = `${key}_${counter++}`;
    }
    result[finalKey] = node.characters.trim();
  }

  if (Array.isArray(node.children)) {
    // Only frame-like containers contribute a breadcrumb segment
    const isContainer = ["FRAME", "COMPONENT", "COMPONENT_SET", "GROUP", "SECTION"].includes(
      node.type
    );
    const nextCrumbs = isContainer ? [...crumbs, toKey(node.name)] : crumbs;
    for (const child of node.children) {
      extractTexts(child, nextCrumbs, result);
    }
  }

  return result;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const nodeIds = FIGMA_NODE_IDS.split(",").map((id) => id.trim()).filter(Boolean);
  console.log(`\n📐 Fetching ${nodeIds.length} screen(s) from file: ${FIGMA_FILE_ID}`);

  const query = nodeIds.map((id) => `ids=${encodeURIComponent(id)}`).join("&");
  const data = await figmaGet(`files/${FIGMA_FILE_ID}/nodes?${query}`);

  if (data.err) {
    throw new Error(`Figma API error: ${data.err}`);
  }

  let allStrings = {};

  for (const nodeId of nodeIds) {
    const nodeData = data.nodes?.[nodeId];
    if (!nodeData) {
      console.warn(`  ⚠️  Node ${nodeId} not found — skipping`);
      continue;
    }
    const screenName = toKey(nodeData.document.name);
    console.log(`  ✔  Extracting from screen: "${nodeData.document.name}" (${nodeId})`);
    extractTexts(nodeData.document, [screenName], allStrings);
  }

  // Sort alphabetically for clean diffs
  const sorted = Object.fromEntries(
    Object.entries(allStrings).sort(([a], [b]) => a.localeCompare(b))
  );

  // Write output
  const outDir = path.dirname(OUTPUT_PATH);
  if (outDir) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(sorted, null, 2) + "\n", "utf8");

  const count = Object.keys(sorted).length;
  console.log(`\n✅ Wrote ${count} string(s) to ${OUTPUT_PATH}\n`);
  if (count > 0) {
    console.log("Sample output:");
    Object.entries(sorted)
      .slice(0, 5)
      .forEach(([k, v]) => console.log(`  "${k}": "${v}"`));
    if (count > 5) console.log(`  ... and ${count - 5} more`);
  }
}

main().catch((err) => {
  console.error("\n❌ Error:", err.message);
  process.exit(1);
});
