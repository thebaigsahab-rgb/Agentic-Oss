# Agentic OS — Autonomous AI Executive Control Center

<p align="center">
  <img width="1271" height="883" alt="Agentic OS Dashboard" src="https://github.com/user-attachments/assets/63544bcb-f4c0-458c-afb3-6e8ace1622f1" />
</p>

<p align="center">
  <strong>A local-first, zero-telemetry autonomous operating dashboard and executive agent system.</strong><br>
  Real-time industry radar, brand intelligence, social growth tracking, newsletter synthesis, autonomous computer-use missions, and full Git repository orchestration.
</p>

<p align="center">
  <a href="#quick-start"><img src="https://img.shields.io/badge/Quick%20Start-npm%20run%20launch-brightgreen" alt="Quick Start"></a>
  <a href="#security--privacy"><img src="https://img.shields.io/badge/Security-Local--First%20%7C%20Zero--Backdoor-blue" alt="Security"></a>
  <a href="#supported-ai-providers"><img src="https://img.shields.io/badge/AI%20Providers-OpenAI%20%7C%20Anthropic%20%7C%20Gemini%20%7C%20xAI%20%7C%20Ollama%20%7C%20LM%20Studio-purple" alt="AI Providers"></a>
  <a href="#architecture"><img src="https://img.shields.io/badge/Platform-Next.js%2016%20%7C%20React%2019%20%7C%20SQLite-black" alt="Stack"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-green" alt="License"></a>
</p>

---

## Overview

**Agentic OS** is an executive-level workstation that aggregates intelligence across public and private feeds without exposing your sensitive credentials or telemetry to the cloud. Designed for engineers, founders, and security-conscious operators, it runs 100% locally on your machine, storing data in a self-contained SQLite database and communicating strictly over local loopback connections.

Every fresh installation starts clean: no hardcoded company names, no third-party tracking, no seeded API keys, and no backdoors. You configure your own watchlist, connect your chosen AI model (cloud or local Ollama / LM Studio), and automate your day-to-day intelligence and computing workflows.

---

## Core Capabilities

### 1. Jarvis Executive Agent & Voice Command
- **Conversational Intelligence:** High-context dialogue interface capable of dispatching autonomous agent missions, scheduling tasks, querying the local workspace, and summarizing intelligence streams.
- **Voice-Activated Missions:** Spoken commands parsed into structured JSON execution plans with real-time audio playback feedback.
- **Web Analysis & Deep Research:** Extracts, parses, and cleans content from arbitrary web pages to synthesize answers without sending sensitive browsing sessions outside your machine.

### 2. Computer Use & TBD Automation Engine
- **Task By Demonstration (TBD):** Interactive system that learns workflows directly from demonstration streams and parameterizes them into reusable skills.
- **Perceptual Screen Intelligence:** Visual DOM and coordinate parsing engine that maps interactive elements on screen without invasive system hooking.
- **Tamper-Evident Skill Registry:** Skills are cryptographically hashed and gated by human-in-the-loop (HITL) approval before destructive system actions can run.
- **Anti-Drift Guardrails:** Automated detection halts actions if UI drift or target ambiguity occurs, rolling back state safely.

### 3. Industry News Radar & Deep Sitemap Scanners
- **Autonomous Scrapers:** Monitors public RSS/Atom feeds, homepage metadata, and recursive sitemap indexes (`robots.txt` + XML sitemaps).
- **Semantic Reranking:** AI-assisted relevance scoring filters out noise and prioritizes material updates, events, and releases into a 30-card daily focus.
- **Zero Duplication:** Canonical URLs and content hashing prevent duplicate stories across multiple syndication sources.

### 4. Strict Brand Mentions & Reputation Radar
- **Multi-Source Ingestion:** Continuous monitoring across Google News, Bing News, and broad web passes.
- **Strict Evidence Verification:** Requires literal page-level mentions, matching official handles, anchors, and domain context. AI summaries are strictly constrained to verified source evidence to eliminate hallucinations.
- **Negative Term Filtering:** Hard-rejects namesakes, false-positive homonyms, and unrelated brand noise.

### 5. Multi-Platform Audience Analytics
- **Supported Channels:** YouTube, X (Twitter), Instagram, Facebook, LinkedIn, Threads, and TikTok.
- **Zero API Keys Required:** Operates primarily via signed-out public web profile scraping with optional official credential fallback.
- **True Growth Metrics:** Compares audience counts against historical anchors (24–36 hours prior) to prevent false-zero reporting and miscalculated spikes.

### 6. Newsletter Intelligence (Gmail Integration)
- **Read-Only OAuth:** Connects to any personal or dedicated newsletter Gmail inbox using Google Cloud OAuth (`gmail.readonly`).
- **Privacy-Guarded Ingestion:** Automatically strips tracking pixels, sanitizes tracking links, and masks personal subscriber email addresses before LLM analysis.
- **Event Clustering:** Groups multiple newsletters reporting on the same event into unified briefing cards with full source citations.

### 7. Integrated Git Agent & Repository Explorer
- **Live Branch & Working Tree Monitor:** Real-time visibility into branch status, uncommitted changes, and commit history.
- **Safe Operations:** Run diagnostic status checks, inspect diffs, and monitor repository health directly from the dashboard UI.
- **Local Isolation:** Hardened against arbitrary file read (LFI) and path traversal attacks; sensitive files (`.env*`, `.git/`, certs) are blocked by design.

### 8. Private Connector Bridge
- **Codex & Multi-App Bridge:** Pulls private summaries and action items from Slack, Granola, Apple Messages, Calendar, or local text logs via local JSON ingestion (`npm run ingest`).
- **Bring-Your-Own-Access:** Never stores or transmits external app passwords or sessions.

---

## Quick Start

### Prerequisites
- **Node.js:** `v22.0.0` or newer ([Node.js 24.x LTS recommended](https://nodejs.org/))
- **npm:** Included with Node.js
- **Git:** Installed and available in your terminal path

### Golden Path (One Command Launch)

# 1. Clone the repository
git clone https://github.com/thebaigsahab-rgb/Agentic-Oss.git

# 2. Navigate to the project directory
cd Agentic-Oss

# 3. Launch Agentic OS (standard one-command startup)
npm run launch



# 3. Launch Agentic OS
npm run launch
Useful Operational Commands
Command	Description
npm run launch	Standard one-command production launch
npm run launch -- --no-open	Launch server without opening the desktop browser
npm run launch -- --port=3001	Launch on an alternative local port
npm run doctor	Verify runtime, settings, SQLite database, and build health
npm run backup	Generate a full, encrypted timestamped snapshot of data and settings
npm run dev	Start Next.js Turbopack development server
npm test	Run the complete automated test suite (320+ unit and integration tests)
npm run check	Run linter, test suite, and production build gate
npm run smoke	Run isolated sandbox launcher and endpoint verification
Supported AI Providers
Agentic OS works seamlessly with both cloud providers and completely air-gapped local LLMs:

'''

'''Providers 
Provider	Type	Setup Requirements	Features Supported
Ollama	Local (Private)	Run ollama serve on http://127.0.0.1:11434	Full Curation, Newsletter Extraction, Summaries
LM Studio	Local (Private)	Run Local Server on http://127.0.0.1:1234	Full Curation, Newsletter Extraction, Summaries
Gemini	Cloud API	Set GEMINI_API_KEY or configure in Settings	High-speed Curation, Deep Research
Anthropic	Cloud API	Set ANTHROPIC_API_KEY or configure in Settings	Claude 3.5 / 3.7 Sonnet Reasoning & Computer Use
OpenAI	Cloud API	Set OPENAI_API_KEY or configure in Settings	GPT-4o / o1 / o3-mini extraction & reasoning
Grok (xAI)	Cloud API	Set XAI_API_KEY or configure in Settings	Real-time web-pass discovery & mentions
Offline Mode: No external API keys are required to use Industry scrapers, RSS, Sitemap discovery, Audience tracking, Task manager, or Reminders. You can operate completely offline using Ollama or LM Studio.

Security & Architecture


┌─────────────────────────────────────────────────────────────┐
│                 Desktop Browser / Operator                  │
└──────────────────────────────┬──────────────────────────────┘
                               │ Loopback Only (127.0.0.1)
┌──────────────────────────────▼──────────────────────────────┐
│                    Agentic OS Controller                    │
│   ┌─────────────────────────────────────────────────────┐   │
│   │ Next.js 16 (App Router) + React 19 Frontend         │   │
│   └──────────────────────────┬──────────────────────────┘   │
│                              │                              │
│   ┌──────────────────────────▼──────────────────────────┐   │
│   │ Hardened API Layer & Security Guardrails            │   │
│   │ • Loopback Host & Origin validation                 │   │
│   │ • Path Traversal & LFI Barrier (Zero .env leaks)    │   │
│   │ • Disabled Unauthenticated Shell Execution          │   │
│   └──────────────────────────┬──────────────────────────┘   │
│                              │                              │
│   ┌──────────────────────────▼──────────────────────────┐   │
│   │ Autonomous Kernel & Task Engines                    │   │
│   │ • TBD Computer Use & Perceptual Screen Analyzer     │   │
│   │ • Jarvis Executive Assistant & Voice Dispatch       │   │
│   │ • Industry, Sitemap & RSS Collectors                │   │
│   │ • Strict Brand & Social Audience Scrapers           │   │
│   └──────────────────────────┬──────────────────────────┘   │
│                              │                              │
│   ┌──────────────────────────▼──────────────────────────┐   │
│   │ Storage & Persistence Engine                        │   │
│   │ • Local SQLite Database (control-center.sqlite)     │   │
│   │ • Tamper-Evident Audit Chains & Cryptographic Vault │   │
│   └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
Loopback Enforced: Server binds exclusively to 127.0.0.1 and ::1. Foreign Host or Origin headers are rejected with 403 Forbidden.
Zero-Backdoor Policy: Arbitrary command execution endpoints require explicit operator authorization and loopback validation.
Path Traversal Protection: All filesystem and repository reading utilities enforce path normalization and reject access to .env*, .git/, SSH keys, and certificates.
Local Storage Locations:
Windows: %LOCALAPPDATA%\Control Center\
macOS: ~/Library/Application Support/Control Center/
Linux: ${XDG_DATA_HOME:-~/.local/share}/control-center/
Development & Testing
Run the full verification suite before committing:

bash


# Install dependencies
npm ci
# Run type check and unit/integration tests
npm test
# Run production build check
npm run build
# Run smoke test in an isolated sandbox environment
npm run smoke
