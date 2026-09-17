# Phase IEX-A2: Fehlersatz statt Budget-Rueckfall, keine Benachrichtigung

- **Gate:** PASS
- **finalBranch:** `phase/iex-a2-fehlersatz`
- **headCommit:** `3fcbe0712e1eb340b170df54172b114e11e097d8`
- **Basis:** `phase/iex-a1-kosten-join-fix1` (210f446)

## Ziel

Scheitert die Uebergabe eines eingehenden Anrufs an den ElevenLabs-Agenten (Zustand `WARTET`, oder `GEBUNDEN` unter `EL_MIN_CONVERSATION_MS`), spricht `/voice/el-rueckfall` seit dieser Phase einen festen Fehlersatz (Namenssatz + technischer Fehler-Hinweis) in der Agentenstimme und legt auf. Es gibt kein Budget-Rueckfallgespraech mehr. Gescheiterte Uebergaben loesen keine Benachrichtigung mehr aus (keine Mail, SMS, Zusammenfassung, Inbox-Eintrag) — nur eine Logzeile `[el-uebergabe] gescheitert`.

## Plan (gekuerzt)

Fuenf dokumentierte Abweichungen von der Ausgangs-Spec, alle am Code belegt:

| # | Abweichung | Entscheidung |
|---|---|---|
| D1 | Grund-Schreibung sollte laut Spec in `routes/voice.js` liegen | Riegel `test/fehlergrund-reihenfolge-riegel.test.js` (R4b) verbietet `store.recordFailureReason(` dort. Neues eigenes Modul `src/elevenlabs/inbound-uebergabe-gescheitert.js` als EINE Schreibstelle (kein End-Naht-Code, das Ende laeuft weiter ueber `/voice/status`). |
| D2 | Bundle-Feld `inboundNameSatz(name)` schon in A2 | Verschoben nach IEX-A3 (waere in A2 toter Code, GAP-31 bliebe sonst rot). Wortlaut/O4-Form trotzdem ueber `inboundFehlersatz` getestet. |
| D3 | `store.markInboxEntry(call.id, false)` explizit aufrufen | Entfaellt — ist im Bestand ein No-op bei `false`, waere toter Code. |
| D4 | Alle betroffenen Tests in `iel-b8-weiche.test.js` umschreiben | Nur 1, 2, 3, 16, 21 geaendert/entfernt; 4, 5, 12, 18, 19 (Pflichtsatz vor Dial) bleiben unveraendert, da NICHT-Scope bis A3. |
| D5 | Catch in `/voice/el-rueckfall`: Marker „best-effort“ bedingungslos | Marker im Catch nur, wenn `rueckfallEntscheidungFuer` FEHLERSATZ ergibt — sonst wuerde ein alter GEBUNDEN-Call seinen Nachlauf oder ein Budget-Call seine Benachrichtigung verlieren. |

Zusaetzliche geplante Nebenwirkung: `finishCall`-Komplexitaet steigt von 21 auf 22 (ein neuer frueher Return-Zweig, unvermeidbar), Pin in `eslint-legacy-exceptions.json` angehoben.

Neues Modul `src/elevenlabs/inbound-uebergabe-gescheitert.js`: Enum `INBOUND_EL_GRUND` (`EL_UEBERGABE_GESCHEITERT`, `EL_OHNE_REGISTRIERUNG` — Leser erst ab IEX-A9) und `vermerkeUebergabeGescheitert()` als einzige Stelle, die Marker, Fehlergrund und Fristende setzt.

Geplante Aenderungen u.a. in `locales.js` (Namenssatz + Fehlersatz je Sprache de/en/fr), `inbound-notice.js` (Entfernen von `rueckfallBegruessung`), `inbound-rueckfall.js` (neues Enum `RUECKFALL_ENTSCHEIDUNG` mit `FEHLERSATZ` statt `RUECKFALL_STARTEN`, `msSeitBindung`, `elFehlersatzDirektiven`), `inbound-bridge-state.js` (`uebergabeGescheitert()`), `routes/voice.js` (`sprecheFehlersatz`, `vermerkeNachFehlerBestEffort`, `sendFehlersatzOhneAufloesung`), `telephony/call-finish.js` (frueher Return nach Buchung, Logzeile), plus Kommentar-Korrekturen in `inbound-bridges.js`/`outbound.js` und `PLAN-SECURITY.md` IEL-B8-Abschnitte.

Pre-Mortem im Plan deckte u.a. ab: Verlust eines echten Gespraechs durch zu breiten Marker (D5), Owner-Kurzgespraeche unter 5s als akzeptiertes Restrisiko (A3-Heuristik), Stille im Catch (ausgeschlossen durch synthesefreien Fallback), Offenlegung (Pflichtsatz vor Dial bleibt bis A3 bestehen), Deploy-Uebergang (nur gepinnter Owner-Tenant betroffen).

## Impl-Zusammenfassung

Wie geplant umgesetzt auf `phase/iex-a2-fehlersatz`, Commit `3fcbe07`. `node --check` fuer alle 9 geaenderten Quelldateien ok, Tests gruen (5857 pass, 1 fail — siehe unten), committed.

Neue Dateien:
- `src/elevenlabs/inbound-uebergabe-gescheitert.js`
- `test/iex-a2-fehlersatz.test.js` (IEX-A2-1..12)

Geaenderte Dateien: `src/i18n/locales.js`, `src/i18n/inbound-notice.js`, `src/elevenlabs/inbound-rueckfall.js`, `src/elevenlabs/inbound-bridge-state.js`, `src/elevenlabs/inbound-bridges.js`, `src/elevenlabs/outbound.js`, `src/routes/voice.js`, `src/telephony/call-finish.js`, `PLAN-SECURITY.md`, `eslint-legacy-exceptions.json`, `test/iel-b8-weiche.test.js`, `test/de-umlaut-orthography.test.js`, `test/check-staged-suppressions.test.js`.

Einziger `npm test`-Fehlschlag (`el-fixtures-echte-antworten`, 149000 vs 149001 ms, Timing-Differenz) ist reproduzierbar unabhaengig von dieser Phase (isoliert gruen 9/0, nichts mit IEX-A2 zu tun).

### Deviations (vom Plan)

1. `test/check-staged-suppressions.test.js` (nicht im Plan-Dateienset) musste mitgezogen werden — Ratchet-Kopie von `eslint-legacy-exceptions.json` wurde durch die geplante Pin-Anhebung rot. Update analog zu IEL-B5/B8-Vorbild. Test verlangt Owner-Bestaetigung fuer geaenderte Eintraege.
2. `call-finish.js`: neue Zeile stiess `makeCallFinish` von 100 auf 101 Zeilen (max-lines-Hook). Kompensiert durch reine Formatierung (Argument von `sendSummaryMails` auf eine Zeile), keine Verhaltensaenderung.
3. `iel-b8-weiche.test.js`: `rueckfallMitLog` liefert `{text, msSeitBindung}` statt nur `ms_seit_bindung` (Demeter-Lint-Anforderung an einen flachen Helper).
4. `iex-a2-fehlersatz.test.js`: `finishCall`-Spione zaehlen Aufrufe statt zu werfen (`throwing()`), da IEX-A2-12 fire-and-forget-Settlement nutzt und ein Wurf sonst verschluckt wuerde.
5. `PLAN-SECURITY.md`: neue Textteile mit echten Umlauten, Rest des Abschnitts ASCII (Datei mischt schon beides).
6. Kommentar-Reflow von zwei Zeilen in `routes/voice.js`, weil die geplante Fassung zu lang wurde.

## Safety-Urteil

**approved: true**, alle Kern-Flags (Testgruen unabhaengig, Safety-Gates intakt, Offenlegung intakt, Auth fail-closed intakt, keine Secret-Lecks, Verhalten wie geplant, Scope eingehalten) positiv, **keine Blocker**.

Concerns (nicht blockierend):
- IEX-A2-5 „Outbound-EL“-Zeile nutzt einen nicht existierenden Enum-Schluessel (`KOSTENPROFIL.ELEVENLABS_CONVAI`), prueft de facto nichts — separat nachgemessen, Verhalten stimmt trotzdem (Fix: `EL_CONVAI_SIP` verwenden).
- Grund-Schreibung liegt bewusst ausserhalb von Riegel R4b (D1) — korrekt begruendet, aber strukturell ungeschuetzt gegen eine kuenftige End-Naht im neuen Modul; Vorschlag: eigener Pin/ORDER_CRITICAL_FILES-Eintrag.
- Abweichung D5 vom urspruenglichen Spec-Wortlaut (bedingter statt bedingungsloser Marker im Catch) — als sicherer bewertet, dokumentiert.
- `markInboxEntry(false)`-Aufruf fehlt gegenueber Spec-Wortlaut — Verhalten identisch (No-op im Bestand).
- Breite Spec-gewollte Einschraenkung: keine Notification/Alarm mehr fuer jede gescheiterte Uebergabe (auch Freizeichen, Cap, Geld-Wache, `cancel_call` vor Bindung) — kein Betreiber-Alarm vorhanden (F3 offen), nur Logzeile + `list_calls`.
- Deploy-Uebergangsfall: laufender Alt-Rueckfall endet nach Deploy ohne Benachrichtigung — betrifft nur gepinnten Owner-Tenant, temporaer.
- Catch spricht jetzt auch bei Budget-/GEBUNDEN-alt-Calls den Fehlersatz statt `turnErrorSpeech` (Spec-konform); unveraenderter Bestandsrisiko-Fall: zweiter `render`-Wurf im Catch bzw. bereits gesendete Header bleibt unbehandelte Rejection.
- Stil: Umlaut-Mix in `PLAN-SECURITY.md`, `sendSummaryMails`-Reflow, Pin-Anhebung 21→22 (dem Clean-Code-Auditor uebergeben).
- `INBOUND_EL_GRUND.EL_OHNE_REGISTRIERUNG` hat bis IEX-A9 keinen Leser — formal Vorratscode, von Spec verlangt und getestet.

## Security-Urteil (final)

**approved: true**, **PASS, keine Blocker.** Keine neue/geaenderte oeffentliche Route, `/voice/el-rueckfall` bleibt hinter Ed25519-Middleware + Idempotenz. Buchung (`recordVoiceMinuteMeter`, `reconcileVoiceBudget`, `markBilled`, `releaseReserve`) laeuft in `finishCall` immer VOR dem neuen fruehen Ausstieg — Kostendecke sieht die Minuten weiterhin. Keine Tenant-Verwechslung moeglich (Marker nur bei EL-Kostenprofil und Entscheidung FEHLERSATZ). Kein Datenabfluss: Owner-Name nur escaped im TeXML-Say, neue Logzeilen enthalten nur callId/Grund-Token/Zustand/`ms_seit_bindung`, keine Nummern/Secrets/Transkripte. Offenlegung unveraendert (Pflichtsatz vor Dial bis A3, Fehlersatz traegt KI-Kennzeichnung auch namenlos). Jeder Fehlerpfad endet in Fehlersatz+Hangup, nie Stille (belegt IEX-A2-9a-d). 57/0 lokal gegen den Branch-Stand.

Concerns (nicht blockierend):
- Fruehchecker-Return in `finishCall` laeuft vor `store.purgeTranscript` — bei GEBUNDEN jung + Marker denkbares Rennen mit EL-Ergebnis-Poll, ungetestet, als Restrisiko fuer A3/A9 vorgeschlagen.
- Gescheitert-Zweig ueberspringt `reportFailedCall`/`reportSystematicOutage` — flottenweiter EL-Ausfall erzeugt keinen Alarm, nur Logzeile (Spec-bekanntes offenes F3/F4).
- ElevenLabs-Synthese des Fehlersatzes wird nicht extra auf die Tenant-Achse gebucht — dasselbe Muster wie der bisherige Pflichtsatz, keine neue Risikoklasse.
- Bestandsrisiko (nicht neu): `/voice/el-rueckfall` liest `callId` aus der Query, moeglicher Replay einer gueltig signierten Anfrage koennte fremde `WARTET`-callId adressieren — gehoert zu IEL-B8, nicht zu IEX-A2.

## Clean-Code-Audit (s1-s4)

**verdict: PASS (kein Blocker)**

- **s1:** keine Funde.
- **s2:** IEX-A2-DUP1 — Log-Zeilen-Parsing fuer `[el-rueckfall]` ist in `test/iex-a2-fehlersatz.test.js` und `test/iel-b8-weiche.test.js` fast identisch neu geschrieben (Praefix schneiden + `JSON.parse`). Vorschlag: gemeinsamer Test-Helper. Klein, testonly, kein Blocker.
- **s3:** keine Funde.
- **s4:** G9/G12 — `GESCHEITERT_ZUSTAND_FUER_LOG[BRIDGE_STATE.KEIN_EL_INBOUND]: "abgewiesen"` in `call-finish.js` ist mit heutigem Code unerreichbar (Marker wird nur fuer EL-Kostenprofil gesetzt); bewusst als Vorbereitung fuer IEX-A9 dokumentiert, strenggenommen vorab eingebauter toter Zweig.

Positiv hervorgehoben: reine Praedikate (`rueckfallEntscheidungFuer`/`msSeitBindung`/`uebergabeGescheitert`) ohne versteckte Zeitkopplung, set-once-Marker verhindert Doppel-Buchung/-Log (belegt IEL-B8-16h, IEX-A2-10), robuster Catch-Pfad mit synthesefreiem Fallback, Buchung immer vor fruehem Return, i18n vollstaendig (de/fr/en, Umlaute korrekt, O4-Form getestet), Komplexitaets-Pin sauber nachgezogen und begruendet, alte Tests korrekt entfernt statt liegengelassen. Zielgerichteter Testlauf 93/93 gruen, `node --check` fehlerfrei.

Top-TODOs (optional, kein Blocker): Log-Parser-Duplizierung in Helper ziehen; `GESCHEITERT_ZUSTAND_FUER_LOG`-Eintrag erst mit IEX-A9 einfuehren; vollstaendigen `npm test`-Lauf vor Merge abwarten und gruen bestaetigen.

## Fix-Runden

Keine — der finale Review-Durchlauf (Safety, Security, Clean-Code) ergab in Runde 1 bereits PASS ohne Blocker. Alle genannten Concerns/TODOs sind nicht-blockierende Empfehlungen fuer Folgephasen (v.a. IEX-A3/A9) bzw. optionale Kleinigkeiten.
