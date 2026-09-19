"use client";

import { useEffect, useId, useState } from "react";
import { Cpu, Globe2, KeyRound, RefreshCw, ShieldCheck, Sparkles, Trash2 } from "lucide-react";
import type { AiKeyProvider, AiModelsResponse, AiProvider, PublicSettings, SettingsUpdate } from "@/lib/types";
import { AI_KEY_PROVIDERS, AI_PROVIDER_LABELS, DEFAULT_AI_MODELS, DEFAULT_LOCAL_AI_URLS, isLocalAiProvider, localAiBaseUrl } from "@/lib/ai-providers";
import { modelOverrideAfterProviderChange } from "@/lib/ai-settings";
import { SettingsInput } from "@/components/settings-input";
import styles from "./ai-provider-settings.module.css";

export type AiSettingsDraft = NonNullable<SettingsUpdate["ai"]> & Pick<PublicSettings["ai"], "keySet" | "keySource">;

export function AiProviderSettings({ value, onChange }: {
  value: AiSettingsDraft;
  onChange: (value: AiSettingsDraft) => void;
}) {
  const id = useId();
  const provider = value.provider;
  const local = isLocalAiProvider(provider);
  const pendingKey = provider === "none" ? "" : value.apiKeys?.[provider] || "";
  const savedKey = provider !== "none" && Boolean(value.keySet[provider]);
  const clearingKey = provider !== "none" && Boolean(value.clearKeys?.includes(provider));
  const baseUrl = local ? value.localBaseUrls?.[provider] ?? DEFAULT_LOCAL_AI_URLS[provider] : "";
  const [reload, setReload] = useState(0);
  const [state, setState] = useState<{ provider: AiProvider; loading: boolean; data?: AiModelsResponse; error?: string }>({ provider: "none", loading: false });

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      if (provider === "none") { setState({ provider, loading: false }); return; }
      if (!local && !pendingKey && (!savedKey || clearingKey)) {
        setState({ provider, loading: false });
        return;
      }
      setState({ provider, loading: true });
      try {
        if (local) localAiBaseUrl(provider, baseUrl);
        const response = await fetch("/api/ai/models", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({ provider, apiKey: pendingKey || undefined, baseUrl: local ? baseUrl : undefined, refresh: reload > 0, useSavedKey: !clearingKey }),
        });
        const payload = await response.json() as AiModelsResponse;
        if (!response.ok || payload.error) throw new Error(payload.error || "Could not load models. Try again.");
        if (!controller.signal.aborted) setState({ provider, loading: false, data: payload });
      } catch (error) {
        if (!controller.signal.aborted) setState({ provider, loading: false, error: error instanceof Error ? error.message : "Could not load models." });
      }
    }, pendingKey ? 650 : 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [provider, local, pendingKey, savedKey, clearingKey, baseUrl, reload]);

  const active = state.provider === provider ? state : { provider, loading: false };
  const models = active.data?.models || [];
  const modelAvailable = !value.model || models.some((model) => model.id === value.model);
  const defaultModel = active.data?.defaultModel || (provider === "none" ? "" : DEFAULT_AI_MODELS[provider]);
  const keyStatus = (keyProvider: AiKeyProvider) => value.keySource[keyProvider] === "environment"
    ? "Available from this computer’s environment"
    : value.keySet[keyProvider] ? "Saved privately on this computer" : "Not configured";

  return <div className={styles.root}>
    <div className="settings-title">
      <Sparkles />
      <div>
        <p className="eyebrow">Background intelligence</p>
        <h2>Choose your intelligence</h2>
        <p>Rank Industry updates, explain and prioritize Mentions, and turn newsletters into deduplicated news. Use a cloud provider or a model running on this computer.</p>
      </div>
    </div>
    <div className={styles.connectionGrid}>
      <div className="settings-field">
        <label htmlFor={`${id}-provider`}>Active provider<small>Only this provider runs background AI tasks.</small></label>
        <select id={`${id}-provider`} name="cc-ai-provider-choice" autoComplete="off" value={provider} onChange={(event) => {
          const next = event.target.value as AiProvider;
          onChange({ ...value, provider: next, model: modelOverrideAfterProviderChange(provider, next, value.model) });
        }}>
          <option value="none">{AI_PROVIDER_LABELS.none}</option>
          <optgroup label="Cloud providers">{AI_KEY_PROVIDERS.filter((item) => !isLocalAiProvider(item)).map((item) => <option key={item} value={item}>{AI_PROVIDER_LABELS[item]}</option>)}</optgroup>
          <optgroup label="On this computer">{AI_KEY_PROVIDERS.filter(isLocalAiProvider).map((item) => <option key={item} value={item}>{AI_PROVIDER_LABELS[item]}</option>)}</optgroup>
        </select>
      </div>
      <div className="settings-field">
        <label htmlFor={`${id}-model`}>Model<small>{local ? "Only already-loaded local text models are listed." : "Live options from this provider’s API, using your key."}</small></label>
        <select id={`${id}-model`} name="cc-ai-model-choice" autoComplete="off" value={value.model} disabled={provider === "none"} onChange={(event) => onChange({ ...value, model: event.target.value })}>
          <option value="">Default{defaultModel ? ` · ${defaultModel}` : local ? " · available loaded model" : ""}</option>
          {value.model && !modelAvailable && <option value={value.model} disabled>{value.model} · {active.loading ? "checking availability" : "not in current list"}</option>}
          {models.map((model) => <option key={model.id} value={model.id}>{model.label}{local ? model.contextLength ? ` · ${model.contextLength.toLocaleString()} context` : " · context unknown" : ""}</option>)}
        </select>
      </div>
      <div className="settings-field">
        <label htmlFor={`${id}-backup`}>Backup provider<small>Failover target if active provider errors or hits rate limits.</small></label>
        <select id={`${id}-backup`} name="cc-ai-backup-choice" autoComplete="off" value={value.backupProvider || "nvidia"} onChange={(event) => onChange({ ...value, backupProvider: event.target.value as AiProvider })}>
          <option value="none">None — fail on error</option>
          <optgroup label="Cloud providers">{AI_KEY_PROVIDERS.filter((item) => !isLocalAiProvider(item) && item !== provider).map((item) => <option key={item} value={item}>{AI_PROVIDER_LABELS[item]}</option>)}</optgroup>
          <optgroup label="On this computer">{AI_KEY_PROVIDERS.filter((item) => isLocalAiProvider(item) && item !== provider).map((item) => <option key={item} value={item}>{AI_PROVIDER_LABELS[item]}</option>)}</optgroup>
        </select>
      </div>
    </div>

    {provider !== "none" && <>
      <div className={`${styles.modeCard} ${local ? styles.local : ""}`}>
        {local ? <Cpu size={23} /> : <Globe2 size={23} />}
        <div>
          <b>{local ? "Local curation, your model" : "Cloud curation + public-web research"}</b>
          <p>{local ? "No paid API key required. Keep a text model loaded with enough context for the news being processed. The app checks its reported capacity and pauses oversized requests instead of cutting evidence or increasing your memory allocation. Built-in collectors find sources; local models summarize and rank them, without live web research." : "Cloud models can curate collected stories and research public mentions. Usage is billed by your provider; an API key is separate from a chat subscription."}</p>
        </div>
      </div>

      {local && <div className={styles.connectionGrid}>
        <div className="settings-field">
          <label htmlFor={`${id}-endpoint`}>Local server address<small>{provider === "lmstudio" ? "LM Studio → Developer → Start server. Use a current version that reports the loaded context window. Long briefs can need a larger window than the app's default." : "Start Ollama and keep a local model loaded. Choose a sufficient context window in Ollama settings; this app preserves that allocation. Cloud models are excluded."}</small></label>
          <SettingsInput id={`${id}-endpoint`} fieldKey={`${provider}-local-endpoint`} type="url" value={baseUrl} placeholder={DEFAULT_LOCAL_AI_URLS[provider]} onChange={(event) => onChange({ ...value, localBaseUrls: { ...value.localBaseUrls, [provider]: event.target.value } })} />
        </div>
        <div className="settings-field">
          <label htmlFor={`${id}-local-token`}>Server token <span className={styles.optional}>Optional</span><small>{keyStatus(provider)}. Only needed if you enabled server authentication.</small></label>
          <SettingsInput id={`${id}-local-token`} fieldKey={`${provider}-server-token`} type="password" value={pendingKey} placeholder={savedKey ? "Saved token · leave blank to keep" : "No token needed by default"} onChange={(event) => onChange({ ...value, apiKeys: { ...value.apiKeys, [provider]: event.target.value }, clearKeys: value.clearKeys?.filter((item) => item !== provider) })} />
          {value.keySource[provider] === "settings" && <button type="button" className="text-button danger" onClick={() => onChange({ ...value, apiKeys: { ...value.apiKeys, [provider]: "" }, clearKeys: [...new Set([...(value.clearKeys || []), provider])], keySet: { ...value.keySet, [provider]: false }, keySource: { ...value.keySource, [provider]: "none" } })}><Trash2 size={13} /> Clear saved token</button>}
        </div>
      </div>}

      <div className={styles.modelStatus} aria-live="polite">
        <div>{active.loading ? <span>Checking available models…</span> : active.error ? <span className={styles.error}>{active.error}</span> : active.data ? <span>{models.length ? `${models.length} ${local ? "loaded local" : "available text"} model${models.length === 1 ? "" : "s"}` : local ? "No loaded local text models found. Load one in your model app, then reload this list." : "No compatible text models were returned for this key."}{active.data.cached ? " · cached" : ""}</span> : <span>{local ? "Checking the local server…" : "Add a key below to load your model choices. Default remains available."}</span>}</div>
        <button className="button button-outline" type="button" disabled={active.loading} onClick={() => setReload((current) => current + 1)}><RefreshCw size={13} className={active.loading ? styles.spin : undefined} /> Reload models</button>
      </div>
      {value.model && active.data && !modelAvailable && <p className={styles.error}>The saved model is not available in this list. Choose Default or another available model before running AI tasks.</p>}
    </>}

    <div className={`source-editor ${styles.keys}`}>
      <div className="source-editor-head"><b><KeyRound size={13} /> Cloud provider keys</b><span>Only your selected provider is called.</span></div>
      {AI_KEY_PROVIDERS.filter((item) => !isLocalAiProvider(item)).map((item) => <div className={`ai-key-row ${provider === item ? styles.selectedKey : ""}`} key={item}>
        <div><b>{AI_PROVIDER_LABELS[item]}{provider === item && <span className={styles.activeBadge}>Active</span>}</b><small>{keyStatus(item)}</small></div>
        <SettingsInput aria-label={`${AI_PROVIDER_LABELS[item]} API key`} fieldKey={`${item}-provider-key`} type="password" value={value.apiKeys?.[item] || ""} placeholder={value.keySet[item] ? "Configured · leave blank to keep" : "Paste an API key"} onChange={(event) => onChange({ ...value, apiKeys: { ...value.apiKeys, [item]: event.target.value }, clearKeys: value.clearKeys?.filter((entry) => entry !== item) })} />
        {value.keySource[item] === "settings" && <button className="text-button danger" type="button" onClick={() => onChange({ ...value, apiKeys: { ...value.apiKeys, [item]: "" }, clearKeys: [...new Set([...(value.clearKeys || []), item])], keySet: { ...value.keySet, [item]: false }, keySource: { ...value.keySource, [item]: "none" } })}><Trash2 size={13} /> Clear saved key</button>}
      </div>)}
    </div>
    <div className="settings-caveat">
      <ShieldCheck size={17} />
      <p>Saved keys stay server-side and are never sent back to your browser. Newsletter text, with email addresses and subscriber tracking links masked, goes only to your selected provider. Tasks, reminders, and other private connector content are not sent. {local ? "Local endpoints are restricted to this computer; disable LM Link, remote forwarding, or other proxy features in your model app if you want processing to stay on this computer. This app does not download or load models for you." : "Background processing pauses on provider failure, while saved stories remain available."}</p>
    </div>
  </div>;
}
