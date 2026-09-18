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

Owner-Entscheidungen 2026-09-17, dritte Runde (Abschluss-Auftrag, tasks/kickoff-iep-abschluss.md):
17. Rollout-Umfang: ALLE drei aktiven DIDs, einschliesslich der Kundennummer des
    Fremd-Tenants t_user_01KZRNWDJA5MW3C206CK5992W6 (+15804504874). Verworfen: "nur unsere zwei" und "erst den Kunden fragen" -
    beide haetten einen Fremdkunden auf der Budget-Engine gelassen und Paket C blockiert.
18. Zweiter Bestaetigungsanruf (Runbook b6 / Messung M-B.d) auf +18643028341 (owner-Tenant),
    NICHT auf die Kundennummer.

Stand der drei Arbeitspakete (Lead, Belege am lebenden System):
- Boot-Banner letzter Deploy 2026-09-17T17:29Z: "Inbound-EL: an, 1 Tenants, scope=allowlist".
- Aktive DIDs laut Prod-DB: +18643028341 (owner), +17067101188 (Owner-Tenant, business,
  EL-Trunk belegt seit 15.09.), +15804504874 (Fremd-Tenant, business).
  Nur EINE von drei ist bei ElevenLabs registriert - die beiden anderen bekommen ihre
  Registrierung in Rollout-Schritt b3.
- Der Betreiber-Alarm aus Entscheidung 13 (F10a) existiert NICHT: outage-detection.js zaehlt
  ausschliesslich direction==="outbound". Er ist damit belegte Vorbedingung des Rollouts.

- [ ] IEP-A Messmaschine restlos entfernen (Entscheidung 14)
      Spec: tasks/iep-abschluss-spec.md | Erwartetes Ergebnis: npm test gruen,
      "node scripts/iel-mess.mjs status" Exit 0 ohne Gruppe ohrzeuge, "grep -ril ohrzeuge
      src scripts test" ohne Treffer, "git diff --stat master..HEAD -- src/" leer.
- [ ] IEX-B1 Betreiber-Alarm fuer gescheiterte Inbound-Uebergaben (Entscheidung 13/F10a)
      Spec: tasks/iex-b-spec.md | Erwartetes Ergebnis: npm test gruen, Bestandstests zu
      outage-detection/outage-report im Diff UNVERAENDERT, ein Test belegt Alarm bei lauter
      gescheiterten Uebergaben MIT gesetztem answeredAt (der blinde-Alarm-Fall).
- [ ] IEX-B2 Rollout am lebenden System (Runbook tasks/iex-spec-a.md §7 b, Schritte b1-b7)
      Erwartetes Ergebnis: Boot-Banner "scope=registrierte_dids", Ergebniszeile E11 mit
      unbekannt=0/abweichung=0 und leerer Liste ohne_beleg_endungen, Owner-Regressionsanruf
      plus zweiter Anruf auf +18643028341 gruen.
- [ ] IEL-X Budget-Engine entfernen - erst nach IEX-B2 (Spec Teil B D1-D6,
      tasks/iex-r2-loeschung-rollout.md)

Vorbefunde Paket C (Budget-Engine loeschen), gelesen in tasks/iex-r2-loeschung-rollout.md A0/A2/A3:
- Der Phasenschnitt A3 ist teilweise ueberholt: L1 (Uebergabe-Fehler = Satz + Hangup) und R1
  (Registrierung je DID + Weiche) sind durch die gemergte IEX-A-Kette (A2/A9/A10/A11) bereits
  gebaut. R2 ist Paket B. Fuer Paket C bleiben D1-D6.
- D2 haengt ausdruecklich an R2 - das ist der Grund, warum der Rollout vor der Loeschung steht.
- ZWEI Punkte brauchen eine Owner-Entscheidung, BEVOR C sie beruehrt:
  (1) CLAUDE.md Regel 2 nennt das Symbol claude.js#disclosureSentence. Es hat auf dem EL-Pfad
      keinen Leser mehr (EL liest locale.disclosure aus call-locale.js). Entweder CLAUDE.md
      zeigt kuenftig auf LOCALES.<lang>.disclosure, oder disclosureSentence bleibt als EINE
      Quelle fuer call-locale.js erhalten. Still loeschen ist ausgeschlossen.
  (2) Mit dem Turn entfaellt die Mid-Call-Decke fuer LLM-Token (claude.js#roundStopReason).
      EL-Token werden erst im Nachlauf gebucht; waehrend des Gespraechs deckelt dann nur noch
      die minutenbasierte Geld-Wache. CLAUDE.md Regel 1 begruendet die Inbound-Sperre genau mit
      der laufenden Token-Buchung - der Wegfall ist eine bewusste Entscheidung, keine Nebenwirkung.

Rollout IEX-B2 DURCHGEFUEHRT 2026-09-18 (Runbook iex-spec-a.md 7 b), alle Lesebelege gruen:
- b1 Push ff180c0..d054c95 + Deploy dep-dambtotbedkc73aqmro0; Banner scope=allowlist,
  Sweep aktiv=3 belegt=1 ohne_beleg_endungen=…4874,…8341; BELEG-INIT GRUEN.
- b2 Trunk-Inventar GRUEN, 0 offen, je DID genau eine Registrierung.
- b3 setzen ueber alle drei Registrierungen mit --ausfuehren: je Registrierung
  has_auth_credentials ja, username gleich ja, allowed_numbers [DID] ja,
  outbound_trunk unveraendert ja; Inventar abschliessend GRUEN.
- b4 Deploy dep-damc0f5bedkc73ar4lp0; Sweep aktiv=3 belegt=3 repariert=0 abweichung=0
  unbekannt=0 ohne_registrierung=0, ohne_beleg_endungen leer; BELEG-INIT GRUEN.
- b5 scope --registrierte-dids --ausfuehren (PUT 200) + Deploy dep-damc29h42hec738gkfug;
  Banner "Inbound-EL: an, scope=registrierte_dids", Sweep unveraendert gruen, keine Drosselung.
- b6 Owner-Testanrufe GRUEN. …1188 (conv_9501m2sv9zyferavns5zmm06y8qb, 12 s): Agent-Sprache de,
  erste Zeile woertlich "Hallo Antonio, hier ist dein KI-Assistent. Das Gespraech wird
  transkribiert und zusammengefasst. Wie kann ich helfen?", unterbrochen=false.
  …8341 (conv_3501m2sv1qvkfbwrz6py49f77fks, 17 s): Fremd-Eroeffnung vollstaendig,
  unterbrochen=false. Damit ist M-B.d POSITIV: Telnyx akzeptiert die zweite Tenant-DID als
  Absender, ElevenLabs bindet sie.
- Ein frueherer Beleg zeigte unterbrochen=ja; Ursache war ein 4-Sekunden-Anruf des Owners
  (Bindung allein 1,6 s), nicht der Agent. Kein Offenlegungs-ROT.

Owner-Entscheidungen 2026-09-18:
19. settings.language='fr' beim Business-Tenant war ABSICHT (Owner hat im Dashboard
    umgestellt, um zu pruefen, ob der Sprachwechsel noch funktioniert - er funktioniert).
    KEIN Defekt, nicht "reparieren". Steht inzwischen wieder auf de.
20. Der SMS-Alarmkanal wird NICHT angefasst. Befund bleibt offen (s. unten).

Offene Punkte nach dem Rollout:
- [ ] b7: 24-h-Beobachtung. Heute 1 von 6 Uebergaben gescheitert (call_mu6os3efopwh,
      08:18:18, …8341, el_uebergabe_gescheitert). Der neue Alarm hat korrekt NICHT
      ausgeloest (zwei gelungene Uebergaben im Fenster).
- [ ] SMS-Alarmabsender kaputt: die als alert_sms_sender gebundene +18643028341 wird von
      Telnyx mit HTTP 400 / 40305 "Invalid 'from' address" abgelehnt - stuendlich, seit
      mindestens 7 Tagen. Mail (Brevo) traegt den Alarm, der Kanal ist also nicht blind.
      Der Kanal selbst ist NICHT tot: outbound-gates.js sendet mit dem Anruf-Absender.
      Kleinster Fix waere eine SMS-faehige DID als Bindung oder Messaging auf …8341.
      ACHTUNG beim Entfernen: die Budget-Fruehwarnung in outbound-gates.js ist die einzige
      Alarmstelle OHNE Mail-Zweig und wuerde ersatzlos verstummen.
- [ ] Schwellen des Inbound-Alarms sind eine Annahme ohne Verkehrsdaten - zwei Wochen nach
      dem Rollout aus der Prod-DB nachziehen (GEBUNDEN vs. RUECKFALL je Woche), reine
      Env-Aenderung.
- [ ] Fremd-Eroeffnung nennt den vollen Namen ("Antonio Fotiadis dos Santos Francisco").
      Funktional korrekt, am Telefon lang - Owner-Entscheidung, keine Bauarbeit.
- [ ] settings.greeting traegt noch den abgeschafften Wortlaut ("Please note: you are
      speaking to an AI...") auf Englisch. Auf dem EL-Pfad ungenutzt; gelesen nur vom
      Budget-Rueckfall (routes/voice.js#gespeicherteBegruessungDes). Loest sich mit
      Paket C / D2 auf - JETZT leeren wuerde den Rueckfallpfad werfen lassen.
