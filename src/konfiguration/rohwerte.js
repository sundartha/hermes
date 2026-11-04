import { researchRohwerte } from "./rohwerte-research.js";
import { metricsRohwerte } from "./rohwerte-metrics.js";
import { telnyxRohwerte } from "./rohwerte-telnyx.js";
import { werkzeugRohwerte } from "./rohwerte-werkzeug.js";
import { storeRohwerte } from "./rohwerte-store.js";
import { privacyRohwerte } from "./rohwerte-privacy.js";
import { mailRohwerte } from "./rohwerte-mail.js";
import { serverRohwerte } from "./rohwerte-server.js";
import { telephonyRohwerte } from "./rohwerte-telephony.js";
import { tenancyRohwerte } from "./rohwerte-tenancy.js";
import { provisioningRohwerte } from "./rohwerte-provisioning.js";
import { authRohwerte } from "./rohwerte-auth.js";
import { llmRohwerte } from "./rohwerte-llm.js";
import { safetyRohwerte } from "./rohwerte-safety.js";
import { voiceRohwerte } from "./rohwerte-voice.js";
import { billingRohwerte } from "./rohwerte-billing.js";

export function baueRohwerte(umgebung, beigaben) {
  return {
    ...safetyRohwerte(umgebung),
    ...billingRohwerte(umgebung, beigaben),
    ...provisioningRohwerte(umgebung),
    ...authRohwerte(umgebung),
    ...mailRohwerte(umgebung),
    ...llmRohwerte(umgebung, beigaben),
    ...telnyxRohwerte(umgebung),
    ...voiceRohwerte(umgebung),
    ...telephonyRohwerte(umgebung),
    ...tenancyRohwerte(umgebung),
    ...serverRohwerte(umgebung, beigaben),
    ...storeRohwerte(umgebung),
    ...metricsRohwerte(umgebung),
    ...privacyRohwerte(umgebung),
    ...researchRohwerte(umgebung),
    ...werkzeugRohwerte(umgebung),
  };
}
