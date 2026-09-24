// ---- Geteilte Eingabepruefungen fuer Outbound-Call-Anfragen ----------------------
// T2-13 (N-10, Schritt 3): reiner Extract aus src/routes/api-calls.js (POST /api/calls) -
// dieselben zwei Sprach-Ablehnungen braucht jetzt auch die Bestaetigungs-Vorschau
// (POST /api/call-confirmations, src/routes/api-call-confirmations.js), damit die Vorschau
// GENAU dieselbe 400-Antwort liefert wie das spaetere echte Waehlen (keine zweite,
// abweichende Kopie). Keine Verhaltensaenderung - woertlich verschoben.
import { SUPPORTED_LANGUAGES } from "../i18n/locales.js";

// P4a (F-2): die zwei Ablehnungen des Sprachwunsches. Beide sind reine EINGABEfehler und
// laufen deshalb wie die Bestands-400er VOR jedem Gate - ohne Audit, ohne Metrik
// (dieselbe Regel wie bei to/objective und E164_FORMAT_ERROR). Die unterstuetzten Codes
// stehen IM error-String: der MCP-Weg reicht nur json.error an das aufrufende Modell
// weiter (mcp-tools.js#api), ein Zusatzfeld saehe es nie. code/supported reisen zusaetzlich
// fuer maschinelle Leser. Englisch, weil hier das Client-MODELL liest, nicht der Tenant
// (Systemgrenze O14) - Gate-Ablehnungen an den Tenant bleiben davon unberuehrt.
export const UNSUPPORTED_LANGUAGE = "unsupported_language";
export const LANGUAGE_UNAVAILABLE = "language_unavailable";

export const unsupportedLanguageBody = () => ({
  error: `${UNSUPPORTED_LANGUAGE}: language must be one of ${SUPPORTED_LANGUAGES.join(", ")}`,
  code: UNSUPPORTED_LANGUAGE,
  supported: SUPPORTED_LANGUAGES,
});

// P4a/E-1 (hartes Gate): der Wunsch gilt NUR auf dem Sprechweg, der Gespraechs- und
// Offenlegungssprache getrennt beantwortet (ElevenLabs, elevenlabs/call-locale.js). Der
// TeXML-Zweig rendert den Offenlegungssatz aus call.language (claude.js
// disclosureSentence) - dort machte ein Wunsch die Sprache der PFLICHTAUSSAGE
// client-bestimmt, und genau das verbietet F-2 Punkt 4 (PM-2). LAUT abgelehnt statt still
// ignoriert: ein wirkungsloses Feld IST der Defekt, gegen den diese Phase gebaut ist.
export const languageUnavailableBody = () => ({
  error:
    `${LANGUAGE_UNAVAILABLE}: this deployment cannot separate the spoken language from the ` +
    "mandatory AI disclosure - omit language",
  code: LANGUAGE_UNAVAILABLE,
});
