# Phase IEX-A1: Kosten-Join nur fuer Profile mit TELNYX_SIP

**Gate:** PASS
**finalBranch:** `phase/iex-a1-kosten-join-fix1`
**Basis:** `master` `e11f5ec`

## Plan (gekuerzt)

Grundlage: Spec-Abschnitt IEX-A1, A4, §1 Zeile "Kosten", [R2] C.4, [CP] Befund 1.

**Kernidee:** Der Join-Schluessel (`store.recordSipCallId`) und die erwartete `telnyx_sip`-Buchzeile werden kuenftig nur noch geschrieben, wenn das Kostenprofil des Anrufs laut Katalog ueberhaupt einen `telnyx_sip`-Traeger fuehrt. Inbound-EL-Anrufe (`TELNYX_INBOUND_EL_CONVAI`) liefern als `call_id` eine UUID ohne Telnyx-Beleg — der bisherige Join erzeugte dort eine verwaiste `telnyx_sip:erwartet`-Zeile ohne Leser und einen sinnlosen `[join-schluessel] verworfen`-Log.

**Zwei begruendete Abweichungen von der Spec:**

- **A) Zwei Bestandstests mussten zwingend angepasst werden**, weil sie das alte Verhalten direkt pruefen: `test/iel-b5-status-ende.test.js` (IEL-B5-19, prueft bisher `sipCallId` als Beleg fuer "persistProviderResult lief") und `test/kv2-4-el-kosten-beleg.test.js` Ebene 1 (8 Tests erwarten die `telnyx_sip`-Zeile ohne das neue Feld `erwarteTelnyxSip`). Das neue Feld bekommt bewusst KEINEN Default (Muster `belegNachreifbar`: ausdruecklich, kein stiller Default).
- **B) Die A4-Formel gilt nur fuer Anrufe MIT gesetztem `costProfile`.** Ohne Profil bleibt das heutige Verhalten (Legacy-Zuordnung `legacyKostenprofil({sipCallId, direction})`). Grund: `kostenprofilFuerAnruf` faellt bei fehlendem Profil auf `legacyKostenprofil` zurueck, die genau das Feld `sipCallId` liest, das der Join erst schreiben soll — ein Kreisschluss. Ohne Schutz wuerde ein Anruf ohne Profil den Join fuer immer verlieren und dauerhaft `telnyx_budget` werden (B6-Falle: vollstaendig aussehendes Buch trotz fehlendem Pflicht-Traeger, Risiko falscher Erstattung). In Produktion heute nicht erreichbar (jeder Startpfad setzt das Profil vor dem Waehlen), aber drei Bestandstests laufen ohne Profil und muessen unveraendert gruen bleiben.

**Neue Datei:** `test/iex-a1-inbound-el-join.test.js`, 6 Tests (IEX-A1-1 bis -6) auf echtem json-Store (Temp-`DATA_DIR`), keine Attrappe fuer den Waechter. Deckt: Inbound-EL ohne Join/ohne Zeile, Outbound mit Profil (Join wie bisher), Outbound mit Profil + UUID-`call_id` (Join-Log, kein `sipCallId`), Outbound ohne Profil (Abweichung B), Profil-Tabelle fuer `anrufFuehrtTelnyxSip`, In-Memory-Test mit `erwarteTelnyxSip:false`.

**Geaenderte Dateien laut Plan:**
- `src/elevenlabs/kosten-beleg.js` — neues reines Praedikat `anrufFuehrtTelnyxSip(call)`; neues Feld `erwarteTelnyxSip` in `recordElevenLabsKostenBelege` (kein Default); Kommentare angepasst.
- `src/elevenlabs/outbound.js` — `persistProviderResult` ruft `recordSipCallId` nur noch bei `fuehrtTelnyxSip`, derselbe Wert geht als `erwarteTelnyxSip` weiter.
- `test/kv2-4-el-kosten-beleg.test.js` — 17 direkte Aufrufe (Ebene 1) um `erwarteTelnyxSip:true` ergaenzt.
- `test/iel-b5-status-ende.test.js` — IEL-B5-19 auf `elDetectorCounts` als Positiv-Kontrolle umgestellt, `sipCallId === null` erwartet.

**Nicht angefasst:** Katalog (`kostenarten.js`), Waechter (`state-ops.js#recordSipCallId`), `call-leg-ref.js`, Settlement, Boot, Config, `.env.example`, `render.yaml`, `PLAN-SECURITY.md`.

**Pre-Mortem (Auszug):** Risiko "Outbound-EL verliert Join, Settlement erstattet nie" — abgedeckt durch IEX-A1-2/3 plus unveraenderte Bestandstests und den B-Schutz. Risiko "kuenftiger Aufrufer vergisst `erwarteTelnyxSip`" — akzeptiert, nur ein Aufrufer existiert, Effekt ist rein Buchhaltung (fehlende Platzhalterzeile), keine Gate-Wirkung.

## Impl-Zusammenfassung

Branch `phase/iex-a1-kosten-join` (spaeter `-fix1` nach Review-Runde), Basis `master` `e11f5ec`, finaler Commit `3b98b79`.

- `anrufFuehrtTelnyxSip(call)` neu, rein: ohne `costProfile` → `true` (Bestandsverhalten); sonst `pflichtTraegerFuerProfil(kostenprofilFuerAnruf(call)).includes(TELNYX_SIP)`.
- `recordElevenLabsKostenBelege` bekommt `erwarteTelnyxSip`, ohne Default; `recordTelnyxSipErwartet` laeuft nur noch bei `erwarteTelnyxSip === true`.
- `persistProviderResult` in `outbound.js`: `recordSipCallId` nur noch bei `fuehrtTelnyxSip`; derselbe Wert an `recordElevenLabsKostenBelege` als `erwarteTelnyxSip` gereicht.
- `test/kv2-4-el-kosten-beleg.test.js`: alle 17 direkten Aufrufe (Ebene 1) mit `erwarteTelnyxSip:true`, keine Erwartung geaendert.
- `test/iel-b5-status-ende.test.js`: Konstante `EXPECTED_SIP_CALL_ID` entfernt, IEL-B5-19 prueft `elDetectorCounts !== null` (Positiv-Kontrolle) und `sipCallId === null`.
- Neu: `test/iex-a1-inbound-el-join.test.js`, 6/6 gruen.

**Nachweise:** `node --check` gruen auf allen 5 Dateien; neue Testdatei 6/6; 7 gezielte Dateien 93/93; `npm test -- --test-concurrency=4` Exit 0, 5844/5844 (korrigiert: 5824/5824 nach Zaehlweise-Abgleich mit dem Probelauf); `rg` bestaetigt genau je einen Aufrufer fuer `recordSipCallId(` und `recordElevenLabsKostenBelege(` in `src/elevenlabs`. ESLint-Pre-Commit-Hook 0 Fehler/Warnungen.

**Smoke nicht bestanden, kein Blocker:** Server bricht ohne geseedete aktive Nummer im Store beim Start ab (unabhaengig von dieser Aenderung); der geaenderte Pfad (EL-Ergebnis-Poll) ist ohnehin nicht per `curl` ansprechbar und wird durch die Integrationstests IEX-A1-1 bis -4 auf dem echten json-Store abgedeckt.

### Deviations
- Keine inhaltlichen Abweichungen vom Plan; die Abweichungen A und B stammen aus dem Plan selbst.
- Die Rotprobe vor der src-Aenderung wurde nur als Ladefehler (fehlender Export) bestaetigt; die fachliche Rotprobe fuer IEX-A1-1 stammt aus dem Probelauf des Plans und wurde in der Umsetzung nicht wiederholt.
- Smoke-Test nicht bestanden (s.o.), als unbedenklich eingestuft.

## Safety-Urteil

**approved: true**, alle Einzelpruefungen (`testsPassIndependently`, `safetyGatesIntact`, `disclosureIntact`, `authFailClosedIntact`, `noSecretsLeaked`, `scopeRespected`, `behaviorAsIntended`) **true**, keine Blocker.

Unabhaengiger Testlauf in frischem Worktree (Branch `review-iex-a1-r1` ab `phase/iex-a1-kosten-join-fix1`): `node --check` gruen; 3 betroffene Testdateien 47/47 gruen; erweiterter Regressionslauf auf verwandten Dateien 63/63 gruen; zwei Mutationsproben (jeweils rueckgaengig gemacht) zeigen, dass die neuen Tests in beide Richtungen diskriminieren (a: alter Join-Wert → IEX-A1-1 rot; b: Join immer aus → IEX-A1-2/-3/-4 rot). Keine verwaisten Testprozesse.

**Verdict:** PASS. Nichts an Tenant-Kostendecke, Denylist/Land-Gate/Stundenlimit, Max-Dauer, `OUTBOUND_FROZEN`, Outbound-Permit, Signaturpruefung, Auth, Routen, `disclosureSentence`, Inbound-Hinweis oder TeXML wird beruehrt. Leser von `telnyx_sip`-Zeilen (`kosten-deckung.js`, Sweep, Nachlauf-Phasenschnitt) pruefen nur den Pflicht-Traeger des Profils bzw. `EL_CONVAI_SIP` — die Aenderung hat dort keine Wirkung.

**Concerns (nicht blockierend):**
- Abweichung B (costProfile==null → true) ist konservativ, haelt Bestandsverhalten, ist im Code kommentiert und durch IEX-A1-4 gepinnt, steht aber nicht woertlich in der Spec.
- Kein Default fuer `erwarteTelnyxSip` — ein kuenftiger vergesslicher Aufrufer wuerde keine `telnyx_sip`-Erwartungszeile schreiben; heute nur ein Aufrufer, der es explizit setzt.
- Zwei Bestandstests ueber die Spec-Dateiliste hinaus geaendert (IEL-B5-19, kv2-4 Ebene 1) — folgt zwingend aus der Verhaltensaenderung, schwaecht kein Gate.
- Bereits im Store liegende verwaiste `telnyx_sip:erwartet`-Zeilen auf alten Inbound-EL-Anrufen werden nicht bereinigt; laut Spec out-of-scope und ohne Wirkung, da `TELNYX_INBOUND_EL_CONVAI` `telnyx_sip` nicht als Pflicht-Traeger fuehrt.

## Clean-Code-Audit (s1-s4)

- **s1:** leer (keine Blocker-Befunde)
- **s2:** leer
- **s3:** ein Vermerk — `erwarteTelnyxSip` als boolescher Parameter (klassisches F3-Signal), im Code bereits explizit begruendet (Tatsache aus dem Katalog statt Aufrufer-Komfort, Vermeidung eines doppelten fail-soft-Rahmens) und durch IEX-A1-6 abgedeckt; PASS mit Vermerk statt FLAG (Regel 3, Vorrang Lesbarkeit).
- **s4:** leer

**Verdict:** PASS. Diff klein (5 Dateien, 280/22 Zeilen), praezise begruendet. Kernaenderung `anrufFuehrtTelnyxSip` ist rein (P6) und wird fuer Join und Buchzeile wiederverwendet (G5, keine Duplizierung). B6-Falle per Kommentar UND Test (IEX-A1-4/5) abgedeckt. Keine Magic Numbers, kein toter/auskommentierter Code, Funktionslaenge/Verschachtelung weit unter Richtwerten. Kommentarstil folgt der etablierten, ausfuehrlichen Projektkonvention (G24). Genau ein Produktions-Caller pro geaenderter Funktion — vollstaendig aktualisiert.

**passNotes:** 6 neue IEX-A1-Tests + 3 angepasste Bestandsdateien 47/47 gruen im Fokuslauf; voller `npm test` auf dem Phase-Branch 5824/5824 gruen, keine Regression. Testdesign folgt Build-Operate-Check-Muster (P13), echter json-Store statt Attrappe fuer den Waechter-Test.

## Security-Review (final)

**approved: true**, keine Blocker.

Angriffsflaeche: keine neue/geaenderte Route, keine Auth-/Signatur-/Webhook-Aenderung, `route-policy.js` unberuehrt. Keine neuen Eingaben von aussen (`call_id` stammt aus der ElevenLabs-Poll-Antwort, `costProfile` setzt nur der Server, set-once, gegen den Katalog geprueft). Alle Gates (Kostendecke, Denylist/Land/Stundenlimit, Max-Dauer, KYC-Permit, `OUTBOUND_FROZEN`, Offenlegung) unberuehrt. Keine neuen Logzeilen, keine Secrets, keine PII — bestehender `[join-schluessel]`-Log wird fuer Inbound seltener.

**Concerns (nicht blockierend):**
- `anrufFuehrtTelnyxSip(store.getCall(callId))` in `persistProviderResult` laeuft ausserhalb des fail-soft-Rahmens; Risiko ist identisch zum vorherigen `recordSipCallId`-Aufruf (liest ebenfalls den Anruf), keine neue Luecke.
- Fehlender Default fuer `erwarteTelnyxSip` ist fail-closed (Unterbuchung ausgeschlossen ueber `offeneTraeger`), aber ein Punkt fuer kuenftige Aufrufer.
- Unbekanntes, aber gesetztes `costProfile` ergibt `false` bei `anrufFuehrtTelnyxSip` — ueber `recordCostProfile` nicht erreichbar (Mutator lehnt unbekannte Profile ab), nur denkbar bei DB-Drift, dann ebenfalls fail-closed.

## Fix-Runden

**r1:** Einziger Blocker (IEL-B5-19) behoben — die urspruengliche `assert.notEqual(elDetectorCounts, null)`-Pruefung war ein Placebo: der json-Store liefert fuer ein ungesetztes Feld `undefined` statt `null`, und `notEqual(undefined, null)` ist unter `strict assert` bereits wahr — die Pruefung blieb also auch mit einem No-Op-`persistProviderResult` gruen. Ersetzt durch `assert.deepEqual` gegen den erwarteten Wert. Nach dem Fix: finaler Branch `phase/iex-a1-kosten-join-fix1`, alle Reviews (Safety, Clean-Code, Security) PASS.
