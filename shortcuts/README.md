# iOS Shortcut — Research This

One tap from any Instagram, TikTok, or YouTube post to a structured finding in your knowledge base.

---

## Before you start — two values you need

| Value | Where to find it |
|-------|-----------------|
| `YOUR_RAILWAY_URL` | Railway dashboard → your service → Settings → Domain (e.g. `https://tech-radar-api-production.up.railway.app`) |
| `YOUR_AUTH_TOKEN` | The `AUTH_TOKEN` value in your Railway Variables |

Have these ready before building the shortcut.

---

## Quick start (share sheet — recommended)

1. Open **Shortcuts** app → tap **+**
2. Build the 3 actions below in order
3. Tap **ⓘ** → enable **Show in Share Sheet** → Receive: **URLs**

Then: on any Instagram/TikTok/YouTube post, tap **Share** → **Research This** → done.

---

## The 3 actions

### Action 1: Get the URL
- Action: `Shortcut Input`
- Use: `Provided Input` (this is the URL from the share sheet)

> **Clipboard fallback:** If you prefer to copy links manually, replace this with `Get Clipboard`.

### Action 2: POST to your pipeline
- Action: `Get Contents of URL`
- URL: `https://YOUR_RAILWAY_URL/runs`
- Method: `POST`
- Headers:
  - `Content-Type` → `application/json`
  - `Authorization` → `Bearer YOUR_AUTH_TOKEN`
- Request Body: `JSON`
  - Key: `url` — Value: tap the variable picker → choose **Shortcut Input** (or Clipboard)

### Action 3: Confirm
- Action: `Show Notification`
- Title: `Tech Radar`
- Body: `Queued for research ✓`

---

## Naming and icon

- Name it **Research This**
- Tap the icon → choose the radar or antenna symbol

---

## Testing it

1. Open Instagram, find a post about a dev tool
2. Tap **Share** → scroll to **Research This** → tap
3. You should get the "Queued for research ✓" notification
4. Check your Telegram bot or Railway URL — the run should appear within seconds

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| "Unauthorized" error | Double-check `AUTH_TOKEN` matches your Railway variable exactly |
| No notification | Make sure Shortcuts has notification permission in iOS Settings |
| Run doesn't appear | Check Railway logs — the URL may have failed to extract |
| Share sheet doesn't show the shortcut | Enable "Show in Share Sheet" in the shortcut's ⓘ settings |
