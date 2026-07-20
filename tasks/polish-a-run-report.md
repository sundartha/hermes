# PLAN-POLISH-A — Gesamt-Ausfuehrungsreport (Note B -> A)

**Stand:** 2026-07-18 · **Ergebnis:** ALLE 20 Phasen + PA-21-Folgephase gemergt, verhaltens-erhaltend, KEIN Deploy/Push.
**master:** `9e8d59a` (Ausgang `776760e`) · **Suite:** 2362 -> 2422 Tests, 0 Fehler.

Ausfuehrung: pro Phase EIN `phase-impl-lean`-Lauf (per-run-Skript, Phase hart gepinnt, Modell-Pins
Opus=Plan+Safety / Sonnet=Impl/Audit/Fix/Report), dualer Review als hartes Gate, danach Lead-Verifikation
(gruene Suite auf dem Branch im Wegwerf-Worktree) + `--no-ff`-Merge. Owner-WIP durchgehend unangetastet.

## Phasen-Status (Merge-Commits)

| Phase | Merge | Suite | Kern |
|---|---|---|---|
| PA-1  | f73b84e | 2367 | Geteilter Max-Dauer-Helfer (src/call-duration.js, MS_PER_SECOND) + bridge-finalize-Wiring-Test; state-ops config-frei (OQ-1); finalize NICHT umgestellt (OQ-2) |
| PA-2  | c1d79dc | 2368 | **S1** kein Provisioning-Enqueue vor persistierter Job-Spur (.then nach persist) |
| PA-3  | 76e7cf4 | 2370 | **S1** setTenant vor hydrateTenantInto (RLS-Datenverlust) + hydrateTenant-Helfer |
| PA-4  | 478f75c | 2374 | **S1** numEnv Voll-String-Muster fail-closed (Int+Float, .trim() zuerst) |
| PA-5  | 34fdf25 | 2383 | setOnceTimestamp-Helfer (markAnswered/markSummarySmsSent/markBilled) |
| PA-6  | ee54ae8 | 2388 | flushOwnScoped-Helfer (own-Filter+deleteMissing 3x) |
| PA-7  | b7d7ce8 | 2388 | CALL_CONTROL_LOG_PREFIX-Konstante (14 Stellen) |
| PA-8  | 9c962c5 | 2388 | UiRenderer/Detector-Fabriken (DIP-Seam erhalten) |
| PA-9  | 9eb23bc | 2396 | webAuthWithStatusGate (Higher-Order, 4 Status x 2 Middlewares) |
| PA-10 | 348541e | 2399 | dailySmsCap fail-open -> lauter Guard (!Number.isFinite -> throw) |
| PA-11 | 9222e19 | 2402 | stripTrailingSlash-Helfer (7 URL-Configs) |
| PA-12 | 5fca70f | 2408 | Config-Namespace-Shim: 13 Namespaces als Getter (dual-read, Flach-Alias erhalten) |
| PA-13 | 97c40e3 | 2408 | Migration A1: billing/*+worker/*+sms-summary |
| PA-14 | 5cc3317 | 2409 | Migration A2: Boot-Gates (DEV_LOGIN_ENABLED-Roh-Schloss erhalten) |
| PA-15 | 544dbfe | 2414 | Migration B: Signaturen+outbound-gates+voice.js+stripe-webhook |
| PA-16 | be98e8b | 2414 | Migration C: telephony-Rest+store+bridge+claude.js (disclosureSentence byte-identisch) |
| PA-17 | e9deefe | 2415 | Migration D: auth.js+web-auth.js (4 mcpAuth-Modi+safeEqual unveraendert) |
| PA-18 | 0ccbebd | 2420 | Migration E: Rest src (25 Dateien); src/-Gate 0 reale Flach-Zugriffe |
| PA-19 | 960974e | 2420 | Migration F: scripts/*.mjs (exec-verifiziert) |
| PA-20 | bd27eee | 2422 | **FLIP**: 99 Flach-Aliase entfernt; Namespace einzige Oberflaeche; +5 scripts/*.js |
| PA-21 | 9e8d59a | 2422 | C2-Folgephase: ~50 veraltete Flach-config-Kommentare (32 Dateien) auf Namespace-Form; nur Kommentare |

## Die 3 S1-Fixes — rot-vor-Fix vom Lead SELBST bewiesen

- **PA-2** (Enqueue-Order): neuer Test ohne Fix `pass0/fail1`, mit Fix `pass1/fail0`.
- **PA-3** (RLS-setTenant): unter **NOBYPASSRLS**-Rolle; ohne setTenant im Helfer RLS-Test `pass9/fail1`
  (Superuser-Gegenprobe bleibt gruen -> Rolle ist beweistragend), mit Fix Suite 2370/0.
- **PA-4** (numEnv): ohne Fix genau `T-P2-07/08` rot (`'120abc'`/`'8.5abc'` -> Fatal), Positiv-Test
  `'  6  '` bleibt gruen (PM-4 Whitespace-Erhalt, kein Live-Outage-Risiko).

## Vom Gate/Review gefangene echte Befunde (haetten sonst durchrutschen koennen)

1. **PA-17**: der erste Impl hielt `web-auth.js` faelschlich fuer config-frei; der Review fand 6 flache
   config-Zugriffe in `makeOidc()` -> in Runde 2 migriert. (Ein spaeterer Flip haette hier TypeErrors
   im OIDC-Login erzeugt.)
2. **PA-20**: die erweiterte Vollstaendigkeitspruefung (dot+bracket+destructuring) fand 5 `scripts/*.js`,
   die PA-19 (nur `.mjs`) uebersehen hatte -> PA-20a migrierte sie VOR dem Alias-Entfernen.
3. **PA-10**: der Auditor haertete den Guard von `typeof !== "number"` auf `!Number.isFinite` (NaN/Infinity
   sind `typeof "number"` -> haetten die Toll-Fraud-Kappe still umgangen).
4. **PA-3**: Review verhinderte, dass der setTenant+hydrate-Fix als NEUE Duplizierung an 2 Call-Sites
   stehen bleibt (caller-discipline statt struktureller Sicherheit) -> hydrateTenant-Helfer (G27).

## Absolute Regeln — nachweislich unangetastet

- Offenlegungssatz (`claude.js disclosureSentence`) byte-identisch (PA-16 diff-verifiziert).
- Signatur-Gates (Twilio HMAC / Telnyx Ed25519 / Stripe HMAC) fail-closed, `skipTwilioSignatureCheck`/
  `stripeWebhookSecret` liefern denselben Wert (PA-15 Zeile-fuer-Zeile + Wiring-Tests 34/34).
- Auth fail-closed: 4 mcpAuth-Modi + `safeEqual` (timing-sicher) unveraendert (PA-17).
- Budget-/Land-/Stundenlimit-Gates: PA-4 haertet ihr Parsing fail-closed; per-Call ueber `config.safety.*`
  gelesen, Runtime-Smoke bestaetigt.

## Abschluss-Verifikation

- **Suite:** 2422/0 (isoliert gruen; ein einzelner Voll-Last-Flake bei PA-15 im Erstlauf, Re-Run gruen).
- **Flip fail-closed:** `config.<flatKey>` wirft TypeError; `config.billing.maxBudgetCents = 800` ok.
- **grep-Beweis:** 0 Flach-/Bracket-/Destrukturierungs-Zugriffe repo-weit (src+scripts, nur Code).
- **Runtime-Smoke (post-Flip, lokal gebootet):** `/healthz`=200; `POST /voice/incoming`=200 (gueltiges
  TwiML, de-DE-Greeting); `POST /voice/outbound`=200 (outbound-Gates ausgewertet, `<Hangup/>`); keine
  TypeError/Errors im Server-Log.

## Offene Punkte (bewusst, nicht blockierend)

- **C2-Kommentar-Kosmetik ERLEDIGT (PA-21):** ~50 veraltete Flach-config-Kommentare auf die
  Namespace-Form korrigiert. Die verbliebenen 4 Flach-Referenzen in Kommentaren sind BEWUSST korrekt
  (`config.ownerName`/`config.ownerNumber`/`config.telnyxAssistantId` = 'existiert nicht mehr'-Notizen;
  `config.format` = Falsch-Treffer `output_config.format`). C2 im Scope sauber.
- **Kein Deploy/Push** (wie beauftragt): Live laeuft separat ueber `upstream`; dieser Repo-Stand ist rein
  lokal. Track B (Infra-/URL-Rebrand) unberuehrt.
- Owner-WIP (`apps/hermes-animation-lab/*`, `src/mcp-server-info.js`, `tasks/todo.md`,
  `test/mcp-server-icon.test.js`, `aura.ts`) durchgehend unangetastet; die PA-18-Merge-Kollision auf
  `mcp-server-info.js` wurde per `git apply --3way`-Patch-Dance geloest (WIP unstaged wiederhergestellt).

## Erwartung fuers Bestaetigungs-Audit

Note A: alle 3 S1 mit rot-vor-Fix-Regressionstest geschlossen; alle bestaetigten S2 gebuendelt;
`config.js` auf die Namespace-Oberflaeche geflippt (0 Flach-Zugriff repo-weit); C2-Kommentar-Kosmetik
in PA-21 nachgezogen. Ein Folge-Audit im Scope sollte **0 S1 / 0 S2 / 0 C2** finden.
