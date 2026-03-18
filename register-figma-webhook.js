/**
 * register-figma-webhook.js
 * Run ONCE locally to register a Figma webhook that fires on file updates.
 * The webhook POSTs to your relay URL, which then triggers GitHub Actions.
 *
 * Usage:
 *   FIGMA_TOKEN=xxx \
 *   FIGMA_TEAM_ID=yyy \
 *   WEBHOOK_ENDPOINT=https://your-relay-url.com/figma-hook \
 *   WEBHOOK_PASSCODE=my-secret-passcode \
 *   node scripts/register-figma-webhook.js
 *
 * To list existing webhooks:
 *   node scripts/register-figma-webhook.js --list
 *
 * To delete a webhook:
 *   WEBHOOK_ID=abc node scripts/register-figma-webhook.js --delete
 */

const https = require("https");

const FIGMA_TOKEN = process.env.FIGMA_TOKEN;
const FIGMA_TEAM_ID = process.env.FIGMA_TEAM_ID;
const WEBHOOK_ENDPOINT = process.env.WEBHOOK_ENDPOINT;
const WEBHOOK_PASSCODE = process.env.WEBHOOK_PASSCODE || "figma-gh-sync";
const WEBHOOK_ID = process.env.WEBHOOK_ID;

const args = process.argv.slice(2);

function figmaRequest(method, apiPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const options = {
      hostname: "api.figma.com",
      path: `/v2/${apiPath}`,
      method,
      headers: {
        "X-Figma-Token": FIGMA_TOKEN,
        ...(payload && {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        }),
      },
    };

    const req = https.request(options, (res) => {
      let raw = "";
      res.on("data", (c) => (raw += c));
      res.on("end", () => {
        try {
          resolve(JSON.parse(raw));
        } catch {
          resolve({ raw });
        }
      });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function listWebhooks() {
  if (!FIGMA_TEAM_ID) { console.error("❌ Set FIGMA_TEAM_ID"); process.exit(1); }
  const data = await figmaRequest("GET", `teams/${FIGMA_TEAM_ID}/webhooks`);
  console.log("\nExisting webhooks:");
  if (!data.webhooks?.length) { console.log("  (none)"); return; }
  for (const wh of data.webhooks) {
    console.log(`  ID: ${wh.id}  Event: ${wh.event_type}  Endpoint: ${wh.endpoint}  Status: ${wh.status}`);
  }
}

async function deleteWebhook() {
  if (!WEBHOOK_ID) { console.error("❌ Set WEBHOOK_ID"); process.exit(1); }
  const data = await figmaRequest("DELETE", `webhooks/${WEBHOOK_ID}`);
  console.log("Deleted:", data);
}

async function registerWebhook() {
  if (!FIGMA_TEAM_ID || !WEBHOOK_ENDPOINT) {
    console.error("❌ Set FIGMA_TEAM_ID and WEBHOOK_ENDPOINT");
    process.exit(1);
  }

  // Register for FILE_VERSION_UPDATE — fires whenever a file version is saved,
  // which happens when a designer marks a frame "Ready for Dev".
  const payload = {
    event_type: "FILE_VERSION_UPDATE",
    team_id: FIGMA_TEAM_ID,
    endpoint: WEBHOOK_ENDPOINT,
    passcode: WEBHOOK_PASSCODE,
    description: "GitHub Actions – Sync strings on Ready for Dev",
  };

  console.log(`\n📡 Registering Figma webhook...`);
  console.log(`   Team:     ${FIGMA_TEAM_ID}`);
  console.log(`   Endpoint: ${WEBHOOK_ENDPOINT}`);
  console.log(`   Event:    FILE_VERSION_UPDATE`);

  const data = await figmaRequest("POST", "webhooks", payload);

  if (data.id) {
    console.log(`\n✅ Webhook registered! ID: ${data.id}`);
    console.log(`   Save this ID if you need to delete it later:`);
    console.log(`   WEBHOOK_ID=${data.id}`);
  } else {
    console.error("\n❌ Registration failed:", JSON.stringify(data, null, 2));
    process.exit(1);
  }
}

if (!FIGMA_TOKEN) { console.error("❌ Set FIGMA_TOKEN"); process.exit(1); }

if (args.includes("--list")) listWebhooks().catch(console.error);
else if (args.includes("--delete")) deleteWebhook().catch(console.error);
else registerWebhook().catch(console.error);
