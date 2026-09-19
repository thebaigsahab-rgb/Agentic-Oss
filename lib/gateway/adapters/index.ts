import type { WhatsAppAdapter, ProviderName } from "../types";
import { MetaWhatsAppAdapter, type MetaAdapterConfig } from "./whatsapp-meta";
import { TwilioWhatsAppAdapter, type TwilioAdapterConfig } from "./whatsapp-twilio";

export { MetaWhatsAppAdapter, TwilioWhatsAppAdapter };

export function getWhatsAppAdapter(
  provider?: ProviderName,
  config?: { meta?: MetaAdapterConfig; twilio?: TwilioAdapterConfig }
): WhatsAppAdapter {
  const selected =
    provider ||
    (process.env.WHATSAPP_PROVIDER as ProviderName) ||
    "meta";

  if (selected === "twilio") {
    return new TwilioWhatsAppAdapter(config?.twilio);
  }

  return new MetaWhatsAppAdapter(config?.meta);
}
