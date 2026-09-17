# todo — Kette IEL: Inbound ueber den ElevenLabs-Agenten

Auftrag und Faktenbasis: `tasks/kickoff-inbound-wie-outbound.md` (gilt allein). Reihenfolge fest:
umstellen (Schalter) -> Owner-Testanruf -> ERST DANN Budget-Engine loeschen.

Owner-Freigaben 2026-09-14: Mess-Anrufe Maschine-zu-Maschine, per Allow-Regel fuer genau ein
Messskript (Rueckfall: Owner startet per `!`), hoechstens 5 Anrufe je <= 60 s. Owner arbeitet
nicht mit, testet am Ende. Scheitert Schritt 1 an Classifier/Push/Deploy: sofort stoppen, ein Satz
an den Owner, keine Ersatzarbeit.

## Gesamtergebnis (pruefbar)

- Schalter AN, Anruf auf die Owner-DID: Render-Log zeigt den ElevenLabs-Uebergabepfad statt
  `inbound_path {"path":"budget"}`; bei ElevenLabs existiert die Conversation; der Agent spricht
  NICHT den Outbound-Offenlegungssatz und bricht nicht mit 1008 ab. Owner-Urteil: klingt wie Outbound.
- Schalter AUS: Inbound-TeXML byte-identisch zu heute (Test).
- `npm test -- --test-concurrency=4`: `# fail 0`.

## Schritte

- [x] IEL-R1 Recherche Eroeffnung/Variablen/Zuordnung/Trunk-Auth -> `tasks/iel-r1-fakten.md`
- [x] IEL-R2 Paritaets-Inventar Budget-Inbound vs. EL-Outbound -> `tasks/iel-r2-inventar.md`
- [x] IEL-R4 Prompt/Werkzeuge am selben Agenten + Kosten-Paritaet -> `tasks/iel-r4-aufgabe-kosten.md`
- [x] IEL-R3 Messwerkzeug Maschine-zu-Maschine -> `scripts/iel-mess.mjs` (Dry-Run bestanden)
- [x] IEL-M1 Messung -> `tasks/iel-m1-messung.md`, Zaehler 5/5 (Anruf 1 Messaufbau-Fehler).
      Belegt: Dial/Sip erreicht Agent, Digest 407 ok, X-Header -> sip_*, Elternbein-Hangup beendet
      Bruecke, F-E ohne Nebenwirkung, allowed_numbers filtert Anrufer; unbekannte Kennung = Stille.
- [x] IEL-S Spec + Review (Security/Regeln opus, Clean-Code sonnet) -> `tasks/iel-spec.md` (5 Runden)
- [x] IEL-B1..B11 (13 Phasen) je Gate PASS, gemergt bis 9917db7; volle Bank 5838/5838 (concurrency 3).
- [x] IEL-D Cutover Schritte 0-10 (Protokoll `tasks/iel-cutover-protokoll.md`): live dep-dakes3h5efls73dp68p0,
      Banner "Inbound-EL: an, 1 Tenants" (…1188), beleg-init GRUEN; Prompt/Webhook/Agent-Schalter gesetzt;
      N1 (M7/M8) + N2 gemessen, Zaehler nachdeploy 2/3, Eintraege in PLAN-SECURITY.md (noch nicht committet).
- [ ] IEL-B* Bau je Phase per Workflow (Plan -> Impl -> Safety + Clean-Code + Security -> Self-Fix)
      Pruefung: Gate PASS, Lead `git diff --stat`, Merge, volle Suite einmal `# fail 0`.
- [ ] IEL-D Push upstream + Deploy + Schalter nur fuer den Owner-Tenant an
      Pruefung: Boot-Banner/Render-Log zeigt Commit und Schalter.
- [x] IEL-T Owner-Testanruf inbound + Outbound-Kontrolle 2026-09-15 bestanden, verifiziert (Protokoll).

## Folgekette IEX: Ein-Satz-Eroeffnung, Fehlersatz, Rollout, Budget-Engine loeschen

Owner-Entscheidungen 2026-09-15 (Chat, AskUserQuestion):
1. Eroeffnung wie Outbound: EIN fester Satz des Agenten ("KI-Assistent von <Name>" + KI-Hinweis +
   "Wie kann ich weiterhelfen?"), KEIN separater Pflichtsatz davor (ersetzt Kickoff 5.4 fuer Inbound).
2. Hinweis wahrheitsgemaess wie heute (KI + Aufzeichnung/Transkription; record_voice bleibt an).
3. Uebergabe scheitert: fester Satz ("KI-Assistent von <Name>, technischer Fehler, bitte spaeter erneut
   anrufen") und auflegen, OHNE Owner-Benachrichtigung. Budget-Engine ist dann kein Rueckfall mehr.
4. Inbound-Minutensatz fuer ALLE Tenants = Outbound-Satz (O10 entschieden).
Reihenfolge: Eroeffnung/Fehlersatz bauen -> Owner-Test -> Kosten-Join-Befund + Rollout alle Tenants
-> Budget-Engine in kleinen Phasen loeschen.

Owner-Entscheidungen 2026-09-15, zweite Runde: record_voice AUS (kein Code liest EL-Audio; retention
bleibt), Hinweis-Text unveraendert; Texte Eroeffnung/Fehlersatz de/en/fr freigegeben (Wortlaut in
tasks/iex-spec-a.md O1/O3); ohne Namen neutrale Form; Nummer ohne EL-Registrierung -> Fehlersatz,
auflegen, Anruf-Datensatz + Log, keine Benachrichtigung.

- [x] IEX-R Recherche -> tasks/iex-r1-eroeffnung.md, tasks/iex-r2-loeschung-rollout.md
- [ ] IEX-S Spec Teil A (Eroeffnung/Fehlersatz/Aufzeichnung/Kosten-Join/Tarif/Rollout) + Review laeuft;
      Spec Teil B (Loeschung D1-D6) erst nach Teil A live
- [ ] IEX-B Bau, Deploy Owner-Tenant, Owner-Test, Rollout, Loeschung
- [ ] IEL-X Budget-Engine entfernen — NICHT vor IEL-T.

## Owner-Test #2 durchgefallen (2026-09-15, call_mu34oz1l291b) + Forensik-Befund

Owner-Urteil: "absolute Katastrophe". Gehoert: englische Roboter-Ansage "call could not be
completed" mit Rauschen, dann Klingeln, dann Agent; Agent "duemmer", Stimme deutlich unter
Outbound. Outbound-Kontrollanruf danach gut. Notaus danach: dep-dakqph3l550s73ctfne0 (52530ce)
live, Banner "Inbound-EL: aus, 1 Tenants, scope=allowlist".

Forensik 2026-09-15/16 (vier lesende Agenten; Berichte im Scratchpad, Kurzfassung hier):
- Ansage: NICHT von uns. Telnyx sah genau EIN INVITE (20:32:41.815 UTC), keine Wiederholung,
  keine weiteren Inbound-Versuche auf …1188, und hat selbst kein Audio gespielt (list_call_events,
  detail_records). Owner hoerte die Ansage sofort nach dem Waehlen, also vor Telnyx. Owner war
  bei BEIDEN Tests im Ausland/Roaming (gleiches Netz) — Roaming trennt gut/schlecht also nicht.
  Luecke: SIP-Ladder am Telnyx-Eingang nur ueber Telnyx-Support.
- Klingeln: unsere Aenderung. IEX-A4 answerOnBridge=true (Konstante
  src/elevenlabs/inbound-rueckfall.js:35, KEIN Env-Schalter). Anrufer-Bein 1,56 s unbeantwortet,
  Freizeichen kommt aus dem Netz des Anrufers. Test #1 nahm sofort an (Play-TTS).
- Eroeffnung: byte-gleich zum freigegebenen O1-Wortlaut, nicht unterbrochen (169 Zeichen).
  Abweichung nur gegenueber Runde 1 ("EIN Satz") und gegenueber Outbound (Du-Form).
  callee_is_owner ist inbound f, outbound t.
- "Duemmer"/"Stimme": durch nichts Gemessenes erklaert. Zwischen #1 und #2 aenderte sich EL-seitig
  nur first_message; LLM/Prompt/Stimme/Sprache/TTS identisch; Telnyx-seitig gleiche Codecs,
  gleiche Transcodierung PCMU<->G722, gleiches data_center, MOS 4,50 in beiden.
  Kein Audio von #2 (record_voice=false) -> Hoervergleich unmoeglich.
- Struktureller Unterschied Inbound vs. Outbound (in BEIDEN Tests, nicht neu): Inbound hat keinen
  Kontext (objective/background/callee_relation leer), keine Werkzeuge (consult+lookup aus),
  tenant_token kommt LEER an; Outbound voll ausgestattet. Inbound-Bein G722 mit Transcodierung,
  Outbound PCMU ohne.

Owner-Entscheidungen 2026-09-16 (Chat, AskUserQuestion):
5. Besitzer-Erkennung bei INBOUND: ja. Ruft der Owner von seiner eigenen Nummer an, begruesst der
   Agent ihn wie im Outbound-Owner-Fall ("Hallo Antonio, hier ist dein KI-Assistent").
   KI-Kennzeichnung bleibt in JEDEM Fall. Ausdruecklich: die Erkennung schaltet KEINE privaten
   Daten frei — nur den Ton. Begruendung Owner-Gespraech: eine Anrufernummer ist faelschbar
   (schwaecherer Beleg als die selbst gewaehlte Nummer im Outbound-Fall nach CLAUDE.md Regel 2).
6. Naechster Schritt: Strategie-Workflow (mehrere Agenten, Pre-Mortem) -> Mehr-Phasen-Konzept,
   danach laeuft der Lead die Phasen autonom. Kein Owner-Test vor belegtem Fix.
7. Rufnummer ist KEIN Thema (Owner ausdruecklich, mehrfach): kein Nummernwechsel, kein Nummernkauf,
   keine +49-DID, auch nicht als Option. Dieselbe US-Nummer klingt im Outbound-Betrieb immer
   einwandfrei — der Unterschied liegt im EINGEHENDEN Weg.
8. Die Roboter-Ansage ist der WICHTIGSTE Punkt, nicht eine Randnotiz (Owner ausdruecklich): kein
   Anrufer darf je etwas anderes hoeren als Hermes. Fuehrende Hypothese (Owner + Datenlage): sie
   entsteht im Fenster, in dem wir den Anruf nicht annehmen (answerOnBridge=true, 1,56 s). Test #1
   nahm sofort an -> keine Ansage; Test #2 nicht -> Ansage. Erste Phase: sofort annehmen, plus
   maschineller Beweis (Anruf auf die eigene DID mit Mitschnitt der anrufenden Seite, vorher/nachher).
   Der alte TeXML-Pflichtsatz kommt NICHT zurueck (Entscheidung 1) — sofort annehmen UND mit der
   freigegebenen Agenten-Eroeffnung starten.

Owner-Entscheidungen 2026-09-16, zweite Runde (nach Strategie-Workflow, tasks/iep-strategie.md):
9. Eroeffnung INBOUND = Outbound-Form minus Anrufgrund, plus "Wie kann ich helfen?".
   Fremde: "Hallo, hier ist der KI-Assistent von <Name>. Das Gespraech wird transkribiert und
   zusammengefasst. Wie kann ich helfen?"
   Owner (erkannt): "Hallo <Vorname>, hier ist dein KI-Assistent. Das Gespraech wird transkribiert
   und zusammengefasst. Wie kann ich helfen?"
   Ausdruecklich WEG: "Hinweis:", "Sie sprechen mit einer KI", Sie-Form, der Dreisatz-Aufbau O1.
   KI-Kennzeichnung traegt "KI-Assistent" im ersten Satz. Owner sagte "bearbeitet", gebaut wird
   "zusammengefasst" (Systemsprache); Owner kann korrigieren.
10. Erste Sekunde nach der Annahme: kurzer Begruessungslaut (nicht Stille, nicht Dauerton).
11. Maschinen-Messanrufe auf die eigene Nummer: 18 freigegeben, harter Deckel, je <= 60 s,
    SMS im Messfenster aus, Muell-Eintraege danach aufraeumen. Owner-Testanruf-Reserve (1) unberuehrt.
12. IEP-P0 macht der Owner selbst: 5-10 Waehlversuche mit Sprachmemo, auflegen sobald der Agent
    spricht. Klaert, ob die Ansage vor dem Klingeln kommt und ob sie immer kommt.
13. Uebernommen ohne Rueckfrage (Vorschlaege aus iep-strategie.md): F3 Schalter kurz an fuer die
    Vorher-Messung; F5 Telnyx-Auskunft zu Test #2 als Nebenspur ohne Blockwirkung; F6 Standard-
    Kontext ohne Rufnummern/Kalender/Kundendaten; F8 Transkriptions-Hinweis bleibt; F9 Abnahme-
    kriterien wie vorgeschlagen; F10a Alarm bei gescheiterter Uebergabe als eigene Phase vor dem
    Rollout, F10b keine Benachrichtigung bei Auflegen in der Wartephase.

Owner-Entscheidungen 2026-09-17 (nach bestandenem Testanruf):
14. Die Messmaschine ("Ohrzeuge", IEP-P1/P1b) wird restlos entfernt — ein Owner-Anruf ist der
    bessere Messweg. "Ich habe keine Lust auf totes Gewicht."
15. Zusammenfassungs-SMS bleibt AUS (steht fuer den Owner-Tenant auf false). Beim Rollout keine
    SMS-Welle ausloesen.
16. Reihenfolge danach: Messmaschine raus -> Inbound fuer ALLE Kunden -> Budget-Engine loeschen.
    Uebergabe an die naechste Sitzung: tasks/kickoff-iep-abschluss.md.

- [x] IEP Strategie-Workflow Inbound-Paritaet -> tasks/iep-strategie.md (12 Agenten, 11 Blocker geloest)
- [x] IEP-P0 Delta-Analyse der 39 Dateien: hoerbar waren answerOnBridge (Klingeln) und die
      getauschte Eroeffnungsquelle; fuer "duemmer im Gespraech" gab der Diff nichts her.
- [x] IEP-P2 Sofortannahme + Begruessungslaut, IEP-P6 Eroeffnung im Owner-Wortlaut + Owner-Ton,
      IEP-P2c Laut aus ElevenLabs-Soundeffekt. Live seit 648f690.
- [x] IEP-T Owner-Testanruf 2026-09-17 BESTANDEN ("funktioniert alles"): keine Roboteransage,
      kein Klingeln, Ton und Eroeffnung abgenommen, Inbound klingt wie Outbound.
- [ ] IEP-A Messmaschine restlos entfernen (Entscheidung 14)
- [ ] IEX-B Inbound fuer alle Kunden freischalten (Runbook iex-spec-a.md §7 b)
- [ ] IEL-X Budget-Engine entfernen — erst nach dem Rollout
