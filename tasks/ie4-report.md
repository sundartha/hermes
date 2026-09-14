# Phase IE4 — Der Wiederholungs-Riegel bekommt eine pfadgerechte Antwort

**Gate: PASS**
**finalBranch:** `phase/ie4-idempotenz-pfadgerecht`

## Ziel

Der Wiederholungs-Riegel (`webhook-idempotenz.js`) antwortete auf eine erneute Anbieter-Zustellung bislang immer mit dem Budget-Engine-Folge-Gather (`followupTurnDirectives`), egal welches System das jeweilige Anruf-Bein tatsaechlich fuehrt. Trifft eine Wiederholung nach einem Prozess-Neustart ein bereits an ein anderes System (z.B. Realtime-Stream) uebergebenes Bein, riss diese Antwort die Bruecke ab bzw. setzte zwei Systeme auf ein Bein. IE4 macht die Ersatzantwort pfadgerecht: Budget-Bein -> unveraendertes Folge-Gather, uebergebenes Bein -> gueltiges leeres Dokument.

## Plan (gekuerzt)

- **Grundlage (code-gegroundet, keine Annahmen):** die Ersatzantwort ist heute fest an die Budget-Engine gebunden (`keepAliveXml: (call) => render(followupTurnDirectives(call, ""), call.provider)`); der Guard selbst braucht keine Aenderung, sein Vertrag reicht (`keepAliveXml(call)` bekommt den vollen Anruf-Datensatz). Der Zustand "wer fuehrt das Gespraech" liegt bereits persistiert am Anruf: `costProfile`, set-once, ueberlebt einen Prozess-Neustart (genau das Szenario, das der Guard abdeckt).
- **Fail-safe-Richtung zwingend:** nur ein belegtes Uebergabe-Profil darf die Antwort aendern; fehlendes/unbekanntes Profil -> unveraenderte Bestandsantwort. Erfuellt "kein Wurf bei unbekanntem Zustand", "nie Stille wo heute ein Dokument steht", und haelt die Bestandssuite gruen.
- **Neue Datei `src/telephony/leg-turn-loop.js`** (rein, kein IO): `TURN_LOOP_BY_COST_PROFILE` — vollstaendige Partition jedes bekannten Kostenprofils (`telnyx_budget`, `telnyx_inbound_budget` -> `true`; `el_convai_sip`, `telnyx_assistant`, `telnyx_inbound_realtime`, `telnyx_inbound_el_convai` -> `false`) und `legRunsOurTurnLoop(call)` als reines, nie werfendes Praedikat mit `Object.hasOwn`-Default auf `true` (fail-safe).
- **Drei Stellen in `src/routes/voice.js`:** Import von `legRunsOurTurnLoop`; Kopfkommentar-Korrektur (G5-Aufzaehlung); neue Modul-Konstante `RUNNING_DOCUMENT_UNTOUCHED` (bewusst NICHT dieselbe wie `INBOUND_ASSISTANT_HANDOFF` — unterschiedliche Fragen) plus die neue Funktion `repeatDeliveryXml(call, {render, followupTurnDirectives})`; die Naht in `makeVoiceRoutes` als 1:1-Zeilentausch, um den gepinnten `eslint-legacy-exceptions.json`-Eintrag fuer `makeVoiceRoutes` (u.a. `max-lines-per-function (274)`) nicht zu verletzen.
- **Warum eigene Datei statt in `webhook-idempotenz.js`/`telnyx-inbound.js`/`kostenarten.js`:** der Guard soll unberuehrt bleiben, die Frage gehoert zum Bein statt zur Idempotenz, das Praedikat gilt fuer beide Richtungen (Telefonie-Semantik, kein Kosten-Katalog).
- **Tests:** neue Datei `test/ie4-wiederholung-uebergebenes-leg.test.js` mit Praefix `IE4-` (keine Katalog-ID, landet im Regressionslauf). IE4-1 Inventar-/Drift-Riegel (Tabelle deckt alle `KOSTENPROFIL`-Werte); IE4-2 Randfaelle ohne Wurf (inkl. `null`, `undefined`, unbekanntes Profil, `"constructor"` gegen Prototype-Pollution); IE4-3/4/5 als HTTP-Subtests gegen einen gespawnten Server (Budget-Bein byte-identisch inkl. vollstaendigem TeXML-Vergleich, uebergebenes Bein leeres `<Response></Response>` ohne Fehlerstatus, unbelegtes Profil faellt fail-safe auf die Bestandsantwort zurueck). Bestandstests (`sec-p1-webhook-idempotenz`, `sec-p1-webhook-anker-persistenz`, `kv2-2-kostenprofil-weichen`) bleiben unveraendert und gruen.
- **Kein weiterer Dateikreis:** kein neuer Endpunkt, keine Zeile in `src/route-policy.js`, keine Env-Variable, keine neue Dependency.
- **Pre-Mortem (im Plan benannt):** (1) das leere Dokument koennte laufende Anrufe toeten — Annahme am Anbieter nicht gemessen, aber identische Bytes wie der bestehende `INBOUND_ASSISTANT_HANDOFF`-Weg, daher als akzeptiertes Risiko ohne Testanruf; (2) ein Budget-Bein koennte faelschlich Stille bekommen — nur ueber falsches `costProfile` moeglich, abgesichert durch Set-once-Schreibweg + `Object.hasOwn`-Default + byte-gepinnten Test; (3) ein neues 7. Kostenprofil koennte vergessen werden — Inventar-Test macht das rot statt still falsch; (4) der eslint-Pin koennte still angehoben werden — verhindert durch expliziten 1:1-Zeilentausch und Verifikationsbefehl.
- **Benannter Restbefund (nicht IE4-Scope):** ein Inbound-Bein auf dem Telnyx-Assistant-Handoff-Pfad behaelt `costProfile = telnyx_inbound_budget` (Profil wird VOR dem Handoff gesetzt, set-once verwirft ein spaeteres Setzen). Verschiebung dieses Schreibwegs ist Scope von IE6 Stufe 1; der Pfad ist ohnehin per Default aus (`telnyxAssistant.enabled`) und als kaputt dokumentiert.

## Impl-Zusammenfassung

- **headCommit:** `dbb0408eb536c925f6108441f4c5bf7ac6a3ea09`
- **node --check:** PASS; **Tests:** 6016 pass / 0 fail (voller `npm test`, json-Backend inkl. inline pg/pglite-Faelle)
- **Neue Dateien:** `src/telephony/leg-turn-loop.js`, `test/ie4-wiederholung-uebergebenes-leg.test.js`
- **Editierte Datei:** `src/routes/voice.js` (genau die 4 im Plan spezifizierten Stellen: Import, Kopfkommentar, `RUNNING_DOCUMENT_UNTOUCHED` + `repeatDeliveryXml`, die Naht in `makeVoiceRoutes`)
- Umsetzung exakt gemaess Plan. eslint-Pin fuer `voice.js` verifiziert unveraendert (274 Zeilen; `complexity`/`no-magic-numbers` deckungsgleich mit `eslint-legacy-exceptions.json`, via `npx eslint --suppressions-location eslint-suppressions.empty.json` gemessen).
- Smoke-Test manuell durchgefuehrt (Server Port 3999, `SKIP_TWILIO_SIGNATURE_CHECK=true`, bootstrap-tenant fuer aktive Nummer): zwei identische `/voice/incoming`-Zustellungen fuer einen frischen Budget-Call liefern byte-identisches Gather (Prozess-Cache-Pfad, unveraendert).
- Commit lief durch den Pre-Commit-Lint-Hook; erste Testfile-Fassung hatte 4 eigene id-length/no-magic-numbers-Verstoesse, behoben durch benannte Konstanten und Extraktion dreier Helferfunktionen (`pruefeBudgetBein`/`pruefeUebergebenesBein`/`pruefeUnbelegtesProfil`) gegen die 100-Zeilen-Funktionsobergrenze.

### Deviations

1. Test-interne Struktur leicht anders als der Plan-Prosatext skizziert: die drei HTTP-Subtest-Koerper wurden in eigene Helferfunktionen ausgelagert statt Inline-Arrow-Funktionen (max-lines-per-function-Grenze der Testdatei), Testfaelle/Assertions inhaltlich identisch zum Plan.
2. Abnahme-Befehl `npm run inbound:hoerprobe` aus dem Plan existiert auf `master` nicht (gehoert zu IP2, nicht gemergt) — wie im Plan selbst als "ehrlicher Befund" vermerkt, daher nicht ausgefuehrt.

## Safety-Urteil

**approved: true**, alle Kern-Flags (`testsPassIndependently`, `safetyGatesIntact`, `disclosureIntact`, `authFailClosedIntact`, `noSecretsLeaked`, `scopeRespected`, `behaviorAsIntended`) true, **keine Blocker**.

**verdict: PASS (mit Auflagen zur Dokumentation, keine Blocker).** Diff minimal und rein additiv (3 Dateien, 254+/5-); `package.json`, `package-lock.json`, `src/route-policy.js`, `src/claude.js`, `src/bridge.js` nachweislich unberuehrt. Kein Pfad loest Calls/SMS/Geld aus; der Riegel bleibt strukturell vor den Gates (budgetExceeded, Denylist/Land-Gate/Stundenlimit, Verifikation-als-Outbound-Permit, OUTBOUND_FROZEN) unbeteiligt. Auth-Riegel bleibt pro Route hinter der `/voice`-Signatur-MW; neuer Test faehrt sogar mit echter Ed25519-Signatur (strenger als Bestand). Budget-Zweig byte-identisch by construction und attributweise gepinnt (IE4-3); neuer Zweig liefert ein gueltiges leeres Dokument, nie einen Fehlerstatus. Praedikat fail-safe (per Test und eigener PGlite-Sonde belegt), Kostenprofil-Tabelle per Inventar-Test vollstaendig gepinnt.

**Unabhaengige Verifikation:** frischer Worktree, eigener `npm test`-Lauf (6035 Tests inkl. Bank-Partition-Pruefung, gruen ohne `--test-concurrency`), eigene PGlite-Sonde (7 Faelle, alle SOLL-konform, Profil ueberlebt Neustart verlustfrei), gezielter Isolationslauf (`ie4-*` + `sec-p1-webhook-idempotenz`, 16/16 pass, `--test-concurrency=4`), `node --check` + `eslint` auf alle drei Dateien PASS, kein `eslint-disable`/`@ts-ignore`/`skip(` im Diff.

### Concerns (nicht-blockierend)

1. **Restluecke:** der Telnyx-Assistant-Inbound-Handoff behaelt `costProfile=telnyx_inbound_budget` (Profil wird vor dem Handoff gesetzt, set-once). Eine Wiederholung antwortet dort weiterhin mit Gather, obwohl der Assistant das Gespraech fuehrt — exakt die Defektklasse, die `leg-turn-loop.js` beschreiben will. Entschaerft durch Default-aus (`TELNYX_INBOUND_HANDOFF_ENABLED`) und dokumentierten 422-Defekt des Pfads selbst. Auflage: dieser Vorbehalt ("Kostenprofil ist fuer den Assistant-Handoff KEINE Wahrheit ueber den Gespraechsfuehrer") gehoert vor IE5 in den Kopf von `leg-turn-loop.js` oder in diesen Report — hiermit hier dokumentiert.
2. **Reichweite heute = null:** der neue `false`-Zweig ist in Produktion aktuell unerreichbar — `telnyx_inbound_realtime` erfordert `VOICE_ENGINE=realtime`, was ein FATAL-Boot-Riegel verhindert; `el_convai_sip`/`telnyx_assistant` sind Outbound-Profile; `telnyx_inbound_el_convai` bekommt seinen Schreiber erst in IE5. Live-Verhalten also aktuell byte-identisch zum Vorzustand.
3. `keepAliveXml` wird von beiden Waechtern geteilt (`forIncoming` UND `forTurn` in `webhook-idempotenz.js`) — die Aenderung regiert damit auch die Wiederholungs-Antwort auf `/voice/turn`; inhaltlich unbedenklich, aber kein neuer Test pinnt explizit die `/voice/turn`-Seite.
4. Abweichung von der urspruenglichen Spec-Dateiliste: zusaetzliche neue Datei `src/telephony/leg-turn-loop.js` (additiv, begruendet, kein Scope-Verstoss).
5. `npm run inbound:hoerprobe` nicht gefahren (Skript existiert nicht auf `master`, gehoert zu nicht gemergter Phase IP2); inhaltlich abgedeckt, da der erste Turn unberuehrt bleibt.
6. Kosmetik: Commit-Betreff-Tippfehler "pfadgeraechte", Kommentar-Tippfehler "zurueksetzt" in `voice.js:80`.

## Clean-Code-Audit (S1-S4)

- **s1:** []
- **s2:** []
- **s3:** []
- **s4:** []
- **blocker:** false

**verdict: PASS.** Keine S1/S2-Verstoesse gefunden. Geprueft: `git diff master..phase/ie4-idempotenz-pfadgerecht` (`src/routes/voice.js`, neue Datei `src/telephony/leg-turn-loop.js`, neue Testdatei). Kernpunkt der Pruefung war die Fail-Safe-Richtung von `legRunsOurTurnLoop` — isoliert extrahiert und per Node ausgefuehrt: Tabelle deckt alle 6 `KOSTENPROFIL`-Werte, `{}`/`null` liefern korrekt `true`, `Object.hasOwn` schuetzt gegen Prototype-Pollution (`"constructor"` wird korrekt nicht gefunden). Initialer Verdacht (fehlender `TELNYX_INBOUND_EL_CONVAI`-Schluessel) war Artefakt eines veralteten lokalen Checkouts, kein Diff-Defekt.

**passNotes:** saubere Trennung reines Praedikat in eigener Datei; Modul-Ebene-Platzierung von `repeatDeliveryXml` konsistent mit bestehendem Muster (`recordStartRejectionReason`); zwei syntaktisch identische `[]`-Konstanten bewusst nicht zusammengelegt (G5 schuetzt Wahrheiten, nicht zufaellig gleiche Werte); Fail-Safe-Richtung dokumentiert UND getestet inkl. Prototype-Pollution-Kante; Inventar-Vollstaendigkeit strukturell erzwungen (G27); klare Namensgebung; keine Magic Numbers, keine abgeschalteten Sicherungen, keine neuen Endpunkte/Auth-Ausnahmen, keine Gates beruehrt.

**topTodos:** keine Blocker. Optional/spaeter: die Kommentare in `routes/voice.js` sind sehr dicht — bei weiterem Wachstum der Datei koennte eine Auslagerung der IE4-spezifischen Konstanten/Funktion nach `leg-turn-loop.js` selbst erwogen werden (keine Pflicht, nur Beobachtung).

## Fix-Runden

Keine — Safety- und Clean-Code-Review liefen direkt PASS ohne Blocker, keine Fix-Runde noetig.
