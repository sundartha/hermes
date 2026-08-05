# Phase GQ-P3 — Inbound auf den Assistant-Pfad

**Gate: PASS**
**finalBranch:** `phase/gq-p3-inbound-handoff`
**headCommit:** `268c62fb263e8d8b7a8afa500cae72dfad61b9ca`

---

## Plan (gekuerzt)

Befund B-9: das Boot-Banner meldete "Assistant-Pfad: AKTIV", waehrend jeder Inbound-Anruf
ueber die Budget-Engine lief. Ursache: `INBOUND_CALL_CONTROL_ID_FIELD` in
`src/telnyx-inbound.js` stand auf dem geratenen Feldnamen `CallControlId`. Live gemessen
(Sonde B, Anruf `call_mseqcvoh8bcx`): Telnyx liefert `CallSid` — derselbe Wert, der bereits
`call.twilioSid` fuellt und den Max-Dauer-Timer armiert. Gegenprobe per
`GET /v2/calls/<CallSid>` bestaetigt: Format identisch zu einer Outbound-`call_control_id`.

Plan-Kernstuecke:

1. **Feldname-Fix** in `telnyx-inbound.js`: `CallControlId` -> `CallSid`, Kommentar mit
   Messbeleg statt Vermutung.
2. **Benannte Pfadentscheidung** `inboundHandoffDecision` (reine Funktion, DI statt
   config-Import) ersetzt die stille Inline-Bedingung in `inboundAssistantHandoffXml`
   (`src/routes/voice.js`). Vier Budget-Gruende als Enum
   (`assistant_disabled`, `handoff_disabled`, `provider_unsupported`,
   `no_call_control_id`), Pruefreihenfolge bewusst: Capability-Gate VOR Body-Lesen, damit
   ein Twilio-`CallSid` (`AC…`) nie als `call_control_id` fehlinterpretiert wird.
3. **Turn-Sonde** `logInboundPathDecision`: eine Logzeile je Inbound-Leg, unkonditional
   (nicht nur im Fehlerfall) — sonst ist eine Sonde im Log nicht von "kein Deploy"
   unterscheidbar (Lehre aus B-9 selbst).
4. **Rueckweg-Schalter** `TELNYX_INBOUND_HANDOFF_ENABLED` (Default `true`) in
   `config.telnyx.telnyxAssistant.inboundHandoffEnabled` — Owner kann Inbound ohne Deploy
   auf die Budget-Engine zurueckstellen (Render-Dashboard). Kein `assertConfig`-Eintrag,
   da kein Sicherheits-Gate betroffen.
5. **Boot-Sonde** `inboundHandoffProbeLine` unter der bisherigen `Assistant-Pfad:`-Zeile,
   getrennt vom Master-Schalter — genau die Luecke, die B-9 verdeckt hat.
6. **`.env.example`/`render.yaml`**: neuer Flag dokumentiert inkl. Kostenfolge.
7. **`test/helpers.js#postTelnyxIncoming`**: Parameter `callControlId` -> `callSid`
   (Feldname war tot).
8. Neue Testdatei `test/gq-p3-inbound-handoff.test.js` (Ebene A: reine
   Entscheidungslogik/Log/Boot-Sonde offline; Ebene B: zwei Spawn-Tests am echten Server,
   Schalter an/aus).
9. Bestandstests (`telnyx-p8-inbound`, `telnyx-p9-flag-matrix`,
   `gq-s1-inbound-field-probe`) auf den neuen Feldnamen umgestellt — sie pinnten bislang
   den falschen Namen.
10. `tasks/gq-chain-state.md` fortgeschrieben: Kostenverdreifachung, Uebergabepunkt fuer
    KV-M1-Neumessung, Rueckweg.

Ausdruecklich ausgeschlossen: kein Eingriff an `disclosureSentence`, Signaturpruefung,
Kostendecke, `OUTBOUND_FROZEN`, Denylist, Land-Gate, Stundenlimit, Max-Dauer, `bridge.js`,
Twilio-Pfad.

Pre-Mortem-Zusatzrisiko (im Plan selbst benannt): sobald `callControlId` gesetzt ist,
verzweigt `hangUpAction` beim Inbound-Cap kuenftig ueber `endCallViaCallControl` statt
`endCall` — richtige Richtung, aber Verhaltensaenderung an einem Safety-Gate-Pfad, per
Test (T-P3-7 / GQ-P3-Suite) gepinnt statt entdeckt.

---

## Impl-Zusammenfassung

Vollstaendig gemaess Plan umgesetzt:

- `src/telnyx-inbound.js`: Feldname-Fix `CallSid`; neue Enums `INBOUND_PATH` /
  `INBOUND_BUDGET_REASON`; reine Funktionen `inboundHandoffDecision` (Guard-Kette Tiefe 1,
  1 Objekt-Argument) und `logInboundPathDecision` (unkonditionale Turn-Sonde, feuert bei
  `no_call_control_id` zusaetzlich den bestehenden `logInboundHandoffFallback`).
- `src/config.js`: neuer Key `inboundHandoffEnabled` (Default `true`) via
  `TELNYX_INBOUND_HANDOFF_ENABLED`, mit Kostenfolge-Kommentar (~5 ct/min vs. 1,87 ct/min).
- `src/routes/voice.js`: `inboundAssistantHandoffXml` verdrahtet nur noch die
  Entscheidung, keine Inline-Bedingung mehr; Import-Block und Kopfkommentar nachgezogen.
- `src/boot.js`: `inboundHandoffProbeLine` direkt unter der `Assistant-Pfad:`-Zeile,
  wiederverwendet `probeLine`/`envFlagState` (kein neues Zeilenformat).
- `.env.example`, `render.yaml`: Flag dokumentiert inkl. Kostenwarnung und Rueckweg.
- `test/helpers.js`: `BASE_ENV` traegt den Prod-Default explizit (Lehre
  `test-base-env-drift`); `postTelnyxIncoming` auf `callSid`-Parameter umgestellt.
- Bestandstests (`telnyx-p8-inbound`, `telnyx-p9-flag-matrix`,
  `gq-s1-inbound-field-probe`) auf neuen Feldnamen migriert.
- Neue Datei `test/gq-p3-inbound-handoff.test.js`: 9 Tests (GQ-P3-1..9), Ebene A
  (Entscheidungslogik, Reihenfolge-Gate, Grenzfaelle, Logging, Boot-Sonde) + Ebene B (zwei
  Spawns: Schalter an -> Assistant-Pfad, Schalter aus -> Gather).
- `tasks/gq-chain-state.md` fortgeschrieben.

**Ergebnis:** headCommit `268c62f`, `node --check` gruen auf allen vier Kerndateien,
`npm test` 3925/3925 gruen (danach i18n-Wrapper-Korrektur 3905/3905), committed auf
`phase/gq-p3-inbound-handoff`.

### Deviations vom Plan

1. **`test/config-shape.test.js` zusaetzlich angepasst** (im Plan nicht erwaehnt): pinnt
   die `telnyxAssistant`-Config-Form per strict `deepEqual` und fiel durch den neuen Key
   `inboundHandoffEnabled` rot. Fix rein additiv, keine Verhaltensaenderung am Test.
2. **Abnahme-Check `grep -c CallControlId src/ -r -> 0` liefert real 5 Treffer**,
   Widerspruch im Plan selbst: Edit A/B verlangten ausdruecklich, dass
   `inboundCallControlId`/`inboundHandoffFallbackFinding`/`CALL_CONTROL_ID_SHAPE`
   (Funktionsnamen, Kommentare) unveraendert bleiben — deren Namen enthalten die
   Teilzeichenkette `CallControlId`. Der fehlerhafte Feldname im TeXML-Konsum ist weg
   (`INBOUND_CALL_CONTROL_ID_FIELD = "CallSid"`, testgepinnt); nur der Grep-Check selbst
   kann bei planwortgetreuer Umsetzung nicht 0 liefern.
3. **Smoke-Test per Hand-curl konnte den Assistant-Pfad nicht bis zum Ende durchspielen**:
   ohne generierten Telnyx-Ed25519-Schluessel laesst sich eine gueltige Signatur lokal
   nicht faelschen, der Request faellt auf den Twilio-Provider zurueck
   (`provider_unsupported`, korrektes Verhalten). Boot-Banner-Zeile und die
   Budget-Pfad-Sondenzeile wurden am echten Server verifiziert; der Assistant-Erfolgspfad
   selbst ist durch die Spawn-Tests GQ-P3-8/9 (echte HTTP-Requests mit korrekt signierten
   Telnyx-Headern) abgedeckt.

---

## Safety-Urteil

**approved: true** — alle absoluten Regeln eingehalten, Gate-Reihenfolge in
`/voice/incoming` unveraendert (Ed25519-Signatur fail-closed -> `numberRecordByE164` ->
`store.budgetExceeded` (pro-Tenant-Decke, beide Richtungen) -> `createCall` ->
`armMaxDurationTimer` -> erst dann `inboundAssistantHandoffXml`). Kein Gate entfernt,
aufgeweicht oder umgangen. Provider-Capability wird vor dem Body-Lesen geprueft (Test
GQ-P3-3) — Anti-Spoof intakt. Offenlegungssatz erreicht den Anrufer deterministisch auch
auf dem Assistant-Pfad (`withInboundNotice` -> `vc.speak` vor `ai_assistant_start`). Keine
neuen Endpunkte, keine neue Dependency, keine Secrets im Diff.

independentTestSummary: eigener Lauf im frischen Worktree, `npm test` 3925 Tests, 3924
pass, 1 fail (KV-P7-15, `fetch failed`, bekannte Spawn-Race unter Volllast, isoliert 13/13
gruen, ohne Bezug zum Diff). Isolierter Nachlauf aller vom Diff betroffenen Dateien: 44/44
gruen.

### Concerns (kein Blocker, dokumentiert)

1. **Handoff-Fehlerpfad toetet den Anruf statt zurueckzufallen**: wirft `vc.speak()` oder
   `vc.startAssistant()` (Telnyx-API-Fehler, 422, Netz) eine Exception, propagiert sie aus
   `inboundAssistantHandoffXml` in den try/catch von `/voice/incoming` ->
   `turnErrorSpeech` + Hangup statt Rueckfall auf die Budget-Engine. Bestand aus P8, aber
   durch GQ-P3 erstmals produktiv erreichbar (vorher feuerte der Handoff nie wegen des
   falschen Feldnamens).
2. **`logInboundPathDecision` loggt jetzt unkonditional je Inbound-Leg**, auch bei
   Twilio-Provider und ausgeschaltetem Schalter. TeXML bleibt byte-identisch, das Log
   nicht mehr — bewusst so gebaut, trotzdem eine Verhaltensaenderung im Aus-Zustand.
3. **Rueckfall-Waechter `handoff_fallback` im echten Telnyx-Verkehr faktisch
   unerreichbar** geworden (jeder TeXML-Body traegt `CallSid`); bleibt korrekt fuer den
   Fall, dass Telnyx das Feld kuenftig aendert, aber der Testfall "Feld absent" ist
   kuenstlich erzeugt.
4. **`store.addTranscript(call.id, 'agent', greeting)` laeuft nur im Budget-Zweig** —
   Offenlegungssatz erreicht den Anrufer, fehlt aber im Transkript des Inbound-Legs auf
   dem Assistant-Pfad. Bestandsluecke aus P8, wird durch diese Phase live.
5. Suite-Flake KV-P7-15 unter Volllast, ohne Bezug zum Diff.
6. **Kostenverdreifachung von Inbound** (~5 ct/min statt 1,87 ct/min) vom Owner
   freigegeben, gedeckelt ausschliesslich durch die pro-Tenant-Kostendecke; verifiziert,
   dass `budgetExceeded` weiterhin VOR dem Handoff laeuft. Folge: Inbound-Gespraeche
   koennen jetzt frueher an der Decke abbrechen — erwartetes Verhalten, kein neuer Defekt.

---

## Clean-Code-Audit

**blocker: false** — kein S1/S2. Reihenfolge/Fail-Safe/Kosten-Doku gewissenhaft belegt,
Sicherheitsgates laufen unveraendert vor dieser Entscheidung.

**S1:** keine
**S2:** keine

**S3 (2 Fundstellen, kleine Kommentar-Ungenauigkeiten):**

1. `src/telnyx-inbound.js:190-208` (Kommentar ueber `INBOUND_CALL_CONTROL_ID_FIELD`) —
   der Kommentar nennt zwar die Doppelnutzung des Werts (`call.twilioSid` +
   Max-Dauer-Timer), verschweigt aber an dieser Stelle die im Chain-State dokumentierte
   Nebenwirkung, dass `hangUpAction` beim Inbound-Cap dadurch ueber
   `endCallViaCallControl` statt `endCall` laeuft. Empfehlung: Ein-Satz-Verweis im
   Code-Kommentar ergaenzen.
2. `src/routes/voice.js:145f.` (`inboundAssistantHandoffXml`) — Kommentar spricht von
   "beiden aktiven Schaltern", nennt aber nur Master-Flag + GQ-P3-Schalter, nicht die
   dritte, gleichrangige Bedingung `providerCapable`. Empfehlung: auf "drei Bedingungen"
   praezisieren oder auf `telnyx-inbound.js` verweisen.

**S4:** keine

**passNotes:** Reihenfolge-Sicherheit per Test belegt (GQ-P3-3). Turn-Sonde loggt
unkonditional (vermeidet die B-9-Falle erneut). Vier Budget-Gruende als sauberer Enum
statt Bool-Flut (F3/G15 PASS). Feldname-Aenderung mit Live-Messung + Gegenprobe belegt,
nicht geraten (G21 PASS). Tests decken reine Logik UND Draht am echten Server (P1/P11
PASS). Keine Duplizierung mit GQ-S1-Test (G5 PASS). Kostenfolge konsistent in
`.env.example`, `render.yaml`, `config.js`, Chain-State dokumentiert, Rueckweg ohne
Deploy vorhanden.

**topTodos:**
1. Nebenbefund (`callControlId` setzt `hangUpAction`-Pfad auf `endCallViaCallControl` um)
   auch als kurzer Hinweis im Code-Kommentar von `telnyx-inbound.js` verankern.
2. Kommentar in `routes/voice.js:145f.` auf die tatsaechlich drei Vorbedingungen
   praezisieren.

---

## Fix-Runden

Keine — Gate lief bei der ersten Review-Runde direkt auf PASS (Safety: approved,
Clean-Code: blocker=false, nur S3-Hinweise ohne Fix-Pflicht).
