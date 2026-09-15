# Phase IEL-B4: Nachlauf-Politik Inbound im EL-Poll

**Gate:** PASS
**finalBranch:** `phase/iel-b4-nachlauf-politik`
**headCommit:** `d21889d`
**Basis:** master `0243b64` (IEL-B1-B4a gemergt)

## Plan (gekuerzt)

Ziel: der ziehende EL-Ergebnisweg (`elevenlabs/outbound.js`) bereitet einen ueberbrueckten Inbound-Call (Kostenprofil `telnyx_inbound_el_convai`) anders nach als einen Outbound-EL-Call — als reine, testbare Politik-Tabelle statt verstreuter if/switch.

Kern-Befunde vor dem Bau:
- `makeElevenLabsOutbound` hat 91 Zeilen, Limit 100 → `finishFromConversation` muss auf Modul-Ebene ziehen, sonst passt die Politik nicht in die Fabrik.
- `test/fehlergrund-reihenfolge-riegel.test.js` verlangt genau 2 Treffer fuer `persistEnd: persistEndWithReason({` und 0 fuer `store.recordFailureReason(` — beide Naehte bleiben woertlich.
- Keine gemockte Uhr moeglich (`Date.now()` direkt in `pollConversationResult`/`waitUntil`); Zeitanker relativ zu `Date.now()`.
- `INBOUND_NACHLAUF_FRIST_MS` ist in der Spec nicht beziffert (Anbieter-Verarbeitungsdauer ungemessen) → Lead-Entscheidung noetig, Vorschlag: `= ELEVENLABS_PROVIDER_MAX_DURATION_S * MS_PER_SECOND`, keine neue Env-Variable.

Neue Datei `src/elevenlabs/nachlauf-politik.js` (rein, ohne Store/config/IO): zwei eingefrorene Politik-Objekte (`HEUTIGE_POLITIK`, `INBOUND_EL_POLITIK`) mit den Achsen Anker-Nachzug, Anbieter-Zusammenfassung, next_steps-Item, Beende-Versuch (EL vs. Traeger), Frist-Anker (Anbieter-Cap vs. Nachlauf-Start), Ende-Anker (jetzt vs. Carrier-Ende), frische Pruefung nach Abruf. `nachlaufPolitikFuer(call)` waehlt ueber `bridgeStateOf`; `pollDarfWirken(call)` kapselt den einen Riegel (aktiv + nicht RUECKFALL).

Edits an `outbound.js` (kein Restrukturieren daruber hinaus): `persistCollectedFields`/`persistProviderResult` nehmen `politik`; neue Modul-Helfer `carrierEndeIso`, `ankerFuerPolitik`, `pollFristAbgelaufen`, `endeSchreiberFuer`, `endeOhneErgebnisIso`; `finishWithoutProviderResult` nutzt bei Traeger-Politik `endCarrierCall` statt DELETE; `finishFromConversation` zieht auf Modul-Ebene; `startInboundNachlauf` als neues Start-Tor (set-once-Marker, Single-Flight-Register `laufendeInboundPolls`); `rearmActiveConversationPolls` uebergeht RUECKFALL-Calls und traegt GEBUNDEN-Calls ins Register ein; Fabrik bekommt `endCarrierCall`-Parameter, Register, Wrapper `pollConversationResult`/`pollTakt` mit `FOLGETAKT_GEPLANT`, frische Pruefung nach dem Abruf (kein `await` danach bis `setCallEndedAt`), Ruckgabe um `startInboundNachlauf` erweitert.

`src/billing/metering.js#liveVoiceMinutesOf`: Ende-Anker = `carrierEndMsOf(call, nowMs)` statt `nowMs` — ein Call im Nachlauf waechst nicht weiter in die Tenant-Kostendecke (Spec E17), ohne Marker byte-identisch zu vorher.

`src/server.js`: `endCarrierCall` per DI ueber `hangUpAction(voiceControl, call, call.twilioSid)` — dieselbe Handle-Entscheidung wie Cap und `cancel_call`. Kein Aufrufer von `startInboundNachlauf` in dieser Phase (kommt mit B5).

Tests: neue Datei `test/iel-b4-nachlauf.test.js`, 16 Faelle inkl. Positiv-Kontrollen (2P/5P/7P), Praefix `IEL-B4-` (landet in `npm test`, nicht in Gates/Abnahme). Bestandstests (`el-beende-versuch`, `el-anbieterfehler-anker`, `el-geldpfad-s1`, `el-action-items`, `a8-abschluss-zusammenfassung`, `fehlergrund-reihenfolge-riegel` u.a.) sollen unveraendert gruen bleiben.

Pre-Mortem im Plan deckte u.a. ab: Outbound-Buchungsabweichung, doppeltes Transkript nach Purge, Ruckfall-Gespraech wird faelschlich abgerechnet, Carrier-Minuten auf 0, Leitung laeuft nach Aufgabe weiter, Frist bucht mit, Cap-Pfad im Nachlauf (explizit NICHT-Scope, kommt mit B5).

## Impl-Zusammenfassung

Wie geplant gebaut, Commit `d21889d` auf `phase/iel-b4-nachlauf-politik`. Neue Datei `nachlaufPolitikFuer`/`pollDarfWirken`; alle geplanten Aenderungen in `outbound.js`, `metering.js` (`liveVoiceMinutesOf` nutzt `carrierEndMsOf`), `server.js` (`endCarrierCall`-Verdrahtung). `INBOUND_NACHLAUF_FRIST_MS` wie im Plan vorgeschlagen ohne Env gesetzt. `startInboundNachlauf` hat in dieser Phase keinen Aufrufer.

Pruefungen: `nachlaufPolitikFuer` 6× in `outbound.js` (Soll ≥4), `persistEnd: persistEndWithReason({` genau 2×, `store.recordFailureReason(` 0×. eslint auf allen 5 Dateien exit 0, keine neue Unterdrueckung. Fabrik bleibt unter der Zeilengrenze. Neuer Test 19/19 gruen (Fall 8 wurde in 8 und 15 aufgeteilt bzw. um einen zusaetzlichen Fall ergaenzt — Zahl 19 statt geplanter 16, s. Deviations). Gezielt bestehende EL-/Billing-Tests gruen (139/139, erweitert 189/189).

Voller Lauf `npm test -- --test-concurrency=4`: 5650 Tests, 5648 bestanden, 2 fehlgeschlagen — beide in `test/elevenlabs-consult-webhook-blockers.test.js` (BL-4 Positiv-Kontrolle), Datei fasst den Poll-Pfad nicht an, isoliert ebenfalls flaky (1 von 5 Laeufen rot), nicht gegen master verifiziert.

Smoke-Test: Server startete mit echter `server.js`-Verdrahtung inkl. `endCarrierCall`, `/healthz` lieferte 200. Neuer Code-Pfad ueber `curl` nicht erreichbar (kein Aufrufer von `startInboundNachlauf`, kein Code setzt heute das Inbound-EL-Kostenprofil).

### Deviations

- Faelle 8/15: `maxOffen === 1` allein erkennt eine zweite Schleife nicht (Fetch-Attrappe antwortet sofort, kein Ueberlapp). Neuer Helfer `startTorWaehrendAbruf` haelt den Fetch waehrend `startInboundNachlauf` offen und prueft `offen === 1`; Mutation (Register-Check entfernt) wird jetzt erkannt.
- Test-Harness: `mitAnbieter` beendet bei fehlgeschlagener Assertion mitten im Lauf zuerst alle aktiven Calls — ohne das liefen Schleifen nach `withFetch` gegen das echte Netz weiter und der Testprozess beendete sich nicht.
- Test-Store: `setCallEndedAt` liefert `call` statt `{call, changed}`, passend zur echten json/pg-Fassade; `helpers.js` (liefert das Paar) bleibt unveraendert.
- Ungedeckte Restluecken (nicht im Plan): (a) der `pollDarfWirken`-Filter in `rearmActiveConversationPolls` ist nicht separat beobachtbar, weil `pollTakt` denselben Riegel am Taktbeginn nochmal prueft (Verteidigung in der Tiefe); (b) Entfernen des Register-Austrags aus dem `finally`-Block wird nicht erkannt (nur relevant, wenn ein Takt wirft — waere auch vorher ein unbehandelter Reject gewesen).
- `npm test` nicht vollstaendig gruen: 2 Fails in `test/elevenlabs-consult-webhook-blockers.test.js`, Datei flaky auch isoliert, nicht gegen master abgeglichen.

## Safety-Urteil

**approved: true**, alle Kern-Flags true (testsPassIndependently, safetyGatesIntact, disclosureIntact, authFailClosedIntact, noSecretsLeaked, scopeRespected, behaviorAsIntended). Keine Blocker.

Unabhaengiger Testlauf (frischer Worktree, Branch `review-iel-b4` ab `phase/iel-b4-nachlauf-politik`, Basis master `0243b64`): `node --check` auf allen 4 geaenderten src-Dateien ok; neuer Test 19/19 gruen; gezielter Satz aus 16 unveraenderten Bestandstests 199/199 gruen; `grep -c nachlaufPolitikFuer` = 6.

Verdict: Diff beruehrt genau die 5 von der Spec genannten Dateien, keine neue Dependency/Route/Log/Secret. In Produktion wirkungslos, da kein Code das Kostenprofil `TELNYX_INBOUND_EL_CONVAI` setzt und `startInboundNachlauf` keinen Aufrufer hat — jeder echte Call laeuft `HEUTIGE_POLITIK`. Outbound per Code-Lesung als unveraendert belegt. Kostendecke bleibt fuer beide Richtungen wirksam; Live-Term friert im Nachlauf korrekt auf die Carrier-Dauer ein, unlesbarer Marker bleibt fail-closed (NaN). Denylist, Land-Gate, `OUTBOUND_FROZEN`, Signaturpruefung nicht betroffen.

Concerns (keine Blocker):
1. Mehr Umbau als die Spec fuer B4 vorsah (`finishFromConversation` auf Modul-Ebene, Wrapper/`pollTakt`-Split) — zeilenweise geprueft, Verhalten fuer HEUTIGE_POLITIK unveraendert.
2. `carrierEndeIso` rechnet mit `nowMs` = Taktbeginn; faellt der Marker in einen haengenden Abruf, kann `endedAt` um bis zu `REQUEST_TIMEOUT_MS` (120 s) zu frueh liegen (Unterbuchung), nur nach Neustart mit bereits laufender re-armierter Schleife moeglich.
3. `rearmActiveConversationPolls` prueft `laufendeInboundPolls` nicht vor dem Start — ein zweiter Re-Arm-Aufruf im selben Prozess koennte theoretisch eine zweite Schleife fuer denselben Call starten; frische Pruefung nach Abruf plus `setCallEndedAt` nur aus `active` verhindert trotzdem einen doppelten Abschluss. In Produktion wird Re-Arm nur einmal beim Boot aufgerufen.
4. Fehlt `endCarrierCall` in der Fabrik, wirft der Traeger-Beende-Versuch einen TypeError, der `terminateAndBillCall` ohne Log schluckt (kein `onHangUpError`) — `server.js` verdrahtet ihn, aber eine fehlende Verdrahtung faellt still statt laut aus.
5. `startInboundNachlauf` prueft die GEBUNDEN-Vorbedingung nicht selbst (laut Spec Aufgabe des B5-Aufrufers) — muss B5-Review abdecken.
6. `persistProviderResult` schreibt fuer Inbound-EL weiterhin `objectiveAchieved` aus der EL-Analyse; wird von `summarizeCall` ueberschrieben, harmlos, aber von E6 nicht ausdruecklich geregelt.

## Clean-Code-Audit (S1-S4)

**verdict: PASS**, **blocker: false**. S1 leer, S2 leer.

S3 (kleine Verbesserungen, nicht blockierend):
- In `finishFromConversation` wird `answeredAnchorOutcome(...)` auch fuer Inbound-EL berechnet, obwohl `ankerFuerPolitik` das Ergebnis danach verwirft (`TRAEGER_ANKER_BLEIBT`) — rein funktional korrekt, aber ein fruehzeitiger Kurzschluss waere klarer.
- Hohe Dichte neuer deutsch-englischer Ad-hoc-Komposita (`nachlaufPolitikFuer`, `pollDarfWirken`, `carrierEndeIso`, `endeSchreiberFuer`) — repo-konform, aber ein kleines Modul-Kopf-Glossar wuerde langfristig helfen.

S4 (bewusste Faktorisierung, gerechtfertigt): mehrere neue Modul-Ebene-Helfer erhoehen die Funktionsanzahl in `outbound.js`, jede hat genau eine Aufgabe, ist einzeln benannt/kommentiert und mehrfach wiederverwendet bzw. gezielt getestet.

Positiv hervorgehoben: reine Politik-Tabelle statt verstreuter if/switch (vermeidet G23-Duplizierung), G5-konforme Wiederverwendung, Grenzfaelle explizit benannt und getestet, Money-Pfad mit Positiv-Kontrollen gegen Regression abgesichert (IEL-B4-2P/5P/7P), Objekt-Parameter statt Positionsargumente (F1 eingehalten), Magic Numbers benannt, keine Umlaute im Code, saubere Trennung Politik/Ausfuehrung. Ein anfangs beobachteter Einzel-Fail in der vollen Suite wurde als bekannter Parallelitaets-Flake eingestuft (Re-Run gruen).

## Security-Urteil

**approved: true**, **verdict: PASS (Security)**, keine Blocker. Keine neue/geaenderte Route, kein neuer Eintrag in `route-policy.js` noetig, route-auth-inventory gruen. Keine neue Dependency, keine Secrets/PII in Ausgaben. `endCarrierCall` nutzt dieselbe `hangUpAction`-Funktion wie Cap/`cancel_call`. Outbound byte-identisch belegt (`bridgeStateOf` liefert `KEIN_EL_INBOUND` fuer jedes andere Kostenprofil). Kostendecke: Live-Term-Aenderung ist Spec E17, unlesbarer Marker bleibt fail-closed. Register plus frische Pruefung verhindern im Prozess eine zweite Persistenz nach Purge. Ein Ruckfall-Call wird weder abgeschlossen noch gebucht noch nach Neustart erneut gepollt. Tests: IEL-B4-1..16 gruen (19/19), plus 66/66 Sicherheits-relevante Bestandstests.

Concerns (keine Blocker):
1. Die Spec-Invariante "Outbound-/Budget-Calls tragen nie `elNachlaufStartedAt`" ist nicht strukturell erzwungen (weder `startInboundNachlauf` noch `markInboundElNachlaufStarted` pruefen GEBUNDEN; `liveVoiceMinutesOf` liest den Marker fuer jeden Call). Empfehlung: zusaetzliche `bridgeStateOf === GEBUNDEN`-Pruefung als zweite Verteidigungslinie, Negativtest in B5.
2. Ein GEBUNDEN-Call ohne Nachlauf-Marker hat keine eigene Poll-Frist, einzige Obergrenze ist der re-armierte Max-Dauer-Cap (Spec-konform E7f) — B5 muss belegen, dass der Cap fuer Inbound-EL-Calls wirklich armiert ist und terminiert.
3. `endActiveCall` schickt weiterhin DELETE an ElevenLabs, auch fuer Inbound-EL; heute nicht erreichbar, weil `hangUpAction` fuer Inbound dank `twilioSid` immer einen Handle liefert. Invariante haengt an dieser Auswahl — B5 sollte das per Test festhalten.
4. Grenze je Prozess bleibt bei Deploy-Ueberlappung (E18-3, laut Spec akzeptiert); Eintrag in `PLAN-SECURITY.md` fuer IEL-B8 vorgesehen, muss dort tatsaechlich landen.

## Fix-Runden

Keine. Der Plan-Implementierungs-Review-Zyklus erreichte PASS ohne Fix-Runde (Feld `FIXES` im Quellmaterial leer).
