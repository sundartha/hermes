# Phase IEL-B8: Rückfall-Routen und Inbound-Weiche

**Gate:** PASS
**finalBranch:** `phase/iel-b8-weiche` (Basis: `phase/iel-b7a-stimme` @ 64ee3db)
**headCommit (Impl):** `31dde6d8a02f46b592a3e0549c14fd419ac02f9e`
**Merge-Commit:** `137b4b5` (merge(iel-b6-b7): Init-Webhook-Route mit Brueckenfristen und Dial/Sip-Direktive mit Umleitungs-Port — Anmerkung: laut `git log` gemergter Merge-Commit für die B6/B7-Kette; B8 selbst liegt auf dem Branch `phase/iel-b8-weiche` mit Head `31dde6d`)

---

## 1. Plan (gekürzt)

**Ziel:** `/voice/incoming` bekommt eine Weiche zwischen Budget-Pfad (Default, unverändert) und ElevenLabs-Übergabepfad (Schalter + Tenant-Allowlist). Auf dem EL-Pfad: unser Pflichtsatz zuerst (Agentenstimme), dann `<Dial><Sip>` zum ElevenLabs-Endpunkt, dann `<Redirect>` mit `quelle=dial_ende`. Zwei neue Routen `/voice/el-rueckfall` (Entscheidungstabelle: Auflegen / Folge-Gather / Rückfall-Start) und `/voice/el-bein` (armiert die innere Bindungsfrist bei `answered`/`in-progress`).

**Bindende Vorab-Befunde:**
- Bestehende Fristkonstanten (`EL_BRIDGE_START_DEADLINE_MS`, `EL_BINDING_AFTER_ANSWER_MS`) wiederverwenden, nur zwei neue: `EL_DIAL_RING_TIMEOUT_S=10`, `EL_MIN_CONVERSATION_MS=5000` (unbelegte Startwerte, Nachzug nach Messung vorgesehen).
- `src/routes/voice.js` hat einen Lint-Pin (Altlast); neue Logik muss auf Modul-Ebene oder in ein eigenes reines Modul, darf keine neuen Lint-Befunde erzeugen.
- `INBOUND_PATH`-Enum wird um `ELEVENLABS` erweitert (macht `ie6-s1-assistant-entfernt.test.js` bewusst rot → anpassen).
- Probe-Tabelle (`scripts/probe-auth.sh`) und Routen-Fingerprint (`route-auth-inventory.test.js`) müssen um die zwei neuen Routen ergänzt werden.
- Neue Routen registrieren **vor** `/voice/status` (Quelltext-Tests schneiden ab dort).

**Abweichungen von der Spec-Dateiliste (geplant, Lead-Entscheidungen):**
- D1: neue reine Datei `src/elevenlabs/inbound-rueckfall.js` statt Logik in `inbound-bridges.js`/`voice.js`.
- D2–D9: Idempotenz-Anker in `webhook-idempotenz.js`, Verdrahtung in `app.js`, Probe-Tabelle + Fingerprint + Enum-Test + Lint-Pin-Dateien, Kommentar-Update in `inbound-path-decision.js`, Verschiebung der EL-Test-Attrappe in einen gemeinsamen Harness.

**Neue Dateien:** `src/elevenlabs/inbound-rueckfall.js` (rein: `rueckfallEntscheidungFuer`, `rueckfallQuelleFuerLog`, `elUebergabeDirektiven`, Konstanten), `test/iel-b8-weiche.test.js`.

**Geänderte Dateien:** `src/telephony/inbound-path.js` (Enum), `src/i18n/inbound-notice.js` (`rueckfallBegruessung`), `src/telephony/webhook-idempotenz.js` (Anker ohne Neustart-Schicht), `src/routes/voice.js` (Weiche, neue Handler auf Modul-Ebene, neue Routen), `src/app.js` (Verdrahtung `inboundBridges`), `src/route-policy.js` (2 Einträge), `scripts/probe-auth.sh` (2 Zeilen), `test/route-auth-inventory.test.js`, `test/ie6-s1-assistant-entfernt.test.js`, `src/elevenlabs/inbound-path-decision.js` (Kommentar), `PLAN-SECURITY.md` (neuer Abschnitt), Lint-Pin-Dateien.

**Pre-Mortem (Kernrisiken, adressiert):** Schalter-aus-Regression (Golden-Tests), Rückfall ohne Pflichtsatz (Default = Offenlegung, nur `dial_ende` spart), Stille (jeder Pfad endet in TeXML-Antwort, Fristen vor dem Senden armiert), Passwort im Log (Grep-Test: genau eine Lesestelle), Kosten zu niedrig gebucht (Profil vor Notbremse gesetzt), doppeltes Gespräch nach Neustart (Entscheidung nur aus Persistenz), Hook blockiert Commit (Lint-Pin vorab nachziehen).

**Deterministische Prüfungen:** `node --check` auf alle geänderten Module, gezielte Testläufe (B8-Suite, Golden, IE4, Route-Inventar), Grep auf `IEL-B8` in `PLAN-SECURITY.md`, Grep auf `sipPassword` (genau 1 Treffer außerhalb der erlaubten Dateien), `npm run lint`, Suppressions-Check, volle `npm test`.

---

## 2. Implementierungs-Zusammenfassung

Branch `phase/iel-b8-weiche` auf `phase/iel-b7a-stimme`, Commit `31dde6d`.

`/voice/incoming` wählt jetzt einmal pro Anruf einen Pfad (`inboundPfadFuer` → `inboundElPathFor`), **nach** allen bestehenden Gates (Signatur-MW, `forIncoming`, `numberRecordByE164`, `budgetExceeded`). Bei Schalter aus / Tenant nicht gepinnt: Budget-Pfad, TeXML byte-identisch (Golden-Tests grün). Auf dem EL-Pfad steht das Kostenprofil im Leg **vor** der Notbremsen-Berechnung und `createCall`. Antwort: unser Offenlegungssatz (Agentenstimme via `inboundElLocaleOf`) → `<Dial><Sip>` → `<Redirect quelle=dial_ende>`. Äußere Fristen werden vor dem Senden armiert.

Zwei neue Routen, beide hinter der Ed25519-Signaturprüfung, mit Idempotenz-Ankern (ohne Neustart-Schicht — Entscheidung liest ausschließlich Persistenz):
- `/voice/el-rueckfall`: Entscheidung rein aus Aktiv-Status + Bridge-Zustand + `elBoundAt` → Auflegen / Folge-Gather / Rückfall (setzt Marker, löscht Fristen, schreibt Transkript). Begrüßung enthält den Pflichtsatz immer, außer `quelle` ist exakt `dial_ende`.
- `/voice/el-bein`: armiert die innere Frist bei `answered`/`in-progress`, nur für aktive `WARTET`-Calls.

**Code-Lage:** reine Logik + neue Konstanten in `src/elevenlabs/inbound-rueckfall.js`; Handler auf Modul-Ebene in `src/routes/voice.js` (nicht in `makeVoiceRoutes`, wegen Lint-Pin); `rueckfallBegruessung` in `src/i18n/inbound-notice.js`; Anker in `src/telephony/webhook-idempotenz.js`. Zusätzlich aktualisiert: `route-policy.js`, `probe-auth.sh`, Routen-Fingerprint, IE6-S1-Enum-Test, `app.js`-Verdrahtung, neuer PLAN-SECURITY-Abschnitt.

**Lint-Pin gesunken** (nicht gestiegen, trotz neuer Funktionalität): `makeVoiceRoutes` 229→228 Zeilen, `/voice/status`-Komplexität 13→12, magische Zahl 200 entfällt. `eslint-legacy-exceptions.json`, `check-staged-suppressions`-Fingerprint und `eslint-suppressions.json` (pruned) nachgezogen.

**Tests:** neue Datei `test/iel-b8-weiche.test.js`, 22 Tests (34 inkl. Subtests), alle grün — reine Unit-Tests, In-Process-Test für `/voice/el-bein`, Spawn-Tests (Erstantwort, Notbremse mit EL-Satz, Sicherungen vor der Weiche, Signaturprüfung, Rückfall-Matrix, IE4-Wiederholung nach Neustart, Stimmen-Gleichheit E19, Ende-zu-Ende mit Summary, drei Neustart-Szenarien WARTET/GEBUNDEN/RUECKFALL, Frist-Umleitung scheitert). EL-Test-Attrappe aus B5-Test in `test/_iel-inbound-harness.js` verschoben, um TTS-Stream-Antworten erweitert.

**Checks:** `node --check` auf alle 9 geänderten `src`-Dateien grün. `npm test -- --test-concurrency=4`: 5767 Tests, 0 Fehler. `npm run lint`: 0 Fehler. `check-staged-suppressions.js`: Exit 0. `sipPassword`-Grep: genau 1 Treffer in `voice.js`. `route-policy.js`: 2 Treffer für die neuen Routen.

**Smoke-Test:** echter Server mit `SKIP_TWILIO_SIGNATURE_CHECK=true`, EL-Schalter an, Owner-Tenant gepinnt: `/healthz` 200; `/voice/incoming` → 200 mit Say(Offenlegung) + Dial/Sip + Redirect(dial_ende); `/voice/el-bein` → 200 OK; `/voice/el-rueckfall` mit `dial_ende` → 200 mit Gather ohne Offenlegungssatz.

### Deviations (Impl)

1. `test/helpers/inbound-router-harness.js` (nicht in Plan-Dateiliste): Config bekommt `voice: { elevenLabsInbound: { enabled: false } }`, da `/voice/incoming` jetzt `inboundElPathFor` aufruft, das dieses Feld liest; ohne es würden bestehende Tests (`kv2-2-kostenprofil-weichen`, `ie6-s1-katalog-umzug`) rot. Produktionscode behandelt ein fehlendes Namespace nicht defensiv.
2. `src/config.js` (nicht in Plan-Dateiliste): reiner Kommentar-Fix (veraltete Stand-Notiz zur Weiche aktualisiert).
3. `test/iel-b5-status-ende.test.js`: neben dem Import-Wechsel wurden ungenutzte Imports `http`/`HTTP_OK` entfernt (Lint-Warnungen).
4. `src/telephony/webhook-idempotenz.js`: zwei zusätzliche Kommentar-Korrekturen (EL-Routen nutzen nur Schicht 1; "aller Routen" statt "beider Routen").
5. `PLAN-SECURITY.md`: ein zusätzliches Restrisiko dokumentiert — `[el-rueckfall]`-Log-Zeile für nicht mehr aktiven Call trägt `callId: null`, da nur aktive Calls re-attached werden (Test 16j pinnt das).
6. Test 14b nutzt eigene CallSid (sonst würde der Retry-Guard die Antwort aus 14a replayen).
7. Test 19 wartet auf `billedAt`, `summary` und `inboxEntryAt` zusammen, da die Zusammenfassung nach der Abrechnung fertig werden kann.
8. Die als "unverändert" gelisteten GOLDEN/IE4/B5/B6/B7a-Tests wurden nicht editiert, außer dem B5-Import-Wechsel (D9).

---

## 3. Safety-Urteil (final)

**Verdict: PASS.** `approved: true`, alle Kernflags (`testsPassIndependently`, `safetyGatesIntact`, `disclosureIntact`, `authFailClosedIntact`, `noSecretsLeaked`, `scopeRespected`, `behaviorAsIntended`) `true`, keine Blocker.

**Unabhängige Prüfung:** Worktree `review-iel-b8` (= `phase/iel-b8-weiche`, `31dde6d`). `node --check` auf allen 9 geänderten Dateien grün. Gezielter Testlauf (diff-betroffene + Konsumenten-Tests): 191 Tests, 191 grün, 0 rot. Beide Golden-Tests grün, Fixture nicht im Diff. `probe-auth-table.test.js` und `security.test.js`: 29/0. `IEL-B8`-Grep in `PLAN-SECURITY.md` trifft.

**Kernaussagen:**
- Gates: Weiche greift erst nach Signatur-MW, `forIncoming`, `numberRecordByE164`, `budgetExceeded`; wirkt erst nach `createCall` mit EL-Satz in der Notbremse, `armMaxDurationTimer`, `recordCostProfile`.
- Offenlegung: erstes gesprochenes Verb auf dem EL-Pfad ist `locale.inboundNotice`, von uns gesprochen, vor `<Dial><Sip>`, in der Stimme aus `tts.voice_id` (E19). Rückfall lässt den Satz nur bei exakt `quelle === "dial_ende"` weg.
- Schalter aus / nicht gepinnt: Budget-Pfad byte-identisch (Golden-Tests).
- Auth: beide neue Routen hinter Ed25519-MW, `route-policy.js`-Einträge mit `VOICE_SIGNATURE_REASON`, Inventar/Probe-Tabelle nachgezogen.
- Secrets: `sipPassword` genau eine Lesestelle, keine Logging von Direktiven/TeXML, Spawn-Test bestätigt kein Passwort im stdout.

**Concerns (nicht blockierend):**
- `PLAN-SECURITY.md` §2 überstattet die Signaturabdeckung: Telnyx Ed25519 signiert nur `${ts}|${rawBody}`, nicht die Query-String — `callId`/`quelle` sind also nicht signiert. Ein mitgeschnittener Umschlag könnte innerhalb des Replay-Fensters (300s) mit geänderter Query wiederverwendet werden; der Prozess-Umschlag-Anker blockiert das bis Neustart/Eviction. Bestehende Risikoklasse (auch bei `/voice/turn`), durch B8 auf zwei weitere Routen ausgeweitet. Wortlaut-Korrektur empfohlen.
- `starteRueckfall` ignoriert das `changed`-Ergebnis von `markInboundElFallback` (potenzielle doppelte Begrüßung bei fast gleichzeitigen `frist`/`dial_ende`-Events, Effekt nur "mehr Offenlegung").
- `sendElUebergabe` armiert die äußere Frist vor dem Bau der Übergabe-Direktiven — bei Exception harmlos (Timer wirkt nicht mehr auf inaktiven Call).
- `/voice/el-bein` ist synchron ohne try/catch, sendet 200 vor `parseLifecycleEvent` — harmlos.
- `scripts/probe-auth.sh` wurde trotz Scope-Ausschluss "keine Skripte" geändert — notwendig, da Test `probe-auth-table.test.js` es gegen `route-policy.js` abgleicht; keine neue Werkzeug-Einführung, kein Scope-Verstoß.

---

## 4. Security-Urteil (final)

**Verdict: PASS (Security).** `approved: true`, keine Blocker.

Beide neuen Routen liegen unter `router.use("/voice")` mit fail-closed Ed25519-Prüfung, keine Auth-Ausnahme, je ein `route-policy.js`-Eintrag mit `VOICE_SIGNATURE_REASON`; Inventar-Fingerprint und Probe-Tabelle nachgezogen. Test IEL-B8-15: unsigniert → 403, signiert → 200 für beide Routen.

Weiche greift nur bei Schalter + Tenant-Allowlist + vollständigem Zugang, und erst nach Signatur-MW, `forIncoming`, `numberRecordByE164`, `budgetExceeded`. Leg-Kostensatz gilt vor der Notbremse, danach `armMaxDurationTimer` und Set-once-Profil (belegt IEL-B8-13/14). Golden-Tests unverändert grün → Inbound-TeXML byte-identisch bei Schalter aus.

Offenlegung: Server spricht `locale.inboundNotice` als erstes Verb vor `<Dial><Sip>`. Rückfall-Standard ist volle Begrüßung; nur exakt `quelle === "dial_ende"` lässt den Satz weg (fehlend/bogus/frist → volle Begrüßung, IEL-B8-2/3/16c). Nie Stille: jeder Fehlerpfad endet über `sendTechnischesEnde` in `turnErrorSpeech` + Hangup, unbekannter/beendeter Call in Hangup.

Secrets: `sipPassword` genau eine Lesestelle (Grep-Test 9), keine Logging von Direktiven/TeXML, Spawn-Test bestätigt kein Passwort im stdout. Keine PII in Log-Zeilen (nur `callId`, Enum-`quelle`, Status als JSON). Kein neues Env, keine neue Dependency.

**Concerns (nicht blockierend, dieselbe Klasse wie bei Safety plus):**
- Ed25519 signiert nicht die URL → `callId`/`quelle` theoretisch replaybar innerhalb 300s-Fenster bei TLS-Mitschnitt; gleiche bestehende Klasse wie `/voice/turn`, jetzt auf 2 weitere Routen ausgeweitet. Umschlag-Anker fängt nur Wiederholung innerhalb derselben Prozess-LRU (200 Einträge).
- `elUebergabeDirektiven` erzeugt ein Telnyx-Kindbein zu `sip.rtc.elevenlabs.io`, das `OUTBOUND_FROZEN` nicht erfasst — bewusst so (Ziel ist fest, Gates laufen vorher), sollte aber im Runbook/PLAN-SECURITY explizit stehen; der eigentliche Notaus für EL-Inbound-Minuten ist `ELEVENLABS_INBOUND_ENABLED`, nicht der Kill-Switch.
- `clampDialSeconds` klemmt `timeLimit` auf mindestens 60s; liegt die Notbremse (`maxDurationS`) darunter, ist das Dial-Limit größer als die Notbremse — harte Grenze bleibt aber `lifecycle.armMaxDurationTimer` am Elternbein.
- `starteRueckfall` prüft `budgetExceeded` nicht erneut vor Start des Budget-Turn-Loops — laut Spec (E11) bewusst so (Decke Sekunden vorher geprüft, Geld-Wache greift danach).
- Fehlerpfad-Randfall: scheitert das Ausliefern des Pflichtsatzes als `<Play>` (404), überspringt Telnyx das Verb — dieselbe bestehende Klasse wie beim Budget-Gather-Prompt, nicht neu; TTS-Fallback auf Azure-`<Say>` funktioniert korrekt.
- `vermerkeElBein` synchron ohne try/catch, sendet 200 vor Parsing — keine Sicherheitswirkung, nur unsaubere Log-Zeile im Fehlerfall.

---

## 5. Clean-Code-Audit (final)

**s1 (Blocker):** keine
**s2 (schwerwiegend, nicht blockierend):** keine

**s3 (stilistisch, kein Fix nötig):**
- `src/routes/voice.js`: `sendBudgetBegruessung` und `starteRueckfall` teilen die Zeilenfolge `addTranscript` → `sendVoiceXml(turnDirectives(...))` fast wortgleich; keine echte G5-Duplizierung (Marker/Fristen/Quelle differieren).
- `src/telephony/webhook-idempotenz.js`: `elRueckfallAnchors`/`elBeinAnchors` benannt nach Route, `queryEreignisAnker` nach Mechanismus — Namenskonvention passt, kein echter Verstoß.

**s4 (positiv):**
- `ANGENOMMEN_STATUS.includes(...)` dedupliziert bisher zweimal ausgeschriebenen Status-Vergleich (`vermerkeElBein` + `/voice/status`).
- Lint-Pin für `voice.js` sinkt (229→228 Zeilen, Komplexität 13→12, ein `no-magic-numbers`-Befund weniger) trotz neuer Funktionalität — Logik korrekt auf Modul-Ebene / in `inbound-rueckfall.js` ausgelagert.

**Verdict: PASS.** Keine S1/S2-Befunde. Neue Logik (Rückfall-Entscheidung, EL-Übergabe-Direktiven, zwei neue Routen) ist rein, klar benannt, über Dispatch-Objekte (G23) statt `switch` verzweigt, hinter der Ed25519-Signatur-MW ohne Auth-Ausnahme; `route-policy.js` + `probe-auth.sh` + Routen-Fingerprint aktualisiert. SIP-Zugang hat Grep-erzwungenen Single-Read-Punkt (Test 9), Passwort nachweislich nie geloggt (Test 12). 34 neue Tests (rein bis Kindprozess-E2E) plus angepasste Bestandstests grün; volle Suite grün.

**passNotes:** saubere Trennung reiner Entscheidungsfunktionen ohne IO, benannte Nebeneffekte (N7-Kommentare), gemeinsame Anker-Funktion statt Copy-Paste, Fehlerpfad mit `/voice/incoming` geteilt statt dupliziert, `beinAngenommen` kapselt die Bedingung (G28), eine Quelle für `EL_BEIN_PFAD` (Schreiber/Leser). Tests decken Grenzfälle ab (unlesbares `elBoundAt`, Neustart in allen drei Brückenzuständen, doppelte Wiederholung, unbekannte/bogus `quelle`).

**topTodos:** keine blockierenden Punkte. Bei Gelegenheit: dokumentierte Restrisiken in `PLAN-SECURITY.md` (Stille bei Prozess-Neustart, unbelegte Konstanten `EL_DIAL_RING_TIMEOUT_S`/`EL_MIN_CONVERSATION_MS`) im Blick behalten, bis Spec-Punkt 8 sie misst.

---

## 6. Fix-Runden

Keine Fix-Runden nötig — alle drei Prüfinstanzen (Safety, Security, Clean-Code) urteilten beim ersten Durchlauf PASS ohne Blocker.
