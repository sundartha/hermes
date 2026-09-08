# Phase SEC-P1 — Webhook-Idempotenz

- **Gate:** PASS
- **finalBranch:** `sec/p1-fix1`
- **headCommit:** `0a978ed783b54fd526e9126ee814ac20c4b1375a`
- **Basis:** `master` @ `99d8270`
- **Datum:** 2026-09-08

## Ergebnis in einem Satz

Vor `/voice/incoming` und `/voice/turn` haengt jetzt ein Wiederholungs-Riegel (Express-Middleware, registriert PRO ROUTE, damit strukturell HINTER der Ed25519-Signaturpruefung): er leitet aus dem Anbieter-Ereignis einen Anker ab, beansprucht ihn synchron (atomar im Event-Loop), liefert bei einer Wiederholung dieselbe Antwort aus dem Prozess-Cache bzw. — nach Neustart — eine mikrofon-offene Antwort aus dem persistierten Anker, und laesst den Handler bei jedem echten Ereignis unveraendert laufen. Kein bestehendes Safety-Gate wird angefasst.

## Plan (gekuerzt)

**Anker-Design:**
- `/voice/incoming`: Anker IST der Anruf-Datensatz — `in:<CallSid>` (Telnyx `CallSid` aus dem TeXML-Body, bereits als `twilioSid` gespeichert). Persistenz-Praedikat: `store.getCall(CallSid)` liefert einen Datensatz. Kein neues Feld noetig.
- `/voice/turn`: kein anbieterseitiges Ereignis-Merkmal vorhanden (`parseSpeechResult` liest nur `Transcript`/`SpeechResult`). Deshalb zwei Anker, weil einer allein je eine Haelfte verfehlt:
  - **A — Turn-Marke** `t:<turnToken>`: eigene, in die Gather-Action-URL gerenderte Zufallsmarke (64 Bit, `node:crypto`), faengt Anbieter-Retries mit gleicher URL, verfehlt einen Angreifer, der die (nicht signierte) Query streicht.
  - **B — Umschlag-Fingerabdruck** `e:sha256(telnyx-timestamp|rawBody)`: faengt jede byte-identische Wiederholung inkl. manipulierter Query, verfehlt einen Anbieter-Retry mit neuem Zeitstempel.
  - Duplikat = einer der beiden Anker bereits beansprucht. Vollstaendigkeitstabelle im Plan zeigt: eine echte zweite Runde (neue Marke, neue Sekunde) wird immer normal verarbeitet — kein Livelock, weil die Marke beim Eintreffen beansprucht wird, nicht beim Rendern.
  - Redirect-Fallback traegt dieselbe Marke wie die Gather-Action (nur eines von beiden feuert bei TeXML).

**Vorhaltezeit:** Prozess-Cache (`Map`, LRU-Deckel `ANSWER_CACHE_MAX=200`) haelt Antwort-Wortlaut (PII) — verlaesst den Prozess nie. Persistiert wird ausschliesslich der PII-freie Anker-Ringpuffer `call.webhookAnchors` (Deckel `WEBHOOK_ANCHOR_HISTORY=6`), stirbt mit dem Call-Datensatz ueber die bestehende `RETENTION_DAYS`-Loeschung. Kein neuer Aufraeum-Job, kein neuer Env-Knopf.

**Atomaritaet:** Beanspruchungspfad enthaelt kein `await` zwischen Pruefung und `Map.set` — in Node unteilbar. Prozessuebergreifende Beanspruchung bleibt bewusst offen (= GATE-04, `PLAN-SEC-FIX.md` § 4, solange `numInstances=1`).

**Neue Datei:** `src/telephony/webhook-idempotenz.js` — `makeWebhookIdempotenz({ store, keepAliveXml })`, liefert `forIncoming`/`forTurn`-Middlewares ueber eine gemeinsame `makeGuard`-Fabrik. `res.send` wird abgefangen (Muster `captureRawBody` in `app.js`), fail-soft in `try/catch`, `res.on("close")` loest bei Absturz mit `null`, Timer `unref()`'d.

**Edits:** `voice-render.js` (Turn-Marke in Action-URL), `routes/voice.js` (Riegel PRO ROUTE eingehaengt, `/voice/status`/`/voice/outbound`/`/voice/call-control` unangetastet), `state-ops.js`/`json.js`/`pg.js`/`schema.sql`/`store.js`/`views.js` (neues Feld `webhookAnchors`, additiv nullable, view-gestrippt), `eslint-legacy-exceptions.json` + `check-staged-suppressions.test.js` (Pin-Anhebung, begruendet).

**Restrisiken (R1-R6, im Plan benannt, alle bewusst getragen):** Cross-Tenant-`callId`-Umbiegung mit gestohlener Signatur (R1); Wortlaut nach Neustart weg, nur offenes Mikrofon (R2); Requests ganz ohne Anker laufen fail-open wie im Bestand (R3); pg-Async-Flush kann Anker bei Absturz verlieren, geerbt von `billedAt` (R4); `/voice/outbound` bleibt ungeschuetzt (R5); Multi-Instanz-Fall = GATE-04 (R6).

## Impl-Zusammenfassung

- **Tests:** 390 Faelle in 51 betroffenen Testdateien gruen, `testFailCount: 0`, `nodeCheckPass: true`.
- Neue Dateien: `src/telephony/webhook-idempotenz.js`, `test/sec-p1-webhook-idempotenz.test.js` (9 Faelle inkl. Positiv-Kontrolle, drei echte Runden, gestrichene Marke, Neustart-Fall), `test/sec-p1-webhook-anker-persistenz.test.js` (4 Faelle: pg/json-Round-Trip, Ringpuffer-Deckel, publicCall-Strip).
- Geaenderte Dateien: `src/routes/voice.js`, `src/telephony/voice-render.js`, `src/telephony/adapters/telnyx/signature.js` (Export `TS_HEADER`), `src/store/{state-ops,json,pg,views,defaults}.js`, `src/store.js`, `src/db/schema.sql`, `test/voice-render-action-url.test.js`, `test/check-staged-suppressions.test.js`, `eslint-legacy-exceptions.json`, `PLAN-SECURITY.md`.
- Smoke-Test bestanden: echter Server-Kindprozess, `/voice/incoming` zweimal mit gleicher CallSid -> 1 Datensatz, identische Bodies; `/voice/turn` zweimal mit gleicher Marke -> identische Antwort.

### Deviations vom Plan

1. `WEBHOOK_ANCHOR_HISTORY` liegt in `src/store/defaults.js` statt in `webhook-idempotenz.js` — vermeidet Kopplung von `state-ops.js` an `config.js` ueber `signature.js`. Verhalten unveraendert.
2. `TS_HEADER` wird aus `signature.js` importiert statt zweimal geschrieben (G5-Begruendung).
3. `state-ops.recordWebhookAnchors` nennt seinen Parameter `state` statt `s` — Bestandspraxis (wie `trueUpAnsweredAt`), id-length-Pin bewegt sich dadurch nicht (251 bleibt 251).
4. `migrateCallFields` kopiert Listen-Defaults (`[...fallback]`) statt eines geteilten Array-Literals in `CALL_FIELD_DEFAULTS` — vermeidet stillen Array-Alias in migrierten Bestands-Calls.
5. eslint-Pins gemessen statt geraten: nur `pg.js` (`rowToCall` 37->38, `callRowValues` 37->39, `makePgStore` 591->596) und `routes/voice.js` (`makeVoiceRoutes` 269->273) bewegten sich; `state-ops.js`-Pin blieb unveraendert (s. Punkt 3). Beide begruendet angehoben, `LEGACY_FINGERPRINT` nachgezogen.
6. `PLAN-SECURITY.md` traegt zusaetzliches Restrisiko R7 (nicht im Plan genannt): zwei gleichzeitige Anrufe mit byte-identischem Turn-Body+Zeitstempel teilten sich Anker B — in Produktion unerreichbar (CallSid ist je Leg eindeutig), Ausgang ohnehin harmlos.
7. Testzuschnitt leicht abweichend: SEC-P1-2/3/4/5 teilen sich einen Spawn-Server (Subtests) statt vier separate; Persistenz-Datei hat 4 statt 3 Faelle.
8. Ein vorbestehender roter Test (`test/language-switch-midcall.test.js`, E2E-03, Stimmen-Erwartung Polly vs. Azure) wurde durch Gegenprobe auf `master` als NICHT durch SEC-P1 verursacht bestaetigt und faellt in die Gates-Bank (von `npm test` ausgeschlossen).
9. Lokaler Setup-Workaround (Symlink `node_modules`) im Worktree, nicht committet.
10. `npm test` (Vollauf) wurde vorgabegemaess vom Lead nicht gefahren, nur die betroffenen Dateien.

## Safety-Urteil

**Verdict:** FREIGABE (approved), fuenf nicht-blockierende Concerns, kein Blocker hat gehalten.

- `safetyGatesIntact: true`, `disclosureIntact: true`, `authFailClosedIntact: true`, `scopeRespected: true`, `noSecretsLeaked: true`, `behaviorAsIntended: true`, `testsPassIndependently: true`.
- Unabhaengig gefahren: 393 Tests / 392 pass / 1 fail (der vorbestehende E2E-03-Fall, per Gegenprobe auf `master` identisch reproduziert — nicht durch diese Phase verursacht).
- Reihenfolge geprueft: Ed25519-Signatur-MW (`routes/voice.js:241`) steht strukturell VOR den beiden bewachten Routen (`:275`, `:394`) — der Riegel greift PRO ROUTE dahinter, ein unsignierter Request kann keinen Anker beanspruchen.
- Keine neue Env-Variable, keine neue npm-Abhaengigkeit, kein Safety-Gate im Diff beruehrt (kein Treffer in `outbound-gates.js`, `activation.js`, `call-finish.js`, `config.js`).

**Concerns (nicht blockierend):**
1. Vorbestands-Rot in `language-switch-midcall.test.js` (E2E-03) — getrennt zu triagieren, nicht dieser Phase anzulasten.
2. `rememberAnswerOnSend` cacht/persistiert auch Nicht-2xx-Antworten — ein In-Process-Retry nach 500 bekaeme den gecachten 500 statt eines frischen Versuchs. Geringe Schwere; Haertungsvorschlag: nur 2xx cachen.
3. Der keepAlive-Zweig (persistierter Anker getroffen, Neustart-Fall) ueberspringt fuer genau diesen einen Request `capFarewellOutcome` (Max-Dauer) und `budgetHangupOutcome` (Kostendecke) — keine Gate-Aufweichung (kostet 0 Token/Synthese, naechster echter Turn faehrt beide Gates), aber die einzige Stelle, an der der Riegel geldrelevante Logik kurzschliesst. Empfehlung: als achte Zeile in PLAN-SECURITY.md-Restrisikotabelle nachtragen.
4. Retentions-Asymmetrie: der Umschlag-Anker (Hash ueber Body inkl. SpeechResult) ueberlebt die kuerzere `DIAGNOSTIC_RETENTION_DAYS`-Transkript-Loeschung bis `RETENTION_DAYS`. Praktisch nicht umkehrbar, aber Planformulierung etwas staerker als der Mechanismus hergibt.
5. Fail-open-Rand (R3) bleibt bestehen und ist dokumentiert: ohne CallSid/Marke/signierten Umschlag laeuft der Request wie im Bestand; in Produktion liegt der Umschlag-Anker immer vor.

## Clean-Code-Audit

- **s1 (Blocker):** keine
- **s2 (Blocker):** keine
- **s3 (Findings):**
  - G13 (Bestand, kein Blocker): `TS_HEADER`-Export aus `signature.js` — bewusst dokumentierte EINE Quelle statt Doppelschreibung, sauber begruendet.
  - G16/G25 (sauber): `TURN_TOKEN_BYTES`, `ANSWER_CACHE_MAX`, `WEBHOOK_ANCHOR_HISTORY` sind benannte Konstanten mit Begruendung — keine Magic Numbers gefunden.
- **s4 (Findings):**
  - G30 (dokumentiert, kein neuer Verstoss): `makeVoiceRoutes` 269->273, `makePgStore` 591->596 Zeilen — beide bereits gepinnte Altlast-Riesenfunktionen, Anhebung im Pin-Text einzeln begruendet, Suppressions-Tests gruen.
- **blocker:** false
- **Verdict:** PASS. Kein Race Condition (synchroner Claim, P16 eingehalten), keine Magic Numbers, keine toten Branches, PII-frei persistiert, view-gestrippt (per Test belegt), Store-Backends mit Round-Trip-Test abgesichert (Lehre i8 korrekt angewandt), Ringpuffer-Deckel korrekt kopiert statt geteilter Array-Alias. Bestehende Tests korrekt angepasst statt geschwaecht. Alle 59 gezielt gefahrenen Tests gruen.
- **topTodos:** R5 (`/voice/outbound`-Riegel) als offener Folge-Scope; R1 (Cross-Tenant-`callId`) im Auge behalten fuer SEC-P2; Multi-Instanz-Fall (R6) vor Skalierung loesen.

## Fix-Runden

**r1:** SEC-P1-COV-Blocker behoben — fehlender Regressionstest fuer den persistierten `/voice/incoming`-Restart-Pfad ergaenzt. Neuer Test `SEC-P1-9` in `test/sec-p1-webhook-idempotenz.test.js`: seedet einen Server mit bereits existierendem Call-Datensatz (`twilioSid = CallSid`, leerer Prozess-Cache) und beweist den Neustart-Pfad fuer die Incoming-Route.

Nach diesem Fix: Gate PASS, Branch `sec/p1-fix1`.
