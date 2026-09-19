# Changelog

## 0.5.0 - 2026-09-14

- Added the real device bridge (`lib/server/system-bridge.ts`): J.A.R.V.I.S. and the Computer Use agent now actuate the actual Windows PC through guarded PowerShell — master volume (get/set/step/mute) via the Core Audio endpoint, hardware media keys, default-browser tab opening, real screen capture, headless Edge/Chrome print-to-PDF, user idle detection, foreground-window enumeration, and real mouse/keyboard synthesis — all with no new npm dependencies.
- J.A.R.V.I.S. gained seven device tools: `play_media` resolves a song request ("play song hawayein") to the exact YouTube video server-side and opens it in the browser (falling back to search results when unreachable), plus `control_media`, `control_volume` ("increase the sound to 50%" = absolute, "by 20" = relative), `take_screenshot`, `save_page_pdf`, `get_system_status`, and `list_windows`; deterministic fast paths handle volume, media, screenshot, and system-status commands without any model round-trip, and screenshots/PDFs render inline as result cards in the chat.
- Added a `/api/system` route exposing the device bridge to the dashboard (snapshot, audio, media, apps, windows, input, artifact CRUD) with artifact vaults served from `%LOCALAPPDATA%\Control Center\os-artifacts\` and traversal-proof name validation.
- Reorganized the Computer Use tab as the A.D.A.M. identity-card cockpit: an agent identity card (clearance, live CPU/RAM/battery/idle/foreground telemetry, capability matrix) with a motor-arbitration switch — agent-owned virtual motors, auto-idle borrowing of the real mouse & keyboard when the user is away, or explicit takeover — followed by a command deck that executes deterministic device commands ("screenshot", "open notepad", "click 500 300", "type \"...\"") without chat, and a new Artifacts sub-tab managing the screenshot and PDF vaults.
- Upgraded the computer-use engine with real actuation: navigate/click/type/key/scroll actions physically execute on the device when the input-mode gate allows (idle check or takeover) and degrade to the virtual plane with a note otherwise; screen capture is always attempted on Windows; the shell guardrail vocabulary was extended (diskpart, shutdown, registry deletes, Remove-Item -Recurse, etc.) and hotkey synthesis blocks system-level chords (Win, Alt+F4, Ctrl+Alt+Del).
- Added a new System tab: a hardware deck with live device stats, a master-volume slider, media transport buttons, one-click app launching (allowlisted aliases), a focus-window list, and both artifact vaults.
- Safety: real input is rate-limited to human pace, coordinates are clamped to the physical screen, input modes are refused when idle time cannot be measured, and PowerShell scripts are staged as temp files (bypassing the 8K cmd.exe command-line limit) with injection-proof quoting and post-call cleanup.

## 0.4.0 - 2026-09-13

- Redesigned the interface as an Obsidian neural theme: a deeper black base with a cyan, indigo, violet, and magenta accent mixture, an ambient aurora field, and gradient brand, navigation, and heading treatments (dark and light both preserved).
- Made J.A.R.V.I.S. substantially faster: the chat route now streams model tokens as they are generated, tool confirmations are composed deterministically without a second model round-trip, and the system prompt is compacted; a streaming runtime with per-provider SSE support and graceful single-shot fallback was added to the AI layer.
- Upgraded the computer-use engine with a human motor model — eased cursor paths with micro-jitter, per-keystroke typing cadence, and pre/post action pauses — plus self-healing target recovery that re-perceives a drifted page before failing, headings-aware perception, and structured vision-frame screenshots.
- Skill execution now streams step-by-step over SSE so the virtual screen plays the agent's own mouse and keyboard back in real time, with typing echo and playback status overlays; away missions move the agent cursor between live steps.
- Upgraded Teach Studio: screen recording now captures clicks, typing, keyboard combinations, and scrolls with a live REC timer and removable timeline; demonstrations save to and load from portable `.jarvis-skill.json` skill files, and the synthesizer preserves key-press and scroll steps.
- Skill parameters now auto-fill from their taught defaults when replayed from the vault, replacing the previously dead parameter-modal code path.
- Added Industry story intelligence briefs: clicking a story (or its key-points action) fetches the official source and produces a grounded summary with 4–6 key points, read time, and a cached SQLite-backed brief, with a deterministic extractive fallback when no AI provider is configured; the modal links straight to the official source in a new tab.
- Added AI-lab quick filters (OpenAI, Anthropic, Google DeepMind, AI agents, LLM, computer use) to the Industry wire for one-click topic filtering.
- Fixed local-model inference to default to a 4,000-token output allowance, matching the local runtime contract tests.
- Cleared all outstanding ESLint errors across the agentic modules and components, typing the tool-call dispatch, stores, and speech recognition surfaces.

## 0.3.1 - 2026-08-25

- Added persistent dark mode with a saved theme preference.
- Added Google OAuth client ID validation and clearer setup guidance to prevent account email addresses from being entered as client IDs.
- Added durable response snapshots for Industry, Mentions, and Newsletters so tab navigation opens saved results instead of rerunning collectors.
- Made Industry, Mention, and Newsletter archive actions update both SQLite and the saved response atomically, eliminating the post-archive collection delay.
- Added a direct Mention-to-Reminder action.
- Rebuilt Newsletters as an AI-required intelligence pipeline that reads unseen Gmail issues, extracts actual news, filters utility/promotional content, resolves safe public redirects, and combines duplicate coverage into stable topics with source and Gmail evidence links. Newsletter text goes only to the selected provider with tracking links and email addresses masked; raw bodies are not stored locally.
- Added schema-v5 migration backups plus normalized newsletter issue/mention tables and collector snapshots.

## 0.3.0 - 2026-08-25

- Split Industry into a broad raw-discovery store and a bounded importance queue, with canonical/title/event deduplication, configurable exclusions, source diversity, scoring reasons, and a default 30-update daily target.
- Added optional provider-selectable OpenAI, Anthropic, or Gemini background intelligence with private server-side keys, environment-key support, model overrides, two-hour caching, and deterministic fallback behavior.
- Expanded Mentions beyond news feeds with optional broad-web research, while requiring independently fetched canonical-page evidence, preserving strict namesake filtering, supporting negative contexts, and excluding owned sites by default.
- Changed Audience growth from the previous hourly refresh to a true 24–36 hour comparison, retaining one anchor per 12-hour bucket and safely migrating legacy snapshot files.
- Added schema-v4 migration backups and a separate SQLite table for raw Industry discoveries so surfaced history and user archive state remain durable.
- Updated first-run, backup, security, diagnostics, UI, and portable-install documentation for the new generic curation model.

## 0.2.1 - 2026-08-25

- Split automatically expired Industry history from items a user manually archived, added deterministic newest/oldest/watched-site sorting across the complete active set, and stopped stale or undated feed backlogs from appearing as new discoveries.
- Improved generic RSS/Atom and sitemap discovery, accepted valid empty feeds, exposed partial failures instead of false live status, and removed silent result caps that could hide current Industry or Mention items.
- Tightened seven-day mention matching so provider query terms never count as observed evidence, configured handles remain exact identities, and ambiguous names require configured corroboration in strict mode.
- Persisted follower and subscriber changes between successful audience checks, kept the comparison tied to the same primary metric, and separated post, video, and thread counts as content metadata.
- Made corrupt Audience history fail closed and visible in `npm run doctor` instead of silently replacing a verified baseline.
- Added immutable dated completion records for repeating tasks, guarded against double completion, preserved monthly schedule anchors, and made task writes immediately recoverable after a reload or process interruption.
- Kept fresh clones isolated from another checkout's browser state while retaining a safe migration path for existing repo-local installs.
- Pinned public-source requests to the DNS addresses that passed network validation, revalidated every redirect, and applied the same protection to LinkedIn profile checks.
- Expanded cross-platform production smoke coverage for personalized-data-free first runs, every live dashboard area, and the documented one-command launcher.

## 0.2.0 - 2026-08-25

- Added a one-command local launcher with health wait, browser opening, rebuild detection, and single-instance protection.
- Moved fresh-install data to stable per-user operating-system directories while preserving existing repo-local installs.
- Added fail-closed startup, ordered workspace saves, visible persistence errors, SQLite schema versioning, and serialized settings/token writes.
- Added a local request boundary, production smoke test, diagnostics, and consistent private backups.
- Hardened public-source network validation, Windows-safe atomic snapshots, private backup permissions, and cross-platform CI pinning.
- Added a provider-neutral Daily Brief bridge for user-approved Codex connectors, local scripts, and Today/Week action overviews.
- Added authoritative per-source Daily Brief syncs with empty-run health, failure reporting, source-scoped IDs, privacy cleanup, and bounded Week filtering.
- Made task/reminder corruption fail closed and fixed Unicode Daily Brief migrations plus future Today/Week event windows.
- Improved first-run deep links, live-load error handling, audience duplicate protection, valid profile examples, and configurable Gmail newsletter search.
- Hardened Industry, Mentions, and Audience collectors for feed/sitemap fallbacks, strict identity, archive deduplication, and public-account attribution.

## 0.1.0 - 2026-08-21

- Initial local Control Center dashboard and settings-driven collectors.
