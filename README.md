# 🎨 Figma Strings Sync

Automatically extracts all text strings from a Figma screen and commits them to your GitHub repo as a `strings/en.json` key-value file — triggered every time a designer marks a frame **Ready for Dev**.

---

## How It Works

```
Designer marks frame "Ready for Dev" in Figma
        │
        ▼
Figma fires FILE_VERSION_UPDATE webhook
        │
        ▼
Relay Server (relay-server.js)
  • Validates passcode
  • Calls Figma API → finds READY_FOR_DEV nodes
  • POSTs repository_dispatch to GitHub
        │
        ▼
GitHub Actions (sync-figma-strings.yml)
  • Fetches all TEXT nodes from the screen
  • Builds key-value pairs  (layer path → text content)
  • Commits strings/en.json to the repo
```

**No relay server?** The workflow also polls Figma every 15 minutes via a scheduled cron — zero extra infrastructure needed.

---

## File Structure

```
.github/
  workflows/
    sync-figma-strings.yml      ← GitHub Actions workflow
scripts/
  sync-figma-strings.js         ← Fetches & writes strings
  check-dev-status.js           ← Detects newly-ready Figma screens
  register-figma-webhook.js     ← One-time webhook registration
  relay-server.js               ← Bridges Figma → GitHub dispatch
strings/
  en.json                       ← ✅ Auto-generated output
```

---

## Setup Guide

### Step 1 — GitHub Secrets

Go to **Settings → Secrets and variables → Actions** and add:

| Secret | Value |
|--------|-------|
| `FIGMA_TOKEN` | Figma Personal Access Token ([get one here](https://www.figma.com/developers/api#authentication)) |
| `FIGMA_FILE_ID` | The key from your Figma URL: `figma.com/file/`**`THIS_PART`**`/...` |

### Step 2 — Get Your Screen's Node ID

1. Open your Figma file in the browser
2. Click the frame/screen you want to sync
3. Look at the URL: `figma.com/file/FILE_ID/...?node-id=`**`1%3A23`**
4. Decode it: `1%3A23` → `1:23` — that's your Node ID

You can set a default in the workflow or pass it at runtime.

### Step 3 — Choose Your Trigger Method

#### Option A: Polling Only (no extra server needed)
The workflow runs every 15 minutes automatically and checks Figma for any newly "Ready for Dev" screens. No further setup needed.

#### Option B: Instant Webhook (recommended)
For real-time triggering, deploy the relay server and register a Figma webhook.

**Deploy the relay (free options):**
- [Railway](https://railway.app) — `railway up`
- [Render](https://render.com) — connect repo, set start command to `node scripts/relay-server.js`
- [Fly.io](https://fly.io) — `fly launch`

**Set relay env vars:**
```bash
WEBHOOK_PASSCODE=your-secret-passcode
FIGMA_TOKEN=your-figma-token
GH_PAT=your-github-pat-with-repo-scope
GH_OWNER=your-github-username
GH_REPO=your-repo-name
```

**Register the Figma webhook (run once locally):**
```bash
FIGMA_TOKEN=xxx \
FIGMA_TEAM_ID=yyy \
WEBHOOK_ENDPOINT=https://your-relay.railway.app/figma-hook \
WEBHOOK_PASSCODE=your-secret-passcode \
node scripts/register-figma-webhook.js
```

**Manage webhooks:**
```bash
# List all webhooks for your team
FIGMA_TOKEN=xxx FIGMA_TEAM_ID=yyy node scripts/register-figma-webhook.js --list

# Delete a webhook
FIGMA_TOKEN=xxx WEBHOOK_ID=abc node scripts/register-figma-webhook.js --delete
```

---

## Output Format

Keys are built from the **layer name breadcrumb trail** in Figma, converted to `snake_case`. Values are the text content.

**Example Figma layer structure:**
```
Frame: "Login Screen"
  └─ Group: "Header"
       └─ Text: "Welcome Back"      → "login_screen.header.welcome_back": "Welcome Back"
       └─ Text: "Sign in to continue" → "login_screen.header.sign_in_to_continue": "Sign in to continue"
  └─ Text: "Email"                  → "login_screen.email": "Email"
  └─ Text: "Password"               → "login_screen.password": "Password"
  └─ Text: "Forgot Password?"       → "login_screen.forgot_password": "Forgot Password?"
  └─ Text: "Login"                  → "login_screen.login": "Login"
```

**Generated `strings/en.json`:**
```json
{
  "login_screen.email": "Email",
  "login_screen.forgot_password": "Forgot Password?",
  "login_screen.header.sign_in_to_continue": "Sign in to continue",
  "login_screen.header.welcome_back": "Welcome Back",
  "login_screen.login": "Login",
  "login_screen.password": "Password"
}
```

Keys are always **sorted alphabetically** for clean, predictable git diffs.

---

## Manual Trigger

You can also trigger the sync manually from GitHub Actions:

1. Go to **Actions → Sync Figma Strings → Run workflow**
2. Optionally enter specific Node IDs (comma-separated)
3. Click **Run workflow**

---

## Naming Your Layers in Figma

For best results, give your text layers **descriptive names** in Figma:

| ✅ Good layer name | ❌ Avoid |
|-------------------|---------|
| `welcome_title` | `Text 1` |
| `login_button` | `Rectangle Copy 3` |
| `error_message` | `Group 47` |

The layer name becomes the key — so clean names = clean keys.

---

## Tips

- The workflow commits with `[skip ci]` to avoid triggering itself recursively
- If a layer name is duplicated on the same screen, a numeric suffix is added (`_1`, `_2`)
- Hidden layers are still included — hide them in Figma using the eye icon or move them off-canvas
- To sync multiple screens at once, comma-separate Node IDs: `1:23,4:56,7:89`
