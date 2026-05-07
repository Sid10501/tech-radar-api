# iOS Shortcut — Research This

One tap from any Instagram, TikTok, or YouTube post to a structured finding in your knowledge base.

## What it does

1. Grabs the URL from your clipboard (or the share sheet)
2. POSTs it to your tech-radar-api instance
3. Shows a confirmation notification

The pipeline runs in the background. By the time you're done scrolling, the finding is committed to your ai-memory repo.

## Install

### Option A — Shortcut Gallery link

> **[Add to Shortcuts →](https://www.icloud.com/shortcuts/)**
>
> *(Link available once published — use Option B for now)*

### Option B — Build it yourself (2 minutes)

1. Open the **Shortcuts** app on your iPhone
2. Tap **+** to create a new shortcut
3. Add the following actions in order:

---

**Action 1: Get Clipboard**
- Action: `Get Clipboard`
- This captures whatever URL you copied from Instagram/TikTok/YouTube

---

**Action 2: Get Contents of URL** *(the actual API call)*
- Action: `Get Contents of URL`
- URL: `https://YOUR-RAILWAY-URL.railway.app/runs`
- Method: `POST`
- Headers:
  - `Content-Type` → `application/json`
  - `Authorization` → `Bearer YOUR_AUTH_TOKEN`
- Request Body: `JSON`
  - Add field: key = `url`, value = `Clipboard` (tap the variable picker, choose Clipboard)

---

**Action 3: Show Notification**
- Action: `Show Notification`
- Title: `Tech Radar`
- Body: `Queued for research ✓`

---

4. Name the shortcut **"Research This"**
5. Tap the shortcut icon → choose a symbol (the radar or antenna icon works well)

### Adding to the Share Sheet

To trigger it directly from Instagram/TikTok without copying the URL first:

1. Open the shortcut
2. Tap the **ⓘ** (info) button
3. Enable **Show in Share Sheet**
4. Under "Receive", select **URLs** and **Safari web pages**
5. Replace Action 1 (Get Clipboard) with `Shortcut Input` → use `Provided Input` as the URL

Now when you tap Share on any post → scroll to **Research This** → done.

## Environment values to fill in

| Placeholder | Where to find it |
|-------------|-----------------|
| `YOUR-RAILWAY-URL` | Railway dashboard → your service → Settings → Domain |
| `YOUR_AUTH_TOKEN` | The `AUTH_TOKEN` value you set in Railway Variables |

## Usage

**Copy-paste flow:**
1. On Instagram/TikTok, tap the share button → **Copy Link**
2. Open Shortcuts → tap **Research This**
3. Done

**Share sheet flow (after setup above):**
1. On any post, tap the share button
2. Scroll down → tap **Research This**
3. Done
