# Agentic Os

A local-first business dashboard for industry updates, strict brand mentions, newsletter monitoring, public audience totals, reminders, and tasks.

Every fresh install starts empty. There are no built-in names, companies, websites, social profiles, API keys, or demo records. Each user tailors the dashboard to their own niche in **Settings**.

 <img width="1271" height="883" alt="image" src="https://github.com/user-attachments/assets/63544bcb-f4c0-458c-afb3-6e8ace1622f1" />


## Install and open

Requirements: [Node.js 24.19 or newer](https://nodejs.org/en/download), npm, and a modern desktop browser.

```bash
git clone https://github.com/thebaigsahab-rgb/Agentic-Oss/
cd control-center
npm run launch
```

`npm run launch` is the golden path. It installs the locked dependencies when needed, builds the app when source files change, starts one loopback-only server, waits for a health check, and opens `http://127.0.0.1:3000` in the default browser. Keep that terminal window open; press `Ctrl+C` to stop.

Prefer a ZIP? Download **Code → Download ZIP** on GitHub, extract it, open a terminal in the extracted folder, and run `npm run launch`. Git is only required for the clone/update workflow.

Useful commands:

```bash
npm run doctor                 # verify runtime, settings, build, and SQLite health
npm run backup                 # make a consistent private backup
npm run launch -- --no-open    # start without opening a browser
npm run launch -- --port=3001  # use another local port
```

## First-run setup

The Today page shows the four live areas and links directly to the right Settings section.

1. **Industry:** add any public homepage, RSS/Atom feed, and optional topic phrases.
2. **Mentions:** add exact names, brands, handles, official domains, distinguishing identity anchors, and known false-positive contexts.
3. **Audience:** add exact public profile URLs or handles for the platforms you use.
4. **AI curation (optional):** choose OpenAI, Anthropic, Gemini, or Grok and save that provider's key, or connect a running local model in LM Studio or Ollama. The model selector starts at **Default**; available alternatives load from the selected provider.
5. **Newsletters (optional):** connect any Gmail account with a read-only OAuth client, choose the Gmail search query, and configure AI curation to extract and rank news.
6. **Daily brief:** choose how many Industry, Mention, and Newsletter stories appear on Today. Each section can show 1–10 stories or be turned off.

Collectors run shortly after startup, every 15 minutes while the app remains open, and when **Refresh** is pressed. Industry, Mentions, and Newsletters open from their last saved collector snapshot, so moving between tabs does not repeat public web or Gmail collection.

## Today and the daily brief

The daily brief is a quick snapshot of the saved reading queues, not a separate collection job. It shows the highest-priority active stories from each enabled tab, five per section by default. Choose **Customize** on Today or **Settings → Daily brief** to change those counts. Archived and expired stories are excluded; opening Today does not make additional AI, web, or Gmail calls. Each section links to the full tab and shows when that source was last checked.

Private actions, meetings, and messages are a separate optional section below the snapshot. They require the connector bridge described below; the three-tab snapshot does not.

## Industry collection

Each configured URL is treated independently and can belong to any niche.

1. The collector checks an explicit feed, page feed metadata, and common RSS/Atom paths.
2. If no feed is readable, it merges sitemap locations from `robots.txt` and common sitemap paths, including recursive sitemap indexes.
3. A first sitemap scan records a quiet baseline. Later scans report newly discovered pages.

A blocked homepage does not stop feed or sitemap discovery. Raw discoveries are stored separately from the reading queue. Canonical URL/title deduplication, watched-source priority, recency, configured topics and exclusions, material-change signals, event similarity, and source diversity select at most the configured daily target (30 by default). This keeps hundreds of broad discoveries available to the collector without presenting hundreds of cards as equally important.

Active Industry cards are limited to items published or newly discovered in the last 24 hours; older surfaced items remain under **History**. **Archived** contains only items a user explicitly archived. Undated feed entries establish a baseline instead of being presented as fresh news. Topic phrases add broader Google News discovery, while watched-site updates remain prioritized independently. A selected AI provider can rerank the bounded candidate set; failures automatically fall back to the local importance model.

## Mentions

Mention discovery searches Google News and Bing News across the previous seven days. When a user enables a cloud AI provider with search support, a cached two-hour broad-web pass also searches articles, podcasts, videos, directories, forums, GitHub, Reddit, and supported public social pages. Multi-word names and brands are searched as complete phrases, never as loose individual words.

For predictable laptop-friendly collection, a watchlist can contain up to 12 names, handles, and official websites combined, plus up to 24 identity anchors and 24 negative contexts. Every configured identity is processed; provider failures are reported as partial coverage rather than silently dropping entries.

Strict mode requires identity evidence:

- unique handles and official domains can qualify directly;
- common names and broad brand phrases need direct-page identity, niche, or anchor context;
- roles, products, locations, collaborators, and niche topics can serve as anchors;
- weak namesakes and broad word overlap are rejected as noise;
- search snippets and AI output never count as proof; the app fetches the direct canonical URL and requires literal page-local identity evidence;
- configured negative terms hard-reject recurring namesakes and unrelated brand contexts;
- official domains establish identity but can be excluded from the third-party Mention queue;
- literal but ambiguous matches stay review-only when strict mode is off; strict mode requires a second identity signal or multiple configured identity anchors.

Canonical story identities are stored locally. Once a result is archived, later scans do not resurface the same story through a search-provider wrapper or tracking URL.

Industry and Mention archive actions update the local library and saved collector snapshot together. The card moves immediately without waiting for a new source scan. Mention cards can also be sent directly to Reminders.

After identity verification, the selected cloud or local model can explain what a page says about the tracked identity and assign an attention-priority score. Summaries use only the verified page evidence and cannot admit an otherwise unverified mention. Results are cached and saved with the queue. Sort by **Priority**, **Newest**, or **Oldest**; without AI, deterministic importance ranking still works.

Public search is useful discovery, not complete web coverage. Pages that block signed-out verification are rejected instead of being presented as certain mentions. Facebook posts are intentionally excluded from broad research because the app cannot reliably verify exact public-post text without an official connection.

## Audience tracking

Supported public profiles: YouTube, X, Instagram, Facebook, LinkedIn, Threads, and TikTok.

Public pages are checked first and do not require platform API keys. Optional official credentials remain collapsed under advanced settings for providers that support a fallback. Successful metrics must match the configured account identity; a count from an unrelated page is rejected.

Public collection is provider-controlled and best effort. A platform can change or block signed-out metadata without notice. A failed check is shown as unavailable or limited, never as a false zero; a prior verified value is clearly labeled as last known. Combined totals are sums across platforms, not deduplicated people.

Follower and subscriber growth is measured against the newest comparable sample from 24–36 hours earlier. The app keeps one historical anchor per 12-hour bucket, so hourly/manual refreshes update the live total without becoming a misleading baseline. Until a true yesterday sample exists, the UI says **Baseline**. Post, video, and thread counts are shown only as separate content metadata; they are never used as audience growth.

The Audience page includes platform-colored account cards, a platform mix, and interactive 7-day/30-day charts. Switch between total audience and change over the selected range, inspect individual readings, or open the exact-values table. Charts use only verified saved readings: a new account starts with a point, not invented historical growth, and long gaps or last-known counts are labeled.

## Optional AI curation

No AI key is required for installation or for Industry, news Mention discovery, sitemap, RSS, Audience, Task, Reminder, or the daily snapshot features. **Newsletter intelligence requires a configured AI model**, either a cloud provider with a key or a running local model.

Under **Settings → AI curation**, choose **OpenAI**, **Anthropic**, **Gemini**, **Grok (xAI)**, **LM Studio**, or **Ollama**. Keep **Default** selected for an automatic model choice or choose a model returned by that provider. Cloud lists use the selected provider's key. Local lists show only currently loaded, supported text-generation models, not every model available to download. **Reload models** updates the list without saving changes or starting a collector.

The selected provider is used for bounded background jobs:

- semantic reranking of already-discovered Industry candidates, with a deterministic local fallback and the same daily cap;
- cached broad-web Mention discovery with supported cloud providers, followed by independent direct-page verification inside Control Center;
- summaries and priority ranking for already-verified Mention pages;
- newsletter story extraction, priority ranking, and cross-newsletter deduplication, using only the separately connected mailbox's matching issues.

Keys can instead be supplied as `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, or `XAI_API_KEY` in `.env.local`. Environment keys are still inert until the matching provider is selected in Settings. Cloud calls can incur usage charges. Saved keys remain in the local server-side settings file, never return through the Settings API, and are not sent to any unselected provider.

### Local models

Start the local server in LM Studio or Ollama and load a text model there first. Choose that provider in Control Center, use the default loopback endpoint or enter its local port, then select **Reload models**. Control Center does not install, download, or load models. An optional token is supported if your local server requires one; most local setups do not need a key. Ollama cloud models are not listed, and `OLLAMA_API_KEY` is deliberately not used as a local credential.

Only numeric loopback endpoints (`127.0.0.1` or `::1`) are accepted, with `localhost` normalized to loopback. Requests do not follow redirects. Local models handle curation, summaries, and newsletters; public Mention discovery continues through the regular news collectors without AI web-search tools.

The dashboard sends local-model requests only to that loopback server. For processing entirely on this computer, also disable remote forwarding such as [LM Studio's LM Link](https://lmstudio.ai/docs/developer/core/lm-link) in the model runtime. Control Center cannot inspect or control how another application routes requests internally. A local model must be capable of following the JSON extraction instructions; model failures are reported without fabricating stories.

Keep the model loaded while the dashboard runs and choose a context window large enough for newsletter and page evidence. The model menu shows the runtime's actual loaded capacity. Control Center conservatively checks the input and output allowance before sending a prompt, never enlarges the allocation automatically, and refuses unknown or insufficient capacity with setup guidance. Older local servers may need an update to expose this information. Ollama requests disable truncation and context shifting; incomplete model output is not accepted as a finished result.

## Tasks

Completing a repeating task records a dated, immutable occurrence in Completed and advances the active series to its next due date. One-time tasks remain in Completed until you delete them.

## Newsletter Gmail

The newsletter mailbox can be completely separate from any Gmail account used elsewhere.

The Newsletters page is an intelligence queue rather than an inbox mirror. On a refresh, Control Center reads previously unseen matching Gmail issues and asks the selected AI provider to extract substantive news—not every hyperlink. Navigation, polls, ads, stock tickers, author profiles, and housekeeping are excluded. Safe public tracking redirects, canonical URLs, headline matching, and AI event consolidation group repeat coverage into one story. Each topic shows how many issues and newsletters covered it, links to the original sources, and a Gmail evidence link. Persistent topic aliases keep archive state stable when later newsletters repeat a story.

The active reading queue covers the latest 36 hours; **Earlier** keeps older extracted topics available, and **Archive** contains only stories you manually archived. The first backfill is processed in bounded batches with a visible queued count. Saved results open immediately between background passes. Without a configured AI model, processing pauses and the page explains what to configure instead of falling back to an inbox or link dump.

Sort each queue by **Priority**, **Newest**, or **Oldest**, search the extracted stories, and select one or more newsletters to see their coverage. Multi-newsletter stories remain one card, with all source evidence intact. Only 30 matching cards render initially; **Show 30 more** reveals the next batch. Ranking is stored with the stories, so changing filters or reopening the tab does not spend additional AI tokens. Previously extracted stories receive priority scores in bounded background batches without rereading their Gmail bodies.

1. Create or select a project in [Google Cloud Console](https://console.cloud.google.com/).
2. Enable the Gmail API and configure the OAuth consent screen.
3. Create a **Web application** OAuth client.
4. Copy the exact redirect URI shown under **Settings → Newsletters** into the OAuth client.
5. Paste the client ID and secret, customize the Gmail search query if desired, and choose **Save & choose Gmail account**.

The requested scope is Gmail read-only. The app never sends, labels, deletes, marks as read, or archives Gmail messages. Dashboard archive state is local only. Newsletter text is sent only to the selected AI provider for extraction; email addresses and subscriber-specific link URLs are masked first. Raw bodies are not stored locally; SQLite keeps issue metadata, a body hash, extracted story metadata, and deduplicated topic state.

Google classifies `gmail.readonly` as a restricted scope. A personal OAuth project left in External/Testing mode can require periodic reauthorization; production distribution of shared OAuth credentials requires Google verification. This project intentionally uses bring-your-own OAuth credentials rather than shipping a universal secret.

## Local data and privacy

The server binds to `127.0.0.1` and rejects API requests with foreign Host or Origin headers. Do not expose it through a network proxy without adding authentication.

Fresh installs store durable data outside the application folder:

| Platform | Default data directory                            |
| -------- | ------------------------------------------------- |
| macOS    | `~/Library/Application Support/Control Center`    |
| Windows  | `%LOCALAPPDATA%\Control Center`                   |
| Linux    | `${XDG_DATA_HOME:-~/.local/share}/control-center` |

Existing installations that already contain `./.control-center` continue using that directory automatically, so this update does not make their data appear missing. An optional absolute `CONTROL_CENTER_DATA_DIR` can be set in `.env.local`.

Stored files include:

- `settings.json`: configuration, OAuth tokens, and any saved AI/provider keys, owner-readable on POSIX systems;
- `control-center.sqlite`: raw Industry discoveries, saved collector snapshots, surfaced content, extracted newsletter issue/link metadata, archive state, reminders, and tasks;
- snapshot JSON files: sitemap and audience baselines.

Secrets never return through the Settings API. They remain local, but they are not encrypted at rest. Protect the operating-system account and any backups.

## Backup and recovery

```bash
npm run backup
```

This creates a consistent SQLite backup plus settings and snapshot files under `~/Documents/Control Center Backups/<timestamp>`. It is a private full backup and may contain OAuth tokens or AI provider keys.

To choose another destination:

```bash
npm run backup -- --to=/absolute/path/to/backup-folder
```

If startup safely stops on a local-data error, run `npm run doctor`. The app fails closed: it will not render editable empty defaults or overwrite settings, tasks, or reminders after a failed initial read.

## Updates

For a Git clone:

```bash
git pull --ff-only
npm run launch
```

The setup path compares the installed dependency tree to the committed lockfile and performs a clean install when it changes. User data is outside a fresh checkout, so replacing a ZIP with a newer version does not replace that data directory.

## Development and verification

```bash
npm run setup
npm run dev
npm run check
npm run smoke
```

`npm run check` runs lint, the regression suite, and a production build. `npm run smoke` exercises the same one-command launcher with an isolated temporary data directory and verifies the health endpoint, rendered home page, generic first-run state, and localhost request boundary. GitHub Actions runs the documented setup, full check, and launcher smoke path on Linux, macOS, and Windows.

## Private connector bridge

The standalone dashboard does not automatically inherit private Codex connectors. Instead, **Settings → Integrations** provides a portable local bridge for Gmail, Slack, Granola, Google Calendar, Apple Messages, Computer History, or any other user-approved source.

This is an optional advanced integration, not a login screen. The app names are labels for incoming summaries; adding a label does not connect or authorize the app. Industry, Mentions, Newsletters, Audience, and the daily snapshot work independently of this bridge.

Choose the apps, save, and choose **Copy setup prompt**. The generated prompt tells Codex to use the installed connectors read-only, minimize private content, report per-source success or failure, and send stable action/meeting/message items to the loopback-only Daily Brief endpoint. Successful empty checks are recorded, completed items are reconciled away, and failed sources keep their last successful set while showing the failure. The Today page provides Today/Week views and can turn any item into a task. Scripts can use `npm run ingest` with the same JSON contract.

The bridge makes connector-backed overviews portable without shipping anyone's account access. A connector automation still needs to be created by each user because those permissions belong to that user's Codex/provider accounts. See [docs/CONNECTOR_BRIDGE.md](docs/CONNECTOR_BRIDGE.md).

See [CHANGELOG.md](CHANGELOG.md), [CONTRIBUTING.md](CONTRIBUTING.md), and [SECURITY.md](SECURITY.md) for release and project details.
