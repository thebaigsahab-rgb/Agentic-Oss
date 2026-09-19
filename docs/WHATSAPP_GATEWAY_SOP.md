# WhatsApp Personal Command Gateway — Operational Runbook & Pakistani (+92) Onboarding SOP

This Standard Operating Procedure (SOP) details the deployment, configuration, and verification of the zero-trust, asynchronous WhatsApp Personal Command Gateway for Agentic OS. It contains dedicated engineering guidance for onboarding Pakistani business numbers (`+92`) to overcome PTA / telco SMS filtering.

---

## 1. System Architecture Overview

```
                      +------------------------------------------+
                      |         Untrusted Public Internet        |
                      +------------------------------------------+
                                           |
                                  Meta / Twilio Webhook
                               (Encrypted TLS Ingress)
                                           v
+-----------------------------------------------------------------------------------+
| Next.js Gateway Layer (Public or Reverse Proxy / Cloudflare Tunnel)               |
|                                                                                   |
| 1. Ingest Raw Body Text (Prior to any JSON parsing)                              |
| 2. Cryptographic HMAC-SHA256 / SHA1 Verification (Timing-Safe Comparison)        |
| 3. Server-Side E.164 Strict Normalization & Allowlist Filter                      |
| 4. 24-Hour Deduplication Store (Replay Attack Shield)                             |
| 5. Deterministic Intent Parser & Sensitivity Matrix                               |
|                                                                                   |
|    +-----------------------------+         +-------------------------------+      |
|    | Insensitive (Read-Only)     |         | Sensitive (State-Mutating)    |      |
|    | Auto-Queues / Direct Answer |         | Triggers 2-Phase HITL FSM     |      |
|    +--------------+--------------+         +---------------+---------------+      |
|                   |                                        |                      |
|                   |                                 CSPRNG 6-Char Token           |
|                   |                              Salted SHA-256 (10m TTL)         |
|                   |                              WhatsApp Challenge Sent          |
|                   |                                        |                      |
|                   |               User replies "APPROVE <CODE>" (Max 3 attempts)  |
|                   |                                        |                      |
|                   +-------------------+--------------------+                      |
|                                       v                                           |
|                           Gateway Job Queue ("queued")                            |
+---------------------------------------+-------------------------------------------+
                                        |
                            Outbound Poll Only (TLS)
                            Authorization: Bearer <RELAY_TOKEN>
                            (Zero Inbound Open Ports / NAT Safe)
                                        v
+-----------------------------------------------------------------------------------+
| Air-Gapped Home PC / Agentic OS Runtime                                          |
|                                                                                   |
| - HomeRelayClient polls `GET /api/relay/jobs`                                     |
| - Leases job -> Transitions to "running"                                          |
| - Executes task locally within zero-trust capability sandbox                      |
| - Submits result via `POST /api/relay/jobs`                                       |
| - Gateway notifies verified WhatsApp user upon completion                         |
+-----------------------------------------------------------------------------------+
```

---

## 2. Meta WhatsApp Cloud API Onboarding (+92 Pakistani Numbers)

### 2.1 The PTA / Telco SMS Filtering Challenge
In Pakistan, the Pakistan Telecommunication Authority (PTA) and local cellular operators (Jazz / Mobilink, Telenor, Zong / CMPak, Ufone) operate aggressive Short Code Application-to-Person (A2P) spam filters and Do Not Disturb (DND) registries. 

International A2P SMS verification messages dispatched from Meta (Facebook) frequently encounter:
1. **Silent Drops**: The SMS gateway receives an `ACK` at the international aggregator level, but the local operator drops the packet before it hits the SIM card.
2. **Delayed Routing**: OTPs arrive after the 5–10 minute validity window has expired.
3. **Sender ID Masking Mismatches**: Unregistered alphanumeric sender IDs are blocked by PTA shortcode firewalls.

### 2.2 Standard Operating Procedure: Forcing Voice Call OTP Fallback
To reliably register a Pakistani `+923XXXXXXXXX` number on Meta WhatsApp Cloud API:

1. **Clean Phone Number State**:
   - The phone number must NOT be currently registered on the WhatsApp consumer app or WhatsApp Business mobile app.
   - If registered, open the mobile app: **Settings > Account > Delete my account** (or unregister the account). Wait 15 minutes for Meta's directory to update.

2. **Add Phone Number in Meta Business Suite**:
   - Navigate to **Meta Business Manager > WhatsApp Accounts > Settings > WhatsApp Manager**.
   - Under **Account Tools**, select **Phone Numbers**.
   - Click **Add Phone Number**:
     - Name: `Agentic OS Command Gateway`
     - Country: `Pakistan (+92)`
     - Phone number: `3001234567` (do not enter the leading `0`).

3. **Trigger the Voice Call Verification**:
   - During the verification method prompt, Meta will offer two choices: **Text message (SMS)** and **Phone call**.
   - **DO NOT select SMS.** Select **Phone call**.
   - If using the Graph API directly to register the number:
     ```bash
     curl -X POST \
       "https://graph.facebook.com/v20.0/<PHONE_NUMBER_ID>/request_code" \
       -H "Authorization: Bearer <SYSTEM_USER_ACCESS_TOKEN>" \
       -H "Content-Type: application/json" \
       -d '{
         "code_method": "VOICE_CALL",
         "language": "en_US"
       }'
     ```
   - An automated international telephone call will ring your device within 10–30 seconds.
   - Answer the call, transcribe the 6-digit numeric verification code spoken by the automated voice.

4. **Verify the Code**:
   ```bash
   curl -X POST \
     "https://graph.facebook.com/v20.0/<PHONE_NUMBER_ID>/verify_code" \
     -H "Authorization: Bearer <SYSTEM_USER_ACCESS_TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{
       "code": "123456"
     }'
   ```
   - The number status will immediately transition to **Connected (Green)**.

### 2.3 Meta Business Verification (Pakistan Entities)
For production tiering beyond test numbers:
- **Sole Proprietor / Freelance**: Submit FBR NTN Certificate (National Tax Number) matching the owner's legal CNIC name, accompanied by an official utility bill (LESCO, K-Electric, SNGPL) showing the same registered physical address.
- **Private Limited / LLP**: Upload SECP Certificate of Incorporation, Form A/29, and corporate bank statement bearing the business name.

### 2.4 Permanent System User Token Creation
Never use temporary 24-hour Developer Graph Explorer tokens for production:
1. Go to **Business Settings > Users > System Users**.
2. Click **Add**, assign Role: **Admin**.
3. Under **Assigned Assets**, assign your WhatsApp Business Account with **Full Control**.
4. Click **Generate New Token**:
   - Token Expiration: **Never**
   - Required Scopes:
     - `whatsapp_business_messaging`
     - `whatsapp_business_management`
5. Store this token securely as `WHATSAPP_ACCESS_TOKEN`.

---

## 3. Webhook Configuration in Meta Developer Portal

1. Navigate to your App in **Meta for Developers**:
   - Product: **WhatsApp** > **Configuration**.
2. **Callback URL**:
   - `https://your-domain.com/api/webhooks/whatsapp`
   (Or during development via secure tunnel: `https://<tunnel-id>.ngrok-free.app/api/webhooks/whatsapp`)
3. **Verify Token**:
   - Generate a high-entropy string (e.g., `openssl rand -hex 24`).
   - Configure it in `WHATSAPP_VERIFY_TOKEN`.
4. Click **Verify and Save**. Meta will send a `GET` challenge containing `hub.mode=subscribe` and `hub.verify_token`. The gateway validates it in constant time and responds with `hub.challenge`.
5. Under **Webhook Fields**, subscribe to:
   - `messages` (Mandatory for inbound commands).

---

## 4. Environment Variables Specification

Create or update `.env` with the following enterprise credentials:

```bash
# =============================================================================
# WhatsApp Command Gateway Configuration
# =============================================================================
# Active provider: "meta" (default) or "twilio"
WHATSAPP_PROVIDER=meta

# Meta WhatsApp Cloud API Credentials
WHATSAPP_APP_SECRET=your_meta_app_secret_hex_from_app_dashboard
WHATSAPP_VERIFY_TOKEN=your_configured_webhook_verify_token
WHATSAPP_ACCESS_TOKEN=your_permanent_system_user_token
WHATSAPP_PHONE_NUMBER_ID=your_registered_phone_number_id
WHATSAPP_API_VERSION=v20.0

# Twilio Credentials (Optional Failover Provider)
TWILIO_ACCOUNT_SID=ACXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_PHONE_NUMBER=+14155238886

# Zero-Trust Security Allowlist (Comma-separated E.164 authorized phone numbers)
WHATSAPP_ALLOWED_NUMBERS=+923001234567,+14155552671

# Air-Gapped Home Agent Relay Pre-Shared Secret
RELAY_AUTH_TOKEN=your_long_random_hex_relay_secret_token
```

---

## 5. Command Reference & Interaction Flows

### 5.1 Safe Read-Only Commands (Auto-Executed)
- **`STATUS`** or **`PING`**:
  Returns current gateway and local OS agent health, host uptime, and system load.
- **`DAILY BRIEF`**:
  Queries the business intelligence and mission engine, returning high-priority summaries.
- **`HELP`**:
  Returns the command manual.

### 5.2 High-Sensitivity Commands (HITL Protected)
Any command matching state-changing keywords (`RUN <action>`, `EXEC <command>`, `reboot`, `delete`, `deploy`, `format`):
1. **User sends**: `RUN deploy latest release`
2. **Gateway responds via WhatsApp**:
   ```
   ⚠️ Action Authorization Required

   Target Command: "deploy latest release"

   To authorize execution, reply with:
   👉 APPROVE 7K9P2X

   ⏳ Code valid for 10 minutes (3 attempts max).
   Reply CANCEL to abort.
   ```
3. **User replies**: `APPROVE 7K9P2X`
4. **Gateway responds**:
   ```
   ✅ Approval Confirmed! Executing: "deploy latest release"...
   You will receive a notification upon completion.
   ```
5. **Relay executes and notifies upon finish**:
   ```
   🎉 Task Completed Successfully
   Action: "deploy latest release"
   Result: Deployment succeeded with code 0.
   ```

### 5.3 Emergency Controls
- **`PANIC`** or **`LOCKDOWN`**:
  Immediately revokes all pending approval codes, halts queued jobs, and activates local runtime lockdown.
- **`CANCEL`**:
  Aborts any active pending approval challenge.

---

## 6. Running the Air-Gapped Home Agent Relay

On the local workstation (running Agentic OS):

```typescript
import { HomeRelayClient } from "@/lib/relay/home-client";

const client = new HomeRelayClient({
  gatewayUrl: "https://your-public-gateway.com",
  authToken: process.env.RELAY_AUTH_TOKEN!,
  pollIntervalMs: 2500,
});

// Starts outbound-only long polling loop
client.start();
console.log("Home Agent Relay polling active. Zero inbound ports opened.");
```
