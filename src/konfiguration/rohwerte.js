import { authRohwerte } from "./rohwerte-auth.js";
import { billingRohwerte } from "./rohwerte-billing.js";
import { llmRohwerte } from "./rohwerte-llm.js";
import { mailRohwerte } from "./rohwerte-mail.js";
import { metricsRohwerte } from "./rohwerte-metrics.js";
import { privacyRohwerte } from "./rohwerte-privacy.js";
import { provisioningRohwerte } from "./rohwerte-provisioning.js";
import { researchRohwerte } from "./rohwerte-research.js";
import { safetyRohwerte } from "./rohwerte-safety.js";
import { serverRohwerte } from "./rohwerte-server.js";
import { storeRohwerte } from "./rohwerte-store.js";
import { telephonyRohwerte } from "./rohwerte-telephony.js";
import { telnyxRohwerte } from "./rohwerte-telnyx.js";
import { tenancyRohwerte } from "./rohwerte-tenancy.js";
import { voiceRohwerte } from "./rohwerte-voice.js";
import { werkzeugRohwerte } from "./rohwerte-werkzeug.js";

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
