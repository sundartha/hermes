# PLAN-POLISH-A — Finale Qualitaets-Runde (Note B -> Note A)

**Stand:** 2026-07-17 · **Typ:** Strategie-/Ausfuehrungsplan (verhaltens-erhaltend, Code-only, kein Deploy)
**Quelle:** `tasks/clean-code-confirm-audit-2026-07-17.md` (Gesamtnote **B**), gegen den aktuellen
`master`-Stand re-verifiziert (Dynamic Workflow, 32 Agenten, adversarielle Verifikation je Befund).

> Dieser Plan wird NICHT in dieser Session umgesetzt. Er beschreibt eine Kette kleiner,
> unabhaengig testbarer, verhaltens-erhaltender Phasen, die in einer spaeteren, frischen
> Ausfuehrungs-Session je als EIN `phase-impl-lean`-Lauf abgearbeitet werden. Der fertige
> Kickoff-Prompt steht am Ende (Abschnitt 8).

---

## 1. Ziel

Clean-Code-**Note A** erreichen, indem die drei strukturellen Rest-Risiken des Bestaetigungs-Audits
geschlossen werden — ohne beobachtbares Verhalten zu aendern (ausser den drei S1-Fixes und einem
fail-open->fail-closed-Guard):

1. **3 bestaetigte S1** (Korrektheit/Sicherheit) — je mit einem **Regressionstest, der die alte
   Luecke OHNE Fix rot reproduziert** (wie es die bestehende Race-Suite vormacht).
2. **Bestaetigte S2-Duplizierungen** verhaltens-erhaltend zu benannten Helfern/Konstanten buendeln —
   sicherheitsrelevante zuerst.
3. **`config.js`-Hub** (der eigentliche A-Blocker: 99 flache Top-Level-Keys, Fan-in 31 in `src/`,
   72 repo-weit) **inkrementell** entschaerfen: Namespaces hinter dem bestehenden `guardedConfig`-Proxy,
   **Shim zuerst** (Flach-Alias bleibt lauffaehig), dann Importeur-Cluster nach aufsteigendem Risiko,
   Alias-Flip erst nach grep-belegter Vollmigration. **Kein Big-Bang.**

## 2. Umfang

- **Dateien:** nur `src/`, `test/` und (im config-Block) `scripts/*.mjs`.
- Reine Qualitaets-, Robustheits- und Struktur-Arbeit. **Verhaltens-Aenderung ausschliesslich** in
  den drei S1-Fixes und im `dailySmsCap`-Guard (fail-open -> fail-closed).
- Jede Phase endet mit **gruener Voll-Suite** (aktuell 2362 Tests) und — bei S1 — dem explizit
  verifizierten **rot-vor-Fix**.

## 3. Nicht-Ziele

- **Kein Deploy, kein Live-Flip, kein Push nach upstream** — reiner Repo-Stand (Deploy ist separat,
  laeuft ueber `upstream`/jonas986, nicht Teil dieser Runde).
- Kein neues Feature, kein neuer Endpunkt, **keine Umbenennung von Env-Var-Namen** (nur der
  `config.<key>`-Zugriffspfad wird verschachtelt).
- **Keine Aufweichung/Entfernung von Safety-Gates** (Allowlist/Denylist/Land-Gate/Stundenlimit/
  Budget-Guard/Max-Dauer/Signaturpruefung), des **Offenlegungssatzes** oder von **Auth-fail-closed**.
- **Keine Aktivierung/Umstellung der dormanten Realtime-Engine.** `bridge.js finalize` wird
  **NICHT** auf `terminateAndBillCall` umgestellt (nur Wiring-Test + praeziser Kommentar — siehe
  Offene Frage OQ-2).
- **Keine** Vollvereinheitlichung der bewusst config-freien `state-ops.js`-Max-Dauer-Formel (dritte
  Stelle bleibt getrennt — Offene Frage OQ-1).
- Kein Infra-/URL-/Repo-Rebrand (Track B).

---

## 4. Re-Verifikation der 15 Befunde (gegen aktuellen `master`)

Alle Anker existieren noch. Die adversarielle Verifikation hat jedoch **drei Befunde herabgestuft**
(der Vor-Audit hatte hier nichts refutiert — genau diese Luecke ist jetzt geschlossen):

| Befund | Anker (heute) | Ergebnis | Anmerkung |
|---|---|---|---|
| **S1-1** | `src/store/pg.js:504` (exakt) | **S1 bestaetigt** | `ensureTenant` ruft `hydrateTenantInto` OHNE `setTenant`; unter FORCE-RLS leerer Spiegel -> `save()` loescht reale nicht-aktive Call-Zeilen. Ungetestet. |
| **S1-2** | `src/worker/provisioning-orchestrator.js:39` | **S1 bestaetigt** | `queue.enqueue` VOR `withStoreLock`-Persistenz; Persist-Fehler -> verwaister Job wird vom naechsten Drain gekauft (echtes Geld), keine `provisioningJobs`-Spur, kein Reconciler. |
| **S1-3** | `src/config.js:29` (`numEnv`) | **S1 bestaetigt** | `parseInt("120abc")===120` rutscht durch `Number.isFinite`; vertippter Safety-Gate-Env kippt still auf Teilwert statt Boot zu verweigern. Betrifft `MAX_CALLS_PER_HOUR`, `PER_TARGET_CALL_CAP`, `MAX_BUDGET_EUR`, `MAX_CALL_DURATION_S`, `RATE_LIMIT_PER_MIN`. |
| **S2-maxdur** | `bridge.js:282` · `call-lifecycle.js:29-30` · `state-ops.js:373-374` | **S2 bestaetigt (3x)** | Formel `(maxDurationS \|\| maxCallDurationS)*1000` 3x unabhaengig; `bridge.js` mit rohem Magic-1000. **Verschaerfung:** `call-lifecycle.js` haelt selbst 2 parallele Implementierungen. |
| **S2-bridge-term** | `src/bridge.js:122` (`finalize`) | **S2 -> HERABGESTUFT** | Audit-Claim "Buchung faellt aus" ist **ueberzogen**: `finalize` ruft `onCallEnded?.()` = **dieselbe** `finishCall`-Billing-Thunk. Abrechnung laeuft heute korrekt. Reales Problem = **strukturelle Inkonsistenz** (optional-chained, keine Fail-Fast-Pflicht) + **fehlender Wiring-Test** + irrefuehrender Kommentar. Kein Geldverlust im Ist-Zustand. |
| **S2-webauth** | `web-auth.js:696` + `:718` | **S2 -> HERABGESTUFT (S3)** | `resolveWebSession`/`tenantContextOf` sind bereits extrahiert (Commit dd0ba2f). Rest = ~5 Zeilen Middleware-Skelett, das sich NUR im Status-Praedikat unterscheidet — genau die **gewollte** Divergenz. **Kein Auth-Sicherheitsrisiko**, nur kleines Stil-Cleanup. |
| **S2-trailingslash** | `src/config.js` 7 Stellen (156,198,308,403,646,661,762) | **S2 bestaetigt (7x)** | `.replace(/\/$/,"")` 7x. |
| **S2-setonce** | `state-ops.js:306/342/355` | **S2 bestaetigt (3x)** | `markAnswered`/`markSummarySmsSent`/`markBilled` strukturell identisch; nur Feldname unterschiedlich. |
| **S2-pgdelete** | `pg.js:1220/1257/1306` | **S2 bestaetigt (3x)** | Volles Idiom `own=filter + deleteMissing` exakt 3x; `:1290` (`flushTenantBudgets`) bewusst anders (kein `deleteMissing`). |
| **S2-logprefix** | `telnyx-call-control-ingest.js` 14 Stellen | **S2 bestaetigt (14x)** | Literal `"[voice/call-control]"` 14x, zwei Aufrufmuster. |
| **S2-smscap** | `src/sms-summary.js:42` | **S2 -> HERABGESTUFT (S3/S4)** | `dailySmsCap ?? 20` toter Fallback (config liefert nie `undefined`), harmlos (gleicher Wert). **ABER:** `test/f2-p8-cost-cap.test.js:116` baut bewusst ein config OHNE `dailySmsCap` — daher NICHT ersatzlos streichen, sondern durch **lauten Guard** ersetzen (fail-open -> fail-closed). |
| **S2-ui** | `ui/contract.js:20/44` · `ui/adapters/mcp-native.js:9` · `ui/adapters/chatgpt.js:8` | **S2 bestaetigt (2 Cluster)** | `capabilityDeclares*` (2x, nur MIME-Konstante variiert) + Renderer-Objekte (2x, identische Feldstruktur). DIP-Seam muss erhalten bleiben. |

**Konsequenz fuer den Plan:** Die drei Herabstufungen aendern die Framing:
`S2-bridge-term` wird zum **Wiring-Test + Kommentar** (kein Money-Fix), `S2-webauth` zur risikoarmen
**Higher-Order-Politur**, `S2-smscap` zum kleinen **fail-closed-Guard-Ticket**. Kein Befund wurde
komplett entkraeftet (0 stale).

---

## 5. `config.js`-Hub — Faktenlage fuer die inkrementelle Entschaerfung

- **99** flache Top-Level-Keys; **2** bereits verschachtelt (`telnyxElevenLabs`, `telnyxAssistant`);
  `elevenLabsPlayTts` ist ebenfalls nested (siehe OQ-6).
- **Fan-in:** 31 Dateien in `src/`, **72** repo-weit (inkl. 33 `test/*` + 8 `scripts/*.mjs`).
- **`guardedConfig`-Mechanik (Grundlage des Shim):** `rawConfig` (flach) wird beim Modul-Import eager
  gebaut — `numEnv`/`boolEnv` sind fail-closed und pushen bei GESETZT-aber-ungueltig synchron nach
  `fatalConfigErrors[]`. `guardedConfig(rawConfig)` ist ein rekursiver Proxy: unbekannter Key ->
  **TypeError sofort** (Ausnahme `then`/`toJSON` fuer Duck-Typing). Diese Eigenschaft macht jede
  Umgruppierung **laut** statt still — der Shim baut genau darauf auf.
- **Vorgeschlagene 13-Namespace-Karte** (Blaetter als **Getter auf denselben `rawConfig`-Speicherort**,
  keine Wert-Kopie): `safety`(10) · `billing`(15) · `provisioning`(11) · `auth`(15) · `llm`(11) ·
  `telnyx`(2) · `voice`(10) · `telephony`(8) · `tenancy`(5) · `server`(7) · `store`(3) · `metrics`(1) ·
  `privacy`(1). Grenzfaelle mit Doppelzugehoerigkeit -> OQ-3.
- **Migrations-Gefahren (in Teststrategien verankert):** (a) kein Compiler-Netz, Bruch erst zur
  Laufzeit; (b) `scripts/*.mjs` laufen NICHT unter `npm test` -> ausfuehrungs-verifizieren;
  (c) `test/helpers.js` `BASE_ENV` bei jeder Env-Var-Beruehrung nachziehen; (d) **Getter statt Kopie**
  (sonst umgeht `Object.assign`-Override im Test die Namespace-Kopie -> Gate-Test gruen ohne den Wert
  zu treffen); (e) `numEnv`/`boolEnv` weiter **eager** (kein Lazy-Getter, der einen Fatal-Push
  verschluckt); (f) `SAFE_DUCK_TYPING_PROPS` im Shim-Layer explizit nachbauen; (g) `subscribe.js:34`
  liest `config[key]` per **Bracket-Notation** — Literal-grep ist dafuer blind.

---

## 6. Pre-Mortem (ein Jahr voraus, Annahme: der Umbau hat Schaden angerichtet)

| # | Was ging schief | Ursache | Mitigation (im Plan verankert) |
|---|---|---|---|
| PM-1 | Config-Shim mit **Wert-Kopien** statt Gettern gebaut; Money-/Gate-Test ueberschreibt den Flach-Pfad per `Object.assign`, migrierter Code liest stale Namespace-Kopie -> Gate skaliert in Prod still falsch. | `guardedConfig` bewacht nur `get`, nicht `set`; Repo-Override nutzt `Object.assign`. | **Harte Design-Invariante (PA-12):** Blaetter sind Getter auf denselben Speicherort. Alias-Gleichheitstest **innerhalb** `withConfigOverrides()`. No-double-eval-Regression (`configFatalErrors().length` vor/nach identisch). |
| PM-2 | Max-Dauer-Helfer in `state-ops.js` hineinvereinheitlicht, schleppt `config.js`-Import in die Store-Schicht; Rundungs-/Clamp-Drift laesst einen Terminierungspfad ueberlaufen -> Kostenueberlauf. | `state-ops.js` `callLimitMs` ist bewusst config-frei, speist `server.js`+`reattach.js`. | **PA-1 fasst NUR** `bridge.js` + `call-lifecycle.js` an; `state-ops.js` bleibt config-frei. Vollvereinheitlichung ist Owner-Entscheidung (OQ-1), kein Nebeneffekt. |
| PM-3 | `bridge.js finalize` fuer Testbarkeit umgebaut, `closed`-Guard oder `onCallEnded`-Verdrahtung subtil veraendert -> Realtime-Call doppelt/gar nicht abgerechnet (Money-Defekt, der beim Engine-Flip aufwacht). | `bridge.js` HEIKLE STELLE; `onCallEnded` optional-chained ohne Fail-Fast. | **PA-1:** Diff strikt auf Timer-Zeile + Kommentar begrenzt (keine Signatur-/Struktur-Aenderung). Wiring-Test simuliert echten Doppel-Trigger und assertiert **genau EINEN** Aufruf; `setupCall()` nur additiv. |
| PM-4 | `numEnv`-Format-Check zu streng (kein Trim) -> eine seit Monaten laufende Render-Env mit Trailing-Newline wird als Fatal abgelehnt -> **Boot verweigert beim naechsten Deploy** -> Live-Outage. | `parseInt`/`parseFloat` trimmen heute automatisch; naiver Regex verliert das. | **PA-4:** `.trim()` VOR dem Format-Check (dokumentiert) + Positiv-Test (`' 6 '` bleibt gueltig). |
| PM-5 | Alias-Flip entfernt Aliase, aber der Vollstaendigkeits-grep uebersieht `config[key]`-Bracket-Zugriff -> `priceIdForPlan()` crasht bei jedem zahlenden Subscriber. | `subscribe.js:34` liest per Bracket-Notation. | **PA-20:** grep um Bracket (`config\[`) + Destrukturierung erweitert; `subscribe.js` gezielt verifiziert + Assert; TypeError-Regression fuer **echte** entfernte Keys; `/voice`-Runtime-Smoke. |
| PM-6 | `setOnceTimestamp`-Feldname verwechselt (`markBilled` faelschlich mit `summarySmsSentAt`), rutscht durch weil der Test nur `changed` prueft -> Doppel-Buchungs-Schutz gebrochen. | `billedAt`/`summarySmsSentAt` fast identische ISO-Felder; `changed=true` zufaellig gruen. | **PA-5:** Helfer-Test assertiert auf `call[fieldName]`, nicht nur `changed`; Review liest jede der 3 Zeilen mit Feldnamen gegen. |
| PM-7 | RLS-Regressionstest laeuft als pglite-**Superuser** (umgeht FORCE RLS) -> gruen mit UND ohne Fix -> S1-1 unbewiesen gemergt -> stiller Datenverlust bleibt. | pglite-Superuser umgehen RLS auch bei FORCE. | **PA-3:** Test unter `SET ROLE` auf eine **NOBYPASSRLS**-Rolle (Muster der Owner-Seed-Tests). Vor Merge: Fix-Zeile entfernen MUSS rot ergeben. |
| PM-8 | Provisioning-Order-Fix unvollstaendig, weil `api-onboard.js` unnoetig mit-editiert und eine zweite Luecke bleibt. | Beide Aufrufer rufen dieselbe `queueProvisioning`. | **PA-2:** Fix vollstaendig in `provisioning-orchestrator.js::queueProvisioning` lokalisiert; `api-onboard.js` aus der Dateiliste gestrichen (beide Aufrufer profitieren automatisch). |
| PM-9 | `dailySmsCap ?? 20` ersatzlos entfernt -> spaeterer Partial-Config-Aufrufer umgeht die Toll-Fraud-Kappe still (`count >= undefined` immer false) -> SMS-Kostenexplosion. | `planSummarySms` nimmt config generisch; Bestandstest baut config ohne Cap. | **PA-10:** kein straight-remove — `?? 20` durch **lauten Guard** ersetzen (throw). Regressionstest reproduziert die fail-open-Luecke und verifiziert den Guard. |
| PM-10 | Signatur-kritische Routen (`voice.js`/`stripe-webhook.js`) in einen Massen-Rename gezogen; Namespace-Tippfehler liefert `undefined` fuer das Signatur-Secret -> Signaturpruefung fail-open. | `src/routes/*`-Glob zieht Signatur-Dateien mit; PA-13-Alias verdeckt uebersehene Stellen. | **PA-15:** eigene, eng gereviewte Signatur-Phase mit HMAC/Ed25519/Stripe-Wiring-Tests + Zeile-fuer-Zeile-Review; diese Dateien aus allen mechanischen Routen-Phasen **explizit ausgeschlossen**; struktureller grep-Gate (0 Flach-Treffer) je Datei. |

---

## 7. Phasenliste (dependency-geordnet, je EIN `phase-impl-lean`-Lauf)

**Legende:** `Covers` = abgedeckte Befund-IDs · `Deps` = Vorbedingungs-Phasen · `S` = Sensibilitaet.
Die Reihenfolge legt sicherheitsrelevante S2 und die 3 S1 **frueh**, den config-Umbau als spaeten,
inkrementellen Block. Datei-Serialisierung ist so gelegt, dass **nie zwei Phasen dieselbe Datei
parallel** umschreiben.

### Block I — Sicherheitsrelevante S2 + die 3 S1 (frueh)

#### PA-1 · Geteilter Max-Dauer-Helfer (nur bridge.js + call-lifecycle.js) + bridge-finalize-Wiring-Test
- **Covers:** S2-maxdur (Teil), S2-bridge-term · **Deps:** — · **S: JA (hoch, bridge.js HEIKLE STELLE + Max-Dauer-Gate)**
- **Dateien:** `src/telephony/call-duration.js` (neu), `src/bridge.js`, `src/telephony/call-lifecycle.js`, `src/telephony/call-termination.js`, `test/call-duration.test.js` (neu), `test/bridge-openai-event.test.js`
- **Clean-Code:** G5 (2 echte Duplikate), Magic-1000 -> `MS_PER_SECOND`, C1/C2 (Kommentar praezisieren)
- **Invarianten:** Ablaufzeitpunkt an beiden Call-Sites unveraendert; **`state-ops.js` NICHT anfassen** (bleibt config-frei); `bridge.js`-Diff strikt auf Timer-Zeile + Kommentar; `onCallEnded`/`finishCall` genau EINMAL pro Call-Ende (Billing laeuft heute korrekt und bleibt so); Offenlegungssatz + Barge-in/Hangup-Choreografie unberuehrt.
- **Teststrategie:** Unit des Helfers; Konsistenz gegen die **armierte Deadline** (`now + Formel`), NICHT gegen `remainingMaxDurationMs`. Wiring-Test: `setupCall()` additiv (`onCallEnded` optional, Default `() => {}`), Spy statt No-Op; echten Doppel-Trigger simulieren (STOP-Media-Frame, DANACH `providerWs`-Close) -> Spy genau einmal mit frischem `store.getCall(call.id)`-Objekt; kein Zweitaufruf. `bridge-openai-event.test.js` unveraendert gruen.
- **Abnahme:** `call-duration.js` exportiert EINEN Helfer + `MS_PER_SECOND`; kein rohes `1000` mehr in den zwei Dateien; Wiring-Test faengt verlorenen Callback UND Doppelaufruf; Kommentar in `call-termination.js` praezisiert (5 Pfade + `bridge.js` separat); Voll-Suite gruen.

#### PA-2 · S1: Kein Provisioning-Enqueue vor persistierter Job-Spur
- **Covers:** S1-2 · **Deps:** — · **S: JA (Money-Path + Audit-/Reconcile-Spur)**
- **Dateien:** `src/worker/provisioning-orchestrator.js`, `test/provisioning-enqueue-order.test.js` (neu), `test/helpers.js`
- **Clean-Code:** G31 (temporale Kopplung), fail-closed
- **Invarianten:** Kein realer Kauf (Hold+Capture) ohne `s.provisioningJobs`-Eintrag; `reconcileOrphanedProvisioning` kann jeden Job klassifizieren; Budget-Gate unveraendert; INV-7 (eine Memory-Queue pro Prozess).
- **Teststrategie (rot-vor-Fix):** `makeProvisioningOrchestrator` direkt instanzieren; Fake-Store mit rejectable `withStoreLock`/`save` (Kontrakt im Prompt vorgeben). Schritt 1: `save()` rejected -> `{ok:false}`, keine Job-Spur, Job trotzdem QUEUED. Schritt 2: zweiter erfolgreicher Call (anderer Tenant) stoesst Drain an, der den Orphan mitkauft. **Ohne Fix:** `status===ACTIVE` UND `provisioningJobs`-Eintrag `undefined`. **Mit Fix:** Orphan bleibt `requested`, nie enqueued.
- **Abnahme:** Enqueue erst nach erfolgreicher Persistenz; `api-onboard.js` NICHT angefasst; Regressionstest ohne Fix rot, mit Fix gruen; Voll-Suite gruen.

#### PA-3 · S1: setTenant vor hydrateTenantInto im ensureTenant-Abwesend-Zweig
- **Covers:** S1-1 · **Deps:** — · **S: JA (RLS/Datenintegritaet, Multi-Tenant-Isolation)**
- **Dateien:** `src/store/pg.js`, `test/store-pg-rls.test.js`
- **Clean-Code:** G31 (temporale Kopplung `setTenant->hydrate`), G5 (Muster aus `hydrate()` wiederverwenden)
- **Invarianten:** FORCE RLS bleibt aktiv; `setTenant(client, tenantId)` MUSS vor jedem tenant-scoped SELECT/`deleteMissing` laufen (analog `hydrate()` Zeile 546-547); kein stiller Datenverlust nicht-aktiver Call-Zeilen.
- **Teststrategie (rot-vor-Fix):** echte pglite + FORCE RLS unter `SET ROLE` auf eine **NOBYPASSRLS**-Rolle (sonst umgeht der Superuser RLS und der Test ist mit/ohne Fix gruen). Tenant + nicht-aktive call-Zeile per direktem INSERT (ohne `setTenant`); `store.ensureTenant(tenantId)` -> `state.calls` enthaelt die Zeile; Flush -> direkter SELECT beweist Ueberleben. Vor Merge: Fix-Zeile entfernen MUSS rot ergeben.
- **Abnahme:** `ensureTenant` setzt `setTenant` vor `hydrateTenantInto`; Test unter NOBYPASSRLS, ohne Fix rot / mit Fix gruen, explizit verifiziert; Voll-Suite gruen.

#### PA-4 · S1: numEnv weist teil-numerische Env-Werte fail-closed ab (Int + Float, mit Whitespace-Erhalt)
- **Covers:** S1-3 · **Deps:** — · **S: JA (Parsing ALLER numerischen Safety-/Kosten-Gates)**
- **Dateien:** `src/config.js`, `test/config-failclosed.test.js`, `test/helpers.js`
- **Clean-Code:** fail-closed-Robustheit; kein still durchgereichter Teilwert; keine ungewollte Verschaerfung fuer Rand-Whitespace
- **Invarianten:** gesetzte-aber-ungueltige numerische Env kippt NICHT still auf Teilwert; fuehrendes/nachgestelltes Whitespace per `.trim()` VOR dem Format-Check erhalten (Bestandsverhalten von `parseInt`/`parseFloat`); Clamp `n>max` bleibt (kein Fatal), `n<min` bleibt Fatal; `boolEnv` unveraendert.
- **Teststrategie (rot-vor-Fix):** Integer-Zweig `numEnv('MAX_CALLS_PER_HOUR','120abc',...)` ohne Fix gruen (liefert 120), mit Fix Push nach `fatalConfigErrors`. Float-Zweig `numEnv('MAX_BUDGET_EUR','8.5abc',{integer:false})` ohne Fix still `8.5`, mit Fix Fatal. Positiv-Erhaltung: `'  6  '` bleibt gueltig, KEIN neuer Fatal. `BASE_ENV` geprueft (Fatal darf nicht durch geleakte `.env` verdeckt werden).
- **Abnahme:** Trailing-Muell (Int UND Float) -> `fatalConfigErrors` + Boot-Refusal; Whitespace-Rand bleibt gueltig; Int-/Float-/Whitespace-Fall separat getestet; Voll-Suite gruen.

### Block II — Risikoarme Dedup-/Politur-Buendelungen

#### PA-5 · setOnceTimestamp-Helfer fuer markAnswered/markSummarySmsSent/markBilled
- **Covers:** S2-setonce · **Deps:** — · **S: Nein (money-adjazent via markBilled)**
- **Dateien:** `src/store/state-ops.js`
- **Clean-Code:** G5 · **Invarianten:** Idempotenz je Feld (2. Aufruf No-op, Timestamp unveraendert); `changed`-Flag-Semantik unveraendert; `recordFailureReason`/`setCallEndedAt` bewusst NICHT einbeziehen (andere Semantik).
- **Teststrategie:** bestehende Idempotenz-Tests unveraendert gruen; neuer parametrisierter Helfer-Test assertiert auf `call[fieldName]` (nicht nur `changed`): call fehlt -> `changed=false`; Feld gesetzt -> No-op; Feld leer -> setzt einmal. Review liest jede der 3 Zeilen mit korrektem Feldnamen (`answeredAt`/`summarySmsSentAt`/`billedAt`) gegen.
- **Abnahme:** gemeinsamer `setOnceTimestamp(call, fieldName)`; 3 Aufrufer umgestellt; Helfer-Test prueft `call[fieldName]`; Bestandstests unangetastet gruen.

#### PA-6 · flushOwnScoped-Helfer fuer own-filter+deleteMissing-Idiom
- **Covers:** S2-pgdelete · **Deps:** PA-3 (Datei-Serialisierung `pg.js`) · **S: Nein direkt (usage_event speist Stripe-Metering + Plan-Gate)**
- **Dateien:** `src/store/pg.js`, `test/store-pg-multitenant.test.js`
- **Clean-Code:** G5; RLS-Doku-Absicht (own-Filter + GUC als Defense-in-Depth) erhalten
- **Invarianten:** own-Filter zusaetzlich zur RLS-GUC erhalten; `flushTenantBudgets` (`:1290`) bewusst NICHT einbeziehen (kein `deleteMissing`, PK=`tenant_id`); `deleteMissing` laeuft weiter VOR dem Insert-Loop.
- **Teststrategie:** Golden-Master je Tabelle mit **vollen Spalten-Assertions** (`usage_event`: `cost_cents`/`quantity`/`stripe_meter_sent`; `provisioning_job`: `status`/`attempts`/`last_error`/`created_at`; `number`: `provider_number_id`/`payment_intent_id`/`country`/`language`). Leere-keep-Liste-Sonderfall als eigener Fall. Downstream-Check: `planMinutesExceeded` + `billing/meter.js` gegen die roundgetrippten Zeilen. Cross-Tenant-Test auf `provisioning_job` UND `usage_event` ausweiten.
- **Abnahme:** `flushOwnScoped(...)` an genau 3 Stellen (`:1220/:1257/:1306`); `:1290` unveraendert; Spalten-scharfe Golden-Master + Sonderfall + Downstream gruen; Voll-Suite gruen.

#### PA-7 · Log-Praefix [voice/call-control] als Konstante
- **Covers:** S2-logprefix · **Deps:** — · **S: Nein (Logging-Kosmetik; Ed25519-Signatur unberuehrt)**
- **Dateien:** `src/telnyx-call-control-ingest.js`, `test/telnyx-call-control-ingest.test.js` (optional)
- **Clean-Code:** G5, Magic-String · **Invarianten:** identischer Log-Text an allen 14 Stellen; die zwei Aufrufmuster (12x Template-Literal, 2x `console.error/warn(prefix, err.message)`) bleiben korrekt getrennt.
- **Teststrategie:** kein Verhaltens-Regressionstest zwingend; Verhaltens-Erhalt via 1:1-Diff je Stelle + grep auf 0 verbliebene Rohliterale. (Korrektur: es gibt KEINE Voll-Text-Spy-Assertion.) Optional: Mini-Test, der je ein Muster den Output vergleicht.
- **Abnahme:** eine Konstante, 14 Stellen umgestellt, beide Muster erhalten, Log-Ausgabe unveraendert; grep 0 Rohliterale; Voll-Suite gruen.

#### PA-8 · UiRenderer/Detector-Factory hinter dem UiRenderer-Port
- **Covers:** S2-ui · **Deps:** — · **S: Nein (Rich-UI hinter mcpUiEnabled, kein Safety-Pfad)**
- **Dateien:** `src/ui/contract.js`, `src/ui/adapters/mcp-native.js`, `src/ui/adapters/chatgpt.js`
- **Clean-Code:** G5 (2 Cluster), DIP-Seam erhalten · **Invarianten:** UiRenderer-Port bleibt; Exportnamen unveraendert (registry importiert per Name); Widget-HTML byte-gleich; host-spezifische `toolMeta`/`registerResource`-Form pro Adapter (`_meta.ui.resourceUri` nested vs. `openai/outputTemplate` flach).
- **Teststrategie:** bindende Anker sind die **`_meta`-Shape-Tests** (T-P3-AC1/AC6, T-P1-UI-AC2/3, T-W3-AC2/3, T-Wb-*-AC2/3) — NICHT nur Byte-Gleichheit. Gesamte `test/mcp-ui.test.js` vor/nach mit identischer Anzahl/Namen. `makeCapabilityDetector(mimeConst)` + `makeUiRenderer({mimeType, metaKey, buildMeta})`.
- **Abnahme:** Factories ersetzen beide Cluster; Widget-HTML + host-spezifische Meta-Formen unveraendert; `_meta`-Shape-Tests gruen; Voll-Suite gruen.

#### PA-9 · Higher-Order Status-Gate fuer webAuth/webAuthAllowPending
- **Covers:** S2-webauth · **Deps:** — (muss VOR PA-17 laufen, Datei-Serialisierung `web-auth.js`) · **S: JA (Auth, aber strikt verhaltens-erhaltend)**
- **Dateien:** `src/web-auth.js`, `test/web-auth-middleware.test.js`
- **Clean-Code:** G5 (Middleware-Skelett), G26 · **Invarianten:** fail-closed 401/403 in beiden Pfaden strukturell gleich; gewollte Divergenz NUR im Status-Praedikat (`ACTIVE` vs. `PENDING_ALLOWED_STATUS`); `resolveWebSession`/`tenantContextOf` bleiben die EINE Aufloesungsquelle.
- **Teststrategie:** volle Matrix 4 Status x 2 Middlewares mit **allen vier Zeilen** inkl. des fehlenden Happy-Path `active` -> beide `next()`/200 MIT Assertion auf vollstaendigen `req.tenant`-Inhalt (nicht nur Statuscode). 8-Zellen-Snapshot (`{statusCode, req.tenant}`) vor/nach identisch.
- **Abnahme:** `webAuthWithStatusGate(predicate)`; beide Middlewares darauf; 8-Zellen-Snapshot mechanisch identisch; Voll-Suite gruen.

#### PA-10 · dailySmsCap: fail-open-Fallback durch lauten Guard ersetzen (kein straight-remove)
- **Covers:** S2-smscap · **Deps:** — (sms-summary.js wird in PA-13 migriert) · **S: JA (medium — Toll-Fraud-Kappe kippt fail-open -> fail-closed)**
- **Dateien:** `src/sms-summary.js`, `test/f2-p8-cost-cap.test.js`
- **Clean-Code:** kein still-fail-open; Invariante "config liefert immer `dailySmsCap`" erzwingen statt implizit
- **Invarianten:** SMS-Tageskappe (Toll-Fraud-Schutz) bleibt fail-closed; `count >= undefined` (immer false) darf nie auftreten; Wert 20 kommt weiter aus config-`numEnv`.
- **Teststrategie:** `?? 20` NICHT streichen, sondern durch laute Guard-Klausel ersetzen (`typeof config.dailySmsCap !== 'number' -> throw`). Bestandstest (Zeile 116-119) in echten Regressionstest umschreiben: (1) config ohne `dailySmsCap` scheitert laut statt fail-open; (2) `smsCount=25` + config ohne Cap reproduziert die alte Luecke und beweist den Guard.
- **Abnahme:** lauter Guard statt `?? 20`; Regressionstest beweist lautes Scheitern + geschlossene Luecke; Voll-Suite gruen.

#### PA-11 · stripTrailingSlash-Helfer in config.js
- **Covers:** S2-trailingslash · **Deps:** PA-4 (Datei-Serialisierung `config.js`) · **S: Nein direkt (OAUTH_ISSUER_URL Auth-adjazent)**
- **Dateien:** `src/config.js`, `test/config-gateway.test.js`, `test/config-shape.test.js`
- **Clean-Code:** G5 · **Invarianten:** identisches Strip-Verhalten (nur EIN trailing Slash); Reihenfolge bei `ELEVENLABS_API_BASE`: `.trim()` ZUERST, dann strip; alle 7 URL-Configs unveraendert.
- **Teststrategie:** Unit `stripTrailingSlash` (mit/ohne Slash, leer, mehrere); tabellarischer Regressionstest fuer JEDE der 7 Stellen (Env mit Trailing-Slash -> exakt gegen alten git-HEAD-Wert); `ELEVENLABS_API_BASE` zusaetzlich mit Trailing-Whitespace nach dem Slash; `isInsecureHttpIssuer()` fuer `OAUTH_ISSUER_URL` unveraendert (kein Auth-Footgun).
- **Abnahme:** ein Helfer, 7 Stellen umgestellt, `trim`-vor-`strip` erhalten, alle 7 getestet, `isInsecureHttpIssuer` unveraendert; Voll-Suite gruen.

### Block III — config.js-Hub: inkrementell, Shim zuerst (spaeter Block)

#### PA-12 · Config-Namespace-Shim: 13 Namespaces als Getter (dual-read, Flach-Alias erhalten)
- **Covers:** (Fundament) · **Deps:** PA-4, PA-11 · **S: JA (config-Hub + Boot-Gates)**
- **Dateien:** `src/config.js`, `test/config-shape.test.js`, `test/config-namespaces.test.js` (neu), `test/helpers.js`
- **Clean-Code:** Struktur/Namespacing via Getter-Delegation (eine Quelle der Wahrheit); keine Magic-Werte; keine abgeschaltete Sicherung
- **Invarianten (HART):** Namespace-Blaetter sind **Getter auf DENSELBEN `rawConfig`-Speicherort** — kein zweiter `numEnv`/`boolEnv`, keine Kopie; `numEnv`/`boolEnv` weiter **eager** (kein verschluckter Fatal-Push); `SAFE_DUCK_TYPING_PROPS` (`then`/`toJSON`) im Shim-Layer explizit nachgebaut; **kein Importeur wird in dieser Phase geaendert**; Boot-Gates + `isProduction`-Snapshot unveraendert.
- **Teststrategie:** Alias-Gleichheit fuer alle 99 Keys `config.<ns>.<key> === config.<flatKey>` im Default UND **innerhalb `withConfigOverrides()`** (Override auf Flach-Pfad -> Namespace zeigt denselben Wert — genau der Fall, den PA-13ff braucht). No-double-eval-Regression: fuer einen bewusst ungueltigen Env-Wert `configFatalErrors().length` vor/nach exakt gleich. `JSON.stringify(config)`/await-Duck-Typing funktionieren; alle 8 `config-*.test.js` gruen; Boot-Smoke `/healthz=200`.
- **Abnahme:** beide Oberflaechen (nested Getter + flach) auf identischen Speicherorten; Alias-Gleichheit im Default UND unter Override gruen; no-double-eval gruen; keine Importeur-Aenderung; `/healthz=200`; Voll-Suite gruen.

#### PA-13 · Migration Cluster A1: billing/* + worker/* + onboarding + sms-summary (Money-Importeure, ohne Routen)
- **Deps:** PA-12, PA-2, PA-10 · **S: JA (Money-Path)**
- **Dateien:** `src/billing/*`, `src/worker/*`, `src/onboarding.js`, `src/sms-summary.js`
- **Clean-Code:** G5/G31 (konsistenter Zugriffspfad) · **Invarianten:** Budget-Guard/Metering/Provisioning-Logik unveraendert; Flach-Alias bleibt fuer nicht-migrierte Importeure aktiv; `dailySmsCap`-Guard (PA-10) bleibt fail-closed.
- **Teststrategie:** Voll-Suite + `config-payment-guard`/`config-money-manifest`; **struktureller grep-Gate: 0 verbliebene `config.<flatKey>`** in genau diesen Dateien (Verhaltenstests allein fangen wegen aktivem Alias uebersehene Stellen NICHT); `BASE_ENV` geprueft; Boot-Smoke.
- **Abnahme:** alle Money-/Provisioning-Importeure lesen `config.<namespace>.<key>`; grep 0 Flach-Zugriff; Safety-/Money-Tests gruen; Voll-Suite gruen.

#### PA-14 · Migration Cluster A2: Boot-Gates (assertConfig/productionFootguns/isSelfServiceLive)
- **Deps:** PA-12 · **S: JA (Boot-Gates = letzte Verteidigungslinie)**
- **Dateien:** `src/config.js`
- **Clean-Code:** konsistenter Zugriffspfad, aber dokumentierte Roh-Env-Redundanz erhalten
- **Invarianten:** die bewusst UNABHAENGIGE Roh-Pruefung `process.env.DEV_LOGIN_ENABLED` in `productionFootguns` bleibt auf `process.env` (**KEINE** Umstellung auf `config.<namespace>` — dokumentiertes zweites Schloss); Boot verweigert identisch; `isProduction`-Snapshot unveraendert.
- **Teststrategie:** Voll-Suite + `config-prod-footguns`/`config-payment-guard`/`boot-failclosed`; Zusatz-Regression: die unabhaengige `DEV_LOGIN_ENABLED`-Roh-Pruefung feuert weiter unabhaengig vom config-Objekt (config-Wert abweichen lassen, Roh-Env setzen, Footgun muss greifen); grep-Gate 0 Flach-Zugriff ausser der rohen Stelle.
- **Abnahme:** Boot-Gates namespaced; `DEV_LOGIN_ENABLED`-Roh-Pruefung unveraendert + Regressionstest; Boot verweigert identisch; Voll-Suite gruen.

#### PA-15 · Migration Cluster B (Signatur/Gates): signatures + outbound-gates + voice.js + stripe-webhook — mit Signatur-Wiring-Tests
- **Deps:** PA-12, PA-14 · **S: JA (HOCH — beide Signaturpruefungen + Outbound-Gate + Stripe-Secret)**
- **Dateien:** `src/telephony/adapters/twilio/signature.js`, `src/telephony/adapters/telnyx/signature.js`, `src/telephony/outbound-gates.js`, `src/routes/voice.js`, `src/routes/stripe-webhook.js`
- **Clean-Code:** konsistenter Zugriffspfad, jede Gate-Stelle einzeln reviewed
- **Invarianten:** Twilio HMAC + Telnyx Ed25519 + Stripe HMAC fail-closed unveraendert; Land-Gate/Stundenlimit/Kill-Switch/per-Target-Cap unveraendert; `skipTwilioSignatureCheck`/`stripeWebhookSecret` liefern exakt denselben Wert (kein `undefined` durch falschen Blattpfad); diese Dateien AUSSCHLIESSLICH hier migriert.
- **Teststrategie:** **Zeile-fuer-Zeile-Diff-Review** je Datei (nur Zugriffspfad aendert sich); dedizierte Wiring-Tests (`outbound-gates.test.js`, `outbound-gates-order.test.js`, `telnyx-signature.test.js`, `voice-signature.test.js`) gruen + Test der migrierten Gate-Werte (`allowedCountryCodes`, `maxCallsPerHour`, `outboundFrozen`, `stripeWebhookSecret`); struktureller grep-Gate 0 Flach-Zugriff in diesen 5 Dateien.
- **Abnahme:** Signatur-/Gate-Dateien namespaced; alle Signatur-/Gate-Tests gruen; grep 0; Zeile-fuer-Zeile-Review dokumentiert; Voll-Suite gruen.

#### PA-16 · Migration Cluster C: telephony-Rest + store + bridge-Rest + claude.js
- **Deps:** PA-12, PA-6, PA-15, PA-1 · **S: JA (bridge.js HEIKLE STELLE)**
- **Dateien:** `src/telephony/*` (ohne signature.js/outbound-gates.js), `src/telephony/adapters/*` (ohne signature.js), `src/store/json.js`, `src/store/pg.js`, `src/bridge.js`, `src/claude.js`
- **Clean-Code:** G5 · **Invarianten:** Provider-Dispatch unveraendert; Offenlegungssatz unberuehrt; `bridge.js` HEIKLE-Bloecke (Barge-in ~330, Call-Ende ~79-160, Max-Dauer-Timer ~282): **nur Zugriffspfad, keine Logik**; Flach-Alias bleibt fuer Rest aktiv.
- **Teststrategie:** Voll-Suite; `bridge`-Wiring-Test aus PA-1 gruen; `max-duration-rearm`/`max-duration-pure`/`bridge-hardening` gruen; **expliziter Zeile-fuer-Zeile-Review der drei HEIKLE-Bloecke**; struktureller grep-Gate 0 Flach-Zugriff; Boot-Smoke.
- **Abnahme:** telephony-Rest/store/bridge-Rest/claude.js namespaced; bridge-Bloecke line-by-line gegengelesen; grep 0; Wiring-Test gruen; Voll-Suite gruen.

#### PA-17 · Migration Cluster D (Auth): auth.js + web-auth.js — mit Auth-Wiring-Test
- **Deps:** PA-12, PA-9 · **S: JA (Auth-fail-closed, zweite HEIKLE STELLE)**
- **Dateien:** `src/auth.js`, `src/web-auth.js`, `test/oauth.test.js`, `test/auth-mcp-bypass.test.js`
- **Clean-Code:** konsistenter Zugriffspfad; Auth-Verzweigungen einzeln verifiziert
- **Invarianten:** Auth fail-closed unveraendert — alle vier `mcpAuth`-Modi (oauth/off/token/legacy) + `legacyLocalBypassAllowed` liefern dasselbe Ergebnis wie vorher; `mcpAuthToken`-`safeEqual`-Vergleich unveraendert; `resolveWebSession`/`tenantContextOf` (PA-9) bleiben die eine Aufloesungsquelle.
- **Teststrategie:** expliziter Auth-Wiring-Test (analog PA-1s bridge-Pflicht): alle vier `mcpAuth`-Verzweigungen + `legacyLocalBypassAllowed` vor/nach vergleichen; `oauth.test.js`/`auth-mcp-bypass.test.js` gruen; struktureller grep-Gate 0 Flach-Zugriff.
- **Abnahme:** auth.js/web-auth.js namespaced; Auth-Wiring-Test deckt 4 Modi + Bypass vor/nach; grep 0; Voll-Suite gruen.

#### PA-18 · Migration Cluster E (Rest src, risikoarm): server/boot/metrics/mcp/geo/queue
- **Deps:** PA-13, PA-14, PA-15, PA-16, PA-17 · **S: Nein direkt (Boot-Banner sind Ausgabe)**
- **Dateien:** `src/server.js`, `src/boot.js`, `src/metrics.js`, `src/mcp-tools.js`, `src/mcp-server.js`, `src/mcp-server-info.js`, `src/geo/registry.js`, `src/queue/registry.js`, `src/routes/api-*` (unkritische Read/Write), `src/routes/mcp.js`, `src/routes/_tenant.js`, `src/routes/_validation.js`
- **Clean-Code:** G5 · **Invarianten:** kein Safety-/Signatur-/Auth-Pfad in diesen Dateien (die liegen in PA-14/15/17); Boot-Banner nur Ausgabe; `voice.js`/`stripe-webhook.js` hier NICHT enthalten; Flach-Alias bis PA-20 aktiv.
- **Teststrategie:** Voll-Suite (`boot-failclosed`, `l0-metrics`, `geo-registry`, `queue-registry`, `mcp-server-icon`); **struktureller grep-Gate: nach dieser Phase 0 verbliebene `config.<flatKey>` in `src/`** ausser `config.js` selbst + bewusst rohen `process.env`-Stellen; Boot-Smoke.
- **Abnahme:** alle restlichen src-Importeure namespaced (inkl. `api-onboard` `provisioningEnabled`/`maxNumbers`/`defaultTenantBudgetCents`); grep 0 Flach-Zugriff in `src/`; Voll-Suite gruen.

#### PA-19 · Migration Cluster F: scripts/*.mjs — mit node --check + Dry-Run-Import
- **Deps:** PA-12 · **S: JA (indirekt — echte Telnyx-/Stripe-APIs, laufen NICHT unter npm test)**
- **Dateien:** `scripts/*.mjs`
- **Clean-Code:** konsistenter Zugriffspfad auch in ungetestetem Ops-Code
- **Invarianten:** Migration **ausfuehrungs-verifiziert**, nicht nur grep; Namespace-Blattnamen korrekt (`config.telnyx.apiKey`, kein falscher Blattname).
- **Teststrategie:** pro Skript `node --check` PLUS Dry-Run-Import, der den ERSTEN neuen Namespace-Zugriff tatsaechlich ausloest (ohne echten Provider-Call), sodass ein falsches Blatt sofort auffliegt; struktureller grep 0 `config.<flatKey>` in `scripts/` (inkl. Bracket-/Destrukturierung).
- **Abnahme:** alle `scripts/*.mjs` namespaced; je Skript `node --check` + Dry-Run gruen; grep 0; Voll-Suite gruen.

#### PA-20 · Flip: Flach-Aliase entfernen (Namespace als einzige Oberflaeche) + Vollstaendigkeitsbeweis
- **Deps:** PA-13, PA-14, PA-15, PA-16, PA-17, PA-18, PA-19 · **S: JA (config-Hub/Boot-Gates)**
- **Dateien:** `src/config.js`, `src/billing/subscribe.js`, `test/config-shape.test.js`, `test/config-namespaces.test.js`, `test/helpers.js`
- **Clean-Code:** toter Code entfernt (Aliase), einzige Oberflaeche
- **Invarianten:** nach Entfernung wirft jeder verbliebene Flach-Zugriff **TypeError statt still-undefined** (fail-closed); `fatalConfigErrors` weiter eager; Boot verweigert identisch bei Muell; `config[key]`-Bracket-Zugriff in `subscribe.js:34` (`PLAN_PRICE_CONFIG_KEY` -> Stripe-Price) zeigt auf migrierten Blattpfad.
- **Teststrategie:** Vollstaendigkeits-Check VOR Entfernung, **erweitert um Bracket-Notation (`config\[`) und Destrukturierung (`}\s*=\s*config`)** in `src/` UND `scripts/` (reiner Literal-grep ist blind fuer `subscribe.js:34`); `subscribe.js` gezielt verifiziert + Assert fuer `priceIdForPlan()`; Regression `assert.throws(() => config.<removedKey>, TypeError)` fuer **echte** entfernte Keys; Boot-Smoke `/healthz=200` PLUS **curl-Runtime-Smoke gegen `/voice/*`** (`SKIP_TWILIO_SIGNATURE_CHECK=true`), der mindestens einen Budget-/Allowlist-Pfad post-Flip durchlaeuft (Gate-Werte werden erst waehrend eines Calls gelesen, nicht beim Boot).
- **Abnahme:** keine Flach-Aliase mehr; grep-Beweis 0 Flach-/Bracket-/Destrukturierungs-Zugriffe repo-weit; `subscribe.js:34` migriert + Assert; TypeError-Regression fuer echte Keys; `/voice`-Runtime-Smoke gruen; Boot verifiziert; Voll-Suite gruen.

### Abhaengigkeitsgraph (Kurzform)

```
Block I  (parallelisierbar, verschiedene Dateien): PA-1 · PA-2 · PA-3 · PA-4
Block II: PA-5 · PA-6(->PA-3) · PA-7 · PA-8 · PA-9 · PA-10 · PA-11(->PA-4)
Block III (config, streng seriell im Kern):
  PA-12(->PA-4,PA-11)
   -> PA-13(->PA-12,PA-2,PA-10) · PA-14(->PA-12) · PA-15(->PA-12,PA-14)
   -> PA-16(->PA-12,PA-6,PA-15,PA-1) · PA-17(->PA-12,PA-9) · PA-19(->PA-12)
   -> PA-18(->PA-13,PA-14,PA-15,PA-16,PA-17)
   -> PA-20(->PA-13..PA-19)   [Flip zuletzt]
```

---

## 8. Ausfuehrungs-Modell (bindend fuer die spaetere Session)

Dieser Plan wird **nicht** in der Planungs-Session umgesetzt. Ausfuehrung laeuft so:

1. **Frische, leane Session pro Kampagnen-Start.** Der **Lead** bleibt duenn (< ~100k Token) und
   **liest NIE Produktionscode** — nur einzelne Anker zur Stichprobe. Alle Code-Arbeit passiert in
   Subagenten/Worktrees.
2. **Pro Phase EIN `phase-impl-lean`-Lauf** (Skill `phase-impl-lean`): Plan -> Impl (isolierter
   Worktree) -> dualer Review (Safety/Verhalten + Clean-Code-Auditor) -> Self-Fix bis PASS ->
   kompakter Return + Report-Datei (`tasks/polish-a-p<N>-report.md`). **Clean-Code ist hartes Gate:
   S1/S2 = Blocker.** Verhaltens-erhaltend ist Pflicht; Safety-Gates/Offenlegungssatz/Auth NIE
   aufweichen.
3. **Phase im per-run-Skript HART pinnen** und den echten Git-Stand selbst pruefen
   (nicht auf `args` verlassen — `[[phase-impl-workflow-args]]`).
4. **Modell-Politik** (`[[workflow-model-policy]]`): Subagenten NIE Fable erben lassen. **Opus** fuer
   Plan + Safety-Review, **Sonnet** fuer Impl/Audit/Fix/Report. Pins explizit pro `agent()`.
5. **Merge im Lead** (nicht im Worktree-Subagenten): nach PASS `--no-ff` auf `master`, Worktrees/
   Branches aufraeumen. **Waehrend `isolation:worktree`-Workflows laufen: NIE `git stash`**
   (`refs/stash` ist worktree-geteilt — `[[stash-clobbered-by-worktrees]]`).
6. **NIE `git add -A`** (dieses Repo hat Stripe-/Kundendumps + 18 unversionierte Report-Dateien im
   Working-Tree — `[[git-add-all-hazard]]`); gezielt `git add <pfad>` je Phase. **Force-Push nur mit
   `--force-with-lease`** (parallele Sessions pushen auf denselben Remote).
7. **Verifikation je Phase (Feedback-Loop):** `npm test` Voll-Suite gruen (Baseline **2362**;
   Vorsicht Voll-Last-Flake `[[suite-flake-p5-gate-proof]]` — rot nur echt, wenn isoliert rot).
   Bei S1-Phasen (PA-2/3/4) zusaetzlich **rot-vor-Fix explizit verifizieren** (Fix-Zeile temporaer
   entfernen -> Test MUSS rot). Wo Tests nicht greifen (PA-20 `/voice`-Smoke): dokumentierter
   curl-Smoke gegen den lokal gestarteten Server.
8. **Neue config-Env-Vars** (falls beim Gruppieren) IMMER in `test/helpers.js` `BASE_ENV` nachziehen
   (`[[test-base-env-drift]]`). (In diesem Plan werden keine Env-Namen geaendert — nur der Zugriffspfad;
   das Risiko ist gering, die Regel bleibt.)
9. **Kein Deploy in dieser Kampagne.** Live geht separat ueber `upstream` (`[[deploy-repo-split]]`) —
   `git push origin` macht nichts live.
10. **Reihenfolge:** Block I -> Block II -> Block III (config, streng seriell im Kern). Innerhalb von
    Block I/II sind Phasen mit disjunkten Dateien parallelisierbar (je eigener Worktree), wenn die
    stash-Regel (5) beachtet wird; im Zweifel seriell. **PA-20 (Flip) immer zuletzt.**
11. **Offene Fragen zuerst klaeren** (Abschnitt 9) — die Defaults sind lauffaehig, aber OQ-1/OQ-2/OQ-3
    sind bindende Architektur-/API-Entscheidungen.

---

## 9. Offene Fragen (Owner-Entscheidung; Defaults sind lauffaehig)

- **OQ-1 · Dritte Max-Dauer-Stelle:** Soll die bewusst config-freie `state-ops.js callLimitMs` auch
  vereinheitlicht werden? Erfordert die Entscheidung, ob die Store-Schicht `config.js` importieren darf
  (+ beruehrt `reattach.js`/`server.js`). **Default: NEIN** (PA-1 nur bridge.js/call-lifecycle.js).
  — **BESTAETIGT 2026-07-17 (Owner): NEIN, state-ops bleibt config-frei.**
- **OQ-2 · bridge.js finalize:** Nur Wiring-Test + Kommentar (**Default**, verhaltens-erhaltend) ODER
  `finalize` aktiv auf `terminateAndBillCall` umstellen (strukturelle Fail-Fast-Pflicht)? Letzteres ist
  eine Struktur-Aenderung an der HEIKLE STELLE ueber den verhaltens-erhaltenden Scope hinaus — braucht
  bewusste Freigabe. — **BESTAETIGT 2026-07-17 (Owner): NUR Wiring-Test + Kommentar (Default).**
- **OQ-3 · Namespace-Schnitt:** Bestaetigung der 13-Namespace-Karte, v.a. Doppelzugehoerigkeiten:
  `maxBudgetCents` (billing vs. safety — aktuell billing), `twilioEdge` (telephony vs. voice),
  `ownerIdpSubject` (auth vs. provisioning). Bindende API-Entscheidung fuer alle 72 Importeure.
- **OQ-4 · Shim-Form:** Ein einziger Getter-Shim (alle 13 Namespaces auf einmal — **Default**) ODER
  cluster-geslicet (PA-12a/b/c) fuer kleinere Diffs je Sub-Phase? Praeferenz Diff-Groesse vs.
  Phasen-Anzahl. — **BESTAETIGT 2026-07-17 (Owner): EIN Getter-Shim, alle 13 Namespaces (Default).**
- **OQ-5 · PA-10-Umfang:** Ist der laute Guard (throw bei fehlendem/nicht-numerischem `dailySmsCap`)
  als Verhaltens-Aenderung akzeptiert (statt stillem Fallback 20)? Falls zu invasiv fuer "Politur":
  als eigenstaendiges kleines S1-Ticket ausserhalb des Batches fuehren.
- **OQ-6 · elevenLabsPlayTts:** Die bereits nested 7-Key-Gruppe in die `voice`-Namespace uebernehmen
  oder als eigenstaendiges nested Objekt (wie `telnyxElevenLabs`/`telnyxAssistant`) belassen?
  Beeinflusst den Zugriffspfad in PA-16.

---

## 10. Abnahmekriterium (Kampagne gesamt)

Note A erreicht, wenn: alle 3 S1 mit rot-vor-Fix-Regressionstest geschlossen; alle bestaetigten S2
(inkl. der 3 herabgestuften als Politur/Guard) gebuendelt; `config.js` auf die Namespace-Oberflaeche
geflippt (Flach-Aliase entfernt, grep-Beweis 0 repo-weit inkl. Bracket/Destrukturierung); Voll-Suite
durchgehend gruen; keine Absolute Regel aufgeweicht; kein Deploy. Ein anschliessendes
Clean-Code-Bestaetigungs-Audit sollte 0 S1 / 0 S2 im Scope finden.

---

## 11. Kickoff-Prompt fuer die Ausfuehrungs-Session (kopierbar)

> Kopiere den folgenden Block in eine **frische, leane** Session (nicht diese hier).

```
Aufgabe: Umsetzung von PLAN-POLISH-A.md (finale Qualitaets-Runde, Note B -> Note A) im Hermes-Repo.
Reine verhaltens-erhaltende Code-Arbeit, KEIN Deploy, KEIN Push nach upstream.

Pflichtlektuere ZUERST (neu lesen, nicht auf Zusammenfassungen verlassen):
CLAUDE.md, .claude/refs/workflow.md, .claude/refs/clean-code.md, PLAN-POLISH-A.md.
Memory-Anker: [[lean-phase-orchestration]], [[workflow-model-policy]], [[phase-impl-workflow-args]],
[[stash-clobbered-by-worktrees]], [[git-add-all-hazard]], [[test-base-env-drift]],
[[suite-flake-p5-gate-proof]], [[deploy-repo-split]].

Vor Beginn: beantworte mir die 6 Offenen Fragen (OQ-1..OQ-6, Abschnitt 9). Die Defaults sind
lauffaehig; ich bestaetige oder korrigiere. Erst dann starten.

Ausfuehrungs-Modell (bindend, Abschnitt 8 des Plans):
- Lead bleibt duenn (< ~100k Token) und liest NIE Produktionscode ausser einzelnen Anker-Stichproben.
- Pro Phase EIN phase-impl-lean-Lauf (Skill phase-impl-lean): Plan -> Impl (Worktree) -> dualer Review
  (Safety/Verhalten + Clean-Code) -> Self-Fix bis PASS -> Report tasks/polish-a-p<N>-report.md.
  Clean-Code ist HARTES Gate (S1/S2 = Blocker). Verhaltens-erhaltend Pflicht; Safety-Gates/
  Offenlegungssatz/Auth NIE aufweichen.
- Phase im per-run-Skript HART pinnen, echten Git-Stand selbst pruefen (nicht auf args verlassen).
- Modell-Pins explizit pro agent(): Opus=Plan+Safety-Review, Sonnet=Impl/Audit/Fix/Report,
  NIE Fable erben lassen.
- Merge im Lead (--no-ff auf master), Worktrees/Branches aufraeumen. Waehrend isolation:worktree-
  Workflows laufen: NIE git stash. NIE git add -A (gezielt git add <pfad>). Force-Push nur
  --force-with-lease.
- Verifikation je Phase: npm test Voll-Suite gruen (Baseline 2362; Voll-Last-Flake -> rot nur echt
  wenn isoliert rot). S1-Phasen (PA-2/3/4): rot-vor-Fix explizit verifizieren. PA-20: zusaetzlich
  curl-/voice-Runtime-Smoke.
- Neue config-Env-Vars (falls) IMMER in test/helpers.js BASE_ENV nachziehen.

Reihenfolge (Abhaengigkeitsgraph in Abschnitt 7): Block I (PA-1..PA-4) -> Block II (PA-5..PA-11)
-> Block III config (PA-12 Shim -> PA-13..PA-19 Importeur-Cluster nach Risiko -> PA-20 Flip zuletzt).
Start mit PA-1. Nach jeder Phase: Report schreiben, tasks/todo.md-Item abhaken, kurzer Status an mich.

Bei Unklarheit fragen, nichts annehmen. Erst OQ-1..OQ-6 klaeren, dann PA-1 beginnen.
```
