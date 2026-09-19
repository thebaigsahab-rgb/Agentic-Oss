# Agentic OS — Autonomous AI Executive Control Center

<p align="center">
  <img width="1271" height="883" alt="Agentic OS Dashboard" src="https://github.com/user-attachments/assets/63544bcb-f4c0-458c-afb3-6e8ace1622f1" />
</p>

<p align="center">
  <strong>A local-first, zero-telemetry autonomous operating dashboard and executive agent system.</strong><br>
  Real-time industry radar, brand intelligence, social growth tracking, newsletter synthesis, autonomous computer-use missions, and full Git repository orchestration.
</p>

<p align="center">
  <a href="#1-quickstart-golden-path"><img src="https://img.shields.io/badge/Quick%20Start-npm%20run%20launch-brightgreen" alt="Quick Start"></a>
  <a href="#5-security--architecture"><img src="https://img.shields.io/badge/Security-Local--First%20%7C%20Zero--Backdoor-blue" alt="Security"></a>
  <a href="#4-supported-ai-providers--offline-mode"><img src="https://img.shields.io/badge/AI%20Providers-OpenAI%20%7C%20Anthropic%20%7C%20Gemini%20%7C%20xAI%20%7C%20Ollama%20%7C%20LM%20Studio-purple" alt="AI Providers"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-green" alt="License"></a>
</p>

---

## 1. Quickstart (Golden Path)

```bash
# 1. Clone the repository
git clone https://github.com/thebaigsahab-rgb/Agentic-Oss.git

# 2. Navigate to the project directory
cd Agentic-Oss

# 3. Launch Agentic OS (Standard production startup)
npm run launch
```

> **What `npm run launch` does:**
> - Installs locked dependencies when needed.
> - Verifies local database schema and directory integrity.
> - Starts one loopback-only server on `http://127.0.0.1:3000`.
> - Automatically launches your default desktop browser to the dashboard.

---

## 2. Process Control: How to Stop & Break Out

If the server is running or frozen and you need to break/terminate execution:

### Standard Graceful Stop
- Press `Ctrl + C` (or `Cmd + C` on macOS) in the active terminal window.
- On Windows, if prompted with `Terminate batch job (Y/N)?`, type `Y` and press `Enter`.

### Force Termination (If Terminal Is Frozen)

```bash
# Windows (Command Prompt / PowerShell)
taskkill /F /IM node.exe

# macOS & Linux
pkill -9 -f node
```

---

## 3. Operational CLI Commands

| Command | Description |
| :--- | :--- |
| `npm run launch` | Standard one-command production launch (auto-opens browser) |
| `npm run launch -- --no-open` | Launch server without opening the desktop browser |
| `npm run launch -- --port=3001` | Launch on an alternative local port |
| `npm run doctor` | Verify runtime, settings, SQLite database, and build health |
| `npm run backup` | Generate a full, encrypted timestamped snapshot of data and settings |
| `npm run dev` | Start Next.js Turbopack development server |
| `npm test` | Run the complete automated test suite (320+ unit and integration tests) |
| `npm run check` | Run linter, test suite, and production build gate |
| `npm run smoke` | Run isolated sandbox launcher and endpoint verification |

---

## 4. Supported AI Providers & Offline Mode

| Provider | Type | Setup Requirements | Features Supported |
| :--- | :--- | :--- | :--- |
| **Ollama** | Local (Private) | Run `ollama serve` on `http://127.0.0.1:11434` | Full Curation, Newsletter Extraction, Summaries |
| **LM Studio** | Local (Private) | Run Local Server on `http://127.0.0.1:1234` | Full Curation, Newsletter Extraction, Summaries |
| **Gemini** | Cloud API | Set `GEMINI_API_KEY` or configure in Settings | High-speed Curation, Deep Research |
| **Anthropic** | Cloud API | Set `ANTHROPIC_API_KEY` or configure in Settings | Claude 3.5 / 3.7 Sonnet Reasoning & Computer Use |
| **OpenAI** | Cloud API | Set `OPENAI_API_KEY` or configure in Settings | GPT-4o / o1 / o3-mini extraction & reasoning |
| **Grok (xAI)** | Cloud API | Set `XAI_API_KEY` or configure in Settings | Real-time web-pass discovery & mentions |

> **Offline Mode:** No external API keys are required to use Industry scrapers, RSS, Sitemap discovery, Audience tracking, Task manager, or Reminders. You can operate completely offline using Ollama or LM Studio.

---

## 5. Security & Architecture

```plaintext
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
```

### Security Guardrails
- **Loopback Enforced:** Server binds exclusively to `127.0.0.1` and `::1`. Foreign `Host` or `Origin` headers are rejected with `403 Forbidden`.
- **Zero-Backdoor Policy:** Arbitrary command execution endpoints require explicit operator authorization and loopback validation.
- **Path Traversal Protection:** All filesystem and repository reading utilities enforce path normalization and reject access to `.env*`, `.git/`, SSH keys, and certificates.

---

## 6. Local Storage Locations

| OS Platform | Storage Directory Path |
| :--- | :--- |
| **Windows** | `%LOCALAPPDATA%\Control Center\` |
| **macOS** | `~/Library/Application Support/Control Center/` |
| **Linux** | `${XDG_DATA_HOME:-~/.local/share}/control-center/` |

---

## 7. Development & Verification Workflow

Run the full verification suite before committing:

```bash
# 1. Clean-install dependencies
npm ci

# 2. Run type check and unit/integration tests (320+ tests)
npm test

# 3. Run production build check
npm run build

# 4. Run smoke test in an isolated sandbox environment
npm run smoke
```

---

## 8. Core Capabilities & Feature Overview

- **Jarvis Executive Agent & Voice Dispatch:** Conversational interface with memory, task scheduling, research tools, and audio playback.
- **Computer Use & TBD Automation:** Task-by-demonstration skill synthesis, perceptual screen coordinate mapping, and human-in-the-loop approval.
- **Industry & Sitemap Scanners:** Recursive XML sitemap index parser, RSS/Atom feed monitors, and semantic news deduping.
- **Strict Brand Reputation Radar:** Literal evidence validation across Google & Bing News, rejecting namesakes and unverified AI hallucinations.
- **Multi-Platform Audience Analytics:** Track growth across YouTube, X, Instagram, Facebook, LinkedIn, Threads, and TikTok without requiring developer API keys.
- **Newsletter Gmail Synthesis:** Read-only OAuth extraction of newsletters into deduplicated, clean topic briefs with masked subscriber emails.
- **Integrated Git Explorer:** Visual repository status monitor, working tree inspector, and diagnostic agent.

---

## License

This project is licensed under the [MIT License](LICENSE).
