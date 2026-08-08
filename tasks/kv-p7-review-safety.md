# KV-P7 - unabhaengiger Safety-/Verhaltens-Review (Branch phase/kv-p7-latente-pfade @ 37d80b1)

Alles unten SELBST am ausgecheckten Branch nachgeprueft, nicht aus dem Plan-Doc uebernommen.

## 1. Korrektheits-Kern: Doppelbuchung? NEIN - Massnahme 4 wurde nicht gebaut

- `src/telephony/adapters/telnyx/voice.js:50-53` listet `text-to-speech` in `COST_RECORD_TYPES`;
  `:168` schliesst NUR `inference` aus (`UNASSIGNABLE_COST_RECORD_TYPES`); `:177-179` bildet
  `ASSIGNABLE_COST_RECORD_TYPES` als abgeleitete Gegenmenge -> `text-to-speech` IST zuordenbar.
- `src/billing/cost-truing.js:296-306` (`sumRecordMicroCents`) addiert typ-blind ueber alle
  zugeordneten Records -> `actualCostMicroCents` -> `bookCorrectionFor` ->
  `store.applyCostCorrectionCents` -> `bookCents`. Der TTS-Betrag steckt also im Ist-Betrag.
- Bestandstest pinnt das: `test/cost-truing-tts-characters.test.js:130`
  `actualCostMicroCents === 4_226_660` mit `"0 + 4010000 + 0 + 200000 + 16660"`; die `16660`
  sind exakt der `text-to-speech`-Beleg (`cost: "1.666E-4"`, 238 Zeichen).
- Im gesamten Diff existiert KEIN Preis-pro-Zeichen-Parameter, keine neue Env-Var, kein
  zweiter `bookCents`/`applyCostCorrectionCents`-Aufruf. `git diff master...HEAD` beruehrt
  `metering.js`/`cost-cross-check.js` gar nicht; in `cost-ledger-map.js` aendert sich NUR der
  `preisquelle`-Text der Zeile `play_tts_characters` (`kind: null, ledger: false, gate: false`
  unveraendert).
- `bookTtsCharactersFor` (`cost-truing.js:515-520`) tauscht `recordTenantTtsCharacters` gegen
  `recordRelayTtsCharacters` - beides ZEICHEN, kein Geld. Der Tenant-Bucket-Wert ist identisch
  (`recordRelayTtsCharacters` delegiert intern auf dieselbe Funktion), neu ist nur der
  zusaetzliche Plattform-Zyklus-Zaehler.
- => Die Gate-Achse wird durch diese Phase NICHT beschrieben. Kein Kunde zahlt zweimal.

## 2. Klaerung (tasks/kv-p7-tts-klaerung.md) - am Code belegt

(a)/(b)/(c) stichprobenweise nachgeprueft, alle Belegstellen tragen. Einziger Fehler: die
Datei zitiert `src/api-billing.js:160`; der tatsaechliche Pfad ist `src/routes/api-billing.js:160`
(Inhalt stimmt: `ttsQuota: store.platformTtsUsageView(nowIso)`). Kosmetisch.

## 3. Guards

- Beide WARN (`fatal: false`), verdrahtet ueber `warnLatentCostPaths` in der Diagnose-Gruppe
  NACH allen exit(1)-Gates (`src/boot.js:370`). Kein `process.exit`, kein Refusal.
- `latentCostPathFindings` ist arg-injiziert und config-frei; Gegenbeispiele KV-P7-2/-4/-5.
- Guard 2 prueft die SACHE (`realtimeMidCallBudgetCheck`), nicht nur `VOICE_ENGINE=realtime`.
  Die Tatsachenbehauptung ist testgepinnt: KV-P7-6 grept `src/bridge.js` gegen einen
  tatsaechlichen `blockingBudgetAxis(`-AUFRUF, KV-P7-7 belegt den Gegensatz in `claude.js`
  (`roundStopReason`). Selbst nachgeprueft: `bridge.js` kennt nur `endTimer` (Max-Dauer,
  gesetzt in `MEDIA_EVENT.START`, `:303`), keine Geld-Achse.

## 4. Massnahme 3 - nicht flag-only

Zwei voneinander unabhaengige Belege:
- `recordRelayTtsCharacters` speist `platformTtsUsage` (Kontingent-Zaehler) aus dem
  Ist-Abgleich, UNABHAENGIG von `ELEVENLABS_PLAY_TTS_ENABLED` (der Sweep liest das Flag nicht).
  Test KV-P7-8 (state-ops) und KV-P7-12 (ueber den ganzen Sweep).
- `ttsQuotaCoverageBannerLine` wird in `logBootBanner` UNKONDITIONAL gedruckt
  (`src/boot.js:653`), mit dem UNTERGRENZE-Vorbehalt. Im echten Boot verifiziert.

## 5. Eigene Verifikation

- `npm test`: **3878/3878 gruen, 0 fail** (103 s, ein Lauf, kein Flake-Nachfahren noetig).
- Eigener Server-Start (Kindprozess ueber `test/helpers.js startServer()`, BASE_ENV +
  geseedete Nummer, PORT dynamisch, DATA_DIR Temp): `/healthz` = **200**, Banner enthaelt
  `ElevenLabs-Kontingent: TTS_CHARACTER_QUOTA=39981 ... (UNTERGRENZE - nur belegte Anrufe)`,
  KEINE der beiden Guard-Meldungen. Voice-Engine `budget`, `ELEVENLABS_PLAY_TTS_ENABLED=false`.
  (Ein Start mit blankem Env scheitert vorher an Bestands-Gates: fehlende Pflicht-Keys bzw.
  "Keine aktive Nummer im Store" - beides Bestand, nicht KV-P7.)
- Mutationsprobe (5 Mutationen, je Lauf `kv-p7-latent-paths` + `cost-truing-tts-characters`,
  Baseline 18/18 gruen):
  | Mutation | rot |
  |---|---|
  | `if (playTtsEnabled)` -> `if (!playTtsEnabled)` | KV-P7-1,2,3,4,5,15 |
  | `!realtimeMidCallBudgetCheck` -> ohne `!` | KV-P7-3,4 |
  | `REALTIME_MID_CALL_BUDGET_CHECK = true` | KV-P7-3,6 |
  | Relay speist Kontingent-Zaehler nicht | KV-P7-8,12,13 |
  | Banner-Zeile entfernt | KV-P7-15 |
  Arbeitsbaum danach sauber (`git status` leer), keine verwaisten Testserver.

## 6. Befunde (kein Blocker)

**C1 (Concern, mittel) - die einmal-pro-Zyklus-Warnung wird jetzt geteilt.**
`bumpPlatformTtsQuota` setzt `row.warnedCycle` beim Schwellen-Uebertritt; danach liefert es fuer
DENSELBEN Zyklus nur noch `null`. Da der Relay-Pfad diesen Zaehler ab jetzt live speist, kann er
die Warnung beanspruchen - und meldet sie nur ueber `emitFinding` (WARN + Audit, bewusst KEINE
SMS). Der Play-TTS-Pfad haengt am lauteren Kanal (`onTtsQuotaWarning` -> `sendBootstrapAlertSms`,
`src/server.js:187-191`). Wird Play-TTS spaeter eingeschaltet, kann diese SMS fuer den Zyklus
also ausbleiben, weil der Relay die Meldung schon verbraucht hat. Heute kein Verlust (Play-TTS
aus, der SMS-Pfad laeuft ohnehin nicht), aber die Folge ist im Code nicht benannt.

**C2 (Concern, klein) - frueheres Degradieren.** `ttsQuotaExhausted` liest denselben Zaehler.
Relay-Verbrauch fuellt ihn, ein spaeter eingeschaltetes Play-TTS faellt also frueher auf
Azure-`<Say>` zurueck. Semantisch richtig (EIN ElevenLabs-Konto = EIN Kontingent), Degradation
statt Sperre - aber ebenfalls nicht als Konsequenz notiert.

**C3 (kosmetisch)** - Pfadangabe `src/api-billing.js` in der Klaerung, s. Abschnitt 2.

## 7. Absolute Regeln

Keine neue Route, keine Auth-Aenderung, `disclosureSentence` unberuehrt, keine neue Dependency,
keine neue Env-Var (also keine Verdrahtungspflicht), kein Secret im Banner oder in einem Befund
(die Meldungen nennen nur Env-VARIABLENNAMEN, die Banner-Zeile nur `TTS_CHARACTER_QUOTA`).
Play-TTS und Realtime bleiben aus - `config.js` ist im Diff nicht enthalten.
