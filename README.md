# Strava Run Analyzer

A Chrome extension that lets you chat with an AI running coach about **your own Strava runs**. It runs in Chrome's side panel next to Strava, reads your data through your existing strava.com login, and computes the training metrics locally. The AI provider you choose then explains the numbers and turns them into recommendations.

You don't need a Strava subscription or a Strava API app. You do need an API key from an AI provider.

> **Disclaimer**
> - This is an unofficial, community project. It is not affiliated with, endorsed by, or supported by Strava.
> - It reads data through Strava's **internal web endpoints**, using your logged-in browser session. These endpoints are undocumented and can change at any time, which may break the extension. This kind of automated access may conflict with Strava's Terms of Service. Use it for **your own data only**, at a personal scale, and at your own risk.
> - The analysis is AI-generated and is not medical advice.

---

## Contents

- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation)
- [Setup](#setup)
- [Usage](#usage)
- [How it works](#how-it-works)
- [Metrics](#metrics)
- [Privacy and security](#privacy-and-security)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [Known limitations](#known-limitations)

---

## Features

- **Free-form chat** about your training, for example "Compare my long runs this month with last month" or "Was my last tempo run well paced?"
- **Quick actions:**
  - **Analyze this activity**: analyzes the Strava activity open in the current tab, or your most recent run if no activity page is open.
  - **4-week trend** and **12-week trend**.
  - **This year**: all runs since January 1.
- **Metrics computed locally, not guessed by the AI:**
  - per-km splits
  - time in heart-rate zones
  - aerobic decoupling (cardiac drift)
  - pace variability and cadence
  - TRIMP training load and acute:chronic workload ratio (ACWR)
  - aerobic efficiency (pace in HR zone 2)
- **Bring your own AI:**
  - OpenAI, Anthropic (Claude), and Google Gemini
  - any **OpenAI-compatible** API (OpenRouter, Ollama, LM Studio, and others)
  - **New API** gateways, with a model picker
- **Data stays in your browser**, except for what is sent to the AI provider you choose. There is no backend server.
- Strava data is **cached locally**, so repeat questions are fast and Strava is not hit again.

## Requirements

- Google Chrome 116 or newer, or another Chromium browser with side-panel support (Edge, Brave, Arc, ...).
- A Strava account, logged in on `www.strava.com` in the same browser profile.
- An API key for one of the supported AI providers. A local model through Ollama or LM Studio needs no key.
- To build from source: [Node.js](https://nodejs.org/) 20.19 or newer (22 LTS recommended), and npm.

## Installation

The extension is not on the Chrome Web Store. Install it from source:

```bash
git clone https://github.com/alfasean/starava-extension.git
cd starava-extension
npm install
npm run build
```

The build creates a `dist/` folder. To load it in Chrome:

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top-right).
3. Click **Load unpacked** and select the `dist/` folder.
4. Optional: pin the extension from the puzzle-piece menu so its icon stays visible.

**Updating:** run `git pull`, then `npm install` and `npm run build`, and click the **reload** icon on the extension card in `chrome://extensions`.

## Setup

1. Open `https://www.strava.com` and make sure you are logged in.
2. Click the extension icon. The side panel opens.
3. Go to the **Settings** tab.

### AI provider

| Provider | What to enter | Notes |
|---|---|---|
| **OpenAI** | API key, model name | Get a key at platform.openai.com. |
| **Anthropic** | API key, model name | Get a key at console.anthropic.com. |
| **Google Gemini** | API key, model name | Get a key at aistudio.google.com. |
| **OpenAI-compatible** | Base URL, API key, model | For any service that implements `/chat/completions` in the OpenAI format. |
| **New API (gateway)** | Gateway URL, API key, model | For gateways built on the open-source *New API* platform. Enter only the gateway's root URL; `/v1` is added automatically. |

- **Model** is free text, because providers release new models often. Use the exact model ID from your provider's documentation.
- For **OpenAI-compatible** and **New API**, click **Load models** to fetch the available model IDs from the server and choose from a list.
- The model must support **tool / function calling**. Most current hosted models do. For local models, use one that is advertised with tool support.
- When you save a custom Base URL or Gateway URL, Chrome asks for permission to access that domain. Click **Allow**; the extension cannot reach the server without it.

Examples of OpenAI-compatible base URLs:

| Service | Base URL |
|---|---|
| OpenRouter | `https://openrouter.ai/api/v1` |
| Ollama (local) | `http://localhost:11434/v1` |
| LM Studio (local) | `http://localhost:1234/v1` |

For local servers, the API key field must still contain something. Any text works, for example `local`.

### Athlete profile

| Field | Why it matters |
|---|---|
| **Max HR (bpm)** | Required. Used to compute your heart-rate zones and training load. Use a measured value if you have one. |
| **Resting HR (bpm)** | Required. Used with max HR for the zones (Karvonen / heart-rate reserve method). |
| **Threshold pace** (mm:ss per km) | Optional. Gives the coach a reference for intensity. |

Click **Save**. The **Chat** tab is ready once a provider, an API key and a model are set.

## Usage

Keep a strava.com tab open and logged in. You can ask from **any Strava page**; you don't have to navigate anywhere first.

- **Analyze this activity**: open an activity page (`strava.com/activities/<id>`) and click the chip. On any other page, the coach analyzes your most recent run and tells you which one it picked.
- **4-week trend**, **12-week trend**, **This year**: weekly volume, load, ACWR, aerobic efficiency, injury-risk flags and recommendations.
- **Free chat**: type anything. Some examples:
  - "Which of my runs in September had the best aerobic efficiency?"
  - "Am I increasing my weekly volume too fast?"
  - "Analyze my last long run and compare it with the one before."
  - "Plan my next week based on my recent load."

The coach replies in the language you write in.

**Stop** cancels the current answer. **New chat** clears the conversation.

The first long-range request (for example **This year**) can take a while, because the extension downloads per-second data for each run. It spaces out its requests to stay gentle on Strava, and shows progress such as `Fetching streams 12/40…`. Everything is cached afterwards, so later requests are fast.

## How it works

```
 Side panel (React)
   └─ Agent loop ── asks the AI ──▶ AI provider (OpenAI / Anthropic / Gemini / compatible)
        │              ◀── AI requests a tool ──┘
        ▼
      Tools ── read ──▶ Strava (your logged-in session) ──▶ IndexedDB cache
        │
        └─ Metrics computed locally ──▶ compact JSON sent back to the AI
```

1. Your question goes to the AI together with a list of **tools** it can call:
   - `get_athlete_profile`
   - `list_activities`
   - `get_activity_analysis`
   - `get_training_trend`
   - `get_current_activity`
2. When the AI calls a tool, the extension fetches the data from Strava using your browser session, computes the metrics in your browser, and returns a small JSON summary.
3. The AI writes the answer from those numbers. Raw per-second data never leaves your browser.

## Metrics

| Metric | Definition |
|---|---|
| HR zones | Karvonen: rest + (max − rest) × {50, 60, 70, 80, 90, 100} % gives Z1–Z5. |
| Splits | Per-km pace, average HR, cadence and elevation change. Stopped time is excluded. |
| Aerobic decoupling | Change in the speed-to-HR ratio between the first and second half of the moving time. Below about 5% usually means good aerobic durability. Needs at least 10 minutes and HR data. |
| Pace variability | Coefficient of variation of moving speed. |
| Cadence | Steps per minute. Strava's per-foot value is doubled. |
| TRIMP | Banister training impulse from heart rate. |
| ACWR | Last-7-day load ÷ (last-28-day load ÷ 4). Around 0.8–1.3 is commonly considered the "sweet spot". |
| Aerobic efficiency | Average pace while your HR is in zone 2. Getting faster at the same HR indicates improving fitness. |

Runs without heart-rate data still count for distance and time, but are left out of the HR-based metrics. The coach tells you when that happens.

## Privacy and security

- **API keys** are stored in `chrome.storage.local` in your browser profile, and are sent only to the provider you configured.
- **Strava data** is fetched directly from strava.com and cached in your browser's IndexedDB. It is sent only to the AI provider you selected, and only as computed summaries such as splits, zones and weekly totals. Activity names and dates are included in those summaries.
- **No backend, no analytics, no tracking.** The extension talks only to Strava and to your AI provider.
- **Costs:** API usage is billed by your AI provider to your account. A typical analysis uses a few thousand tokens.
- **Shared computers:** anyone with access to your Chrome profile can use your saved API key. To remove it, clear the key in Settings or remove the extension.

## Troubleshooting

| Message or symptom | What to do |
|---|---|
| "Please log in to strava.com and try again." | Log in at strava.com in the same Chrome profile, then retry. |
| "Strava's data format changed." | Strava changed an internal endpoint. Open an issue and include the technical details shown under the message. |
| "Strava is rate limiting requests." | Wait a minute or two, then retry. |
| "… rejected the API key." | Check the key and provider in Settings. Make sure the key has credit or quota left. |
| "… quota or rate limit reached." | Your AI account hit a limit. Wait, or check billing with your provider. |
| The coach says it cannot use tools, or ignores your data | Choose a model that supports tool or function calling. |
| Load models fails, or a custom URL doesn't connect | Make sure you clicked **Allow** on Chrome's permission prompt. Re-save the settings to be asked again. Only `https://` URLs, `http://localhost` and `http://127.0.0.1` can be used. |
| Ollama returns 403 or a CORS error | Start Ollama with `OLLAMA_ORIGINS=chrome-extension://*` so it accepts requests from extensions. |
| The panel doesn't open | Click the extension icon while a normal web page is active. Check that the extension is enabled in `chrome://extensions`. |

## Development

```bash
npm install
npm test          # unit tests (Vitest)
npm run build     # type-check and build to dist/
```

After changing code, run `npm run build` and reload the extension in `chrome://extensions`.

```
src/
  background.ts          opens the side panel when the toolbar icon is clicked
  sidepanel/             React UI: chat, settings, error messages
  agent/                 tool-calling loop and coach prompts
  llm/                   provider adapters (OpenAI, Anthropic, Gemini), SSE parsing, model listing
  tools/                 the tools the AI can call
  strava/                Strava client, rate limiter, response parsing, IndexedDB cache
  metrics/               pure metric functions (zones, splits, decoupling, TRIMP, trends)
  settings/              settings model and storage
tests/                   mirrors src/; fixtures under tests/fixtures/
```

Contributions are welcome. Please add tests for new metrics and tools, and keep each module focused.

## Known limitations

- **Runs only.** Other sports are ignored in the analysis.
- **Unofficial Strava endpoints**, so the extension can break when Strava changes its website (see the disclaimer).
- **Activity lookups** cover your 200 most recent activities. `list_activities` returns at most 200 activities per request, and trends go back at most 53 weeks.
- **Chats are not saved.** Closing the panel or clicking **New chat** clears the conversation. Cached Strava data is kept.
- **Not on the Chrome Web Store.** Install from source as described above.
