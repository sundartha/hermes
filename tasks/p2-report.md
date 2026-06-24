# F1 Phase 2 — Sprach-Resolver + LLM-Schicht sprachabhaengig (Report)

Status: ABGESCHLOSSEN, committet (3a5749f).

## Umgesetzt
- `src/i18n/locales.js`: `localeFor(language)` -> Bundle mit vollem BCP-47 STT-Locale + Voice-Profil je Sprache (de/fr); unbekannt/null -> fail-safe `de` (R7).
- Sprachabhaengige LLM-Schicht in `src/claude.js`; Fallback `de` wenn `call.language` fehlt -> DE byte-identisch.

## Tests (gruen)
`test/f1-i18n-locale.test.js`: localeFor de/fr; unbekannt/null -> de; Bundle-Vertrag (BCP-47 + Voice); DE-Fallback byte-identisch.

## Offen (Folgephasen)
P3 (Renderer STT/TTS), P4 (statische Texte + Inbound-Wiring Nummer->Sprache), P5 (Realtime, optional). Block B (P6-9) = Geo-Nummern/Geld.
