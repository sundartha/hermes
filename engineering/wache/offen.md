- 07.11. 18:2x VORRANG: #3279 ohne Schutzsatz sensible Mandate gemergt (#3280, master grep = 0). Nächstes Häppchen: Satz in PLACE_CALL_DESCRIPTION + Test + Doku, Closes #3280; vorher kein Deploy. (Nachricht an Hauptsitzung scheiterte: Gateway geschlossen.)
- 07.11. 21:5x #3298 zweimal gleich rot (heilung-und-sweep-einmal.test.js:110/111, Überspringen 0 statt 1) → Grenze 2 Rückläufe, angehalten; Auftrag geschärft im PR-Kommentar (Überlappung im Test erzwingen). Rücknahme: entfällt.
- 07.11. 22:5x #2653 entschieden (Kommentar): SUSPEND nur bei Ereignis zum aktuellen Abo (tenantHoldsSubscription), ohne Referenz wie bisher; Bau nach Merge #2253. Für Antonio offen: verwaistes zweites Abo bei subscription_conflict bucht bei Stripe weiter (Geldfrage).
- 08.11. 06:3x Erste Messung neue Mutation (#3320) an #3346: 6 Jobs 21–24 min (Ziel ≤10), alle rot wegen überlebender Mutanten ohne Begründung (z. B. stripe-webhook.js:46). Prüfung wirkt, Laufzeit 2× über Ziel → Zeitaufteilung je Mutant messen.
- 08.11. 07:3x ERLEDIGT: #3280 durch #3336 gemergt (08.11. 02:33), Satz auf master wieder da (grep = 1). Meine Vorrang-Meldungen 03:04–07:08 waren veraltet.
- 08.11. 09:4x Mutation ≤10 min: Ursache belegt (636 'erreichende' Testdateien per Import, Frist je Job statt je Mutant) → Issue #3367 (Auswahl per V8-Abdeckung, Frist je Mutant). Hauptsitzung: als nächstes Werkzeug-Häppchen bauen.
- 08.11. 10:1x #3366: 22/22 Mutanten 'nicht geprüft (Frist)', 6×21 min → #3367 kritischer Pfad, vor alles andere.
- 08.11. 17:1x Mutation ≤10: nach #3437/#3421 an #3420 19/20 Jobs 2,6–7,3 min; 1 Ausreißer 21,3 min (Frist je Job, 9 Mutanten ungeprüft) → nur noch #3367 fehlt fürs Ziel.
- 08.11. 19:1x #3460 (web-auth.js): 9 von 10 Mutations-Jobs 20,8–21,4 min, je 1 Überlebender (StringLiteral) verbraucht Frist → #3367 dringend, kommentiert.

## Wache 08.11. 20:12
- #3469 (zweimal "aus der Warteschlange gefallen" 18:49/19:02) und #3460 sind inzwischen gemergt (19:11 / 18:54). Wache-Meldung wieder irreführend. #3460 mit web-auth.js-Überlebendem: Mutationsdauer bei nächstem Produkt-PR messen.
- #3367 weiter ohne PR (kritischer Pfad für Mutation <= 10 min).
- #3470: Testschutz rot (üblich bis Urteil + Label), dazu "Tests Node 26 4/6" rot; Lauf 42513778401 läuft noch, Log noch nicht lesbar. Bei Ende prüfen, ob Flake.
- #3494 rot nur Freigabe-Prüfung (üblich). Review-Anfragen #3494/#3495/#3498 gehen an Betreuung/Antonio. Issues #3487–#3493, #3500 (Widget W1–W5, Ausgehende Eröffnung): von Antonio20045 angelegt, betreffen mich nicht.

## Wache 08.11. 20:43
- Messung Mutation: #3498 Jobs 3–15 min, 5/8 rot 21,4 min; #3504 Überlebender-Jobs 11,6/12,9 min (vorher ~21). Auf #3367 kommentiert; weiter kein PR dafür.
- #3496 gemergt 19:40 (Wache-"gefallen"-Meldung wieder falsch). #3498/#3496/#3501 grün. #3504/#3470 Testschutz rot (üblich); #3504 zusätzlich Tests 1/6, Node 26 1/6, Mutation 5/5 (Überlebender anruf-lesen.js:26/4 braucht Test oder PR-Text-Zeile) – Sache des Bau-Agenten/Prüfers.
- Issues #3505/#3506/#3507 (Folgen aus Urteilen) und Test-Issues #3508/#3509 (Rechteprobe, schließen sich selbst) betreffen mich nicht. Review-Anfragen #3501/#3502/#3510 gehen an Betreuung.

## Wache 08.11. 21:14
- CodeQL #88/#89 auf PR #3519 (startsWith in Test-Fetch-Attrappe, .invalid-Hosts): Falschmeldung, mit Antwort-Kommentaren beantwortet; Schließen bei Antonio/Jonas.
- Messung Mutation #3501 (15 Teile, alle grün): längster Job 6,3 min, Median ~4,5 min – erster Lauf unter 10 min ohne Überlebende. #3367 weiter ohne PR.
- #3501/#3498/#3503 grün bzw. Node-26-/Mutation-Rot war Wiederholung; #3518 Testschutz rot (üblich). Rechteproben-Issues #3511–#3514 und #3520/#3521 betreffen mich nicht.

## Wache 08.11. 21:45
- #3503 aus Warteschlange gefallen 20:19, jetzt offen und grün (vermutlich Flake/neuer Kopf) – Betreuung stellt neu ein. #3534 Mutation 1/2 8,5 min, 2/2 läuft. #3470/#3519/#3504 grün; #3518 Testschutz rot (üblich); #3535 Node 26 2/6 rot (Lauf prüfen, falls bleibt).
- #3522/#3528 (npm run pruefen lokal nur Teilsatz): schrumpft Last, keine neue Prüfung – ok. Review-Anfragen #3524/#3525/#3536 an Betreuung. #3367 weiter ohne PR.

## Wache 08.11. 22:16
- #3537 (17 Teile): 14 Jobs ≤ 5,8 min, Überlebenden-Jobs 4/17 14,3 und 5/17 16,4 min rot (Mutanten brauchen Test oder PR-Textzeile). Auf #3367 kommentiert.
- #3519 gemergt 21:06 (Wache "gefallen" falsch). #3470/#3535/#3518 grün; #3534 rot nur Testschutz+Freigabe (üblich). #3544 Tests 2/6 rot – Wiederholung abwarten. Issues #3539–#3547 betreffen mich nicht (Prüfer-/Folgen-Issues; #3540/#3541 sind Flakes der Tests, Sache der Bau-Agenten).

## Wache 08.11. 22:47
- #3534: Prüfungen (gitleaks 1 Fund, vermutlich SECRET-Konstante in neuem Test) und Rotprobe (neuer Test schon ohne src-Änderung grün) rot – auf PR kommentiert, Lösung ohne Ausnahme/Lockerung. #3537/#3470/#3545/#3548 grün. Issues #3549/#3550 Folgen aus #3522/#3528, nicht meine.

## Wache 08.11. 23:17
- #3544: Mutation 3/7 rot (Überlebender exa-search.js:8/9 StringLiteral), Job 15,5 min, übrige ≤ 7,5; auf #3367 kommentiert (3. Fall nach #3504/#3537). #3537/#3545 jetzt grün; #3545 22:12 aus Warteschlange gefallen (offen, grün: Betreuung stellt neu ein). #3534 weiter rot (Prüfungen+Rotprobe, siehe Kommentar 22:47). #3518 Testschutz (üblich). Issues #3551/#3552 nicht meine.

## Wache 08.11. 23:48
- #3545: dreimal in der Warteschlange gefallen (22:07/22:30/22:43) wegen neuem Test widget-anruffolge-messen.test.js:94 (lastabhängig); auf PR kommentiert. #3537 gemergt 22:39 (nach 2 Wiederholungen), #3518 gemergt, #3544 grün (Freigabe war nur fehlend). #3553 nicht meine. Kein Mutations-Messwert dieses Mal.

## Wache 09.11. 00:18
- #3545 gemergt (nach 4. Warteschlangen-Anlauf), #3557 gemergt. #3554: Prüfungen rot an Schritt "Architektur (dependency-cruiser)" (Lauf 42534427726), Log noch nicht lesbar (Lauf läuft); Testschutz üblich. Nächsten Wecker prüfen, ob Rot bleibt. Issues #3558/#3559 und Review-Anfragen #3555/#3556 nicht meine. Kein Mutations-Messwert.

## Wache 09.11. 00:49
- #3554: neuer Lauf 42536523371, Prüfungen jetzt rot an "Secret-Scan (gitleaks)" (vorher Architektur, offenbar behoben); Fund geschwärzt, Log erst nach Laufende lesbar; Diff zeigt keinen eindeutigen Kandidaten (nur TELNYX_API_KEY="KEYtest-3365-bruecke", ähnlich wie bei #3519 grün). Beim nächsten Wecken Log lesen, nicht raten. #3560/#3561/#3563 Testschutz (üblich), #3560 auch Freigabe-Prüfung. Review #3562 nicht meine. Kein Mutations-Messwert.

## Wache 09.11. 01:19
- WICHTIGE MESSUNG: #3470 (src/store, 20 Teile, Lauf 42536403407): Jobs 6,9–22,6 min, Median ~15, 5–6 Jobs rot "nicht geprüft (Frist)" (kein Überlebender, Frist reißt). Zentrale Module => fast alle Tests erreichen => #3367 zwingend. Auf #3367 kommentiert. Neuer Lauf 42538810032 (b76fcb33) läuft.
- #3554 grün. #3534/#3470 Tests Node 26 2/6 rot (bekannte Node-26-Instabilität, #3540). Issues #3564–#3570 Folgen aus #3562, nicht meine.

## Wache 09.11. 01:49
- #3470 zweiter Lauf 42538810032: 8/20 Mutation-Jobs rot (Frist 21 min), Rest 10,7–21,2 min. PR blockiert ohne #3367. Hauptsitzung per sessions_send(notify) benachrichtigt (queued), Kommentar auf #3367. #3534/#3544/#3573 grün. #3576 Freigabe fehlt (üblich). Issues #3571/#3574/#3575 nicht meine.

## Wache 09.11. 02:19
- #3577 (H1 von #3492, Flügel): Mutation 1–3/3 rot (Überlebende wing-canvas-engine.js:485–487 → Test fehlt), Tests 5/6 (gepinnte Widget-Sollwerte, p8-widget-ui) rot, Rotprobe nennt fremde Datei abo-plan-ohne-preis.test.js (gehört zu #3534) – vermutlich Basis veraltet, evtl. Fehler in Rotprobe-Auswahl; auf PR kommentiert. Wenn nach Rebase gleiche Meldung: Issue anlegen.
- #3544 gemergt 01:18 (Wache "gefallen" falsch). #3560 Node 26 5/6 rot = bekannte widget-anruffolge-messen-Instabilität (#3578). Mutationsdauer #3470: siehe 01:49, #3367 weiter ohne PR.

## Wache 09.11. 02:50
- #3576 (Vorspann 3b, 20 Teile): Jobs 5,3–12,4 min (Median ~8), Teile 8/11/13/14 rot nach 20–23 min (Überlebender vorspann-bruecke.js:53/67, 5 von 6 getötet); auf #3367 kommentiert. #3470 weiter rot (8/20). #3563 Tests 6/6: ie7-play-tts-streaming.test.js:188 (Zeitverhalten, lastabhängig) – Wiederholung abwarten. #3534 grün. Issues #3580/#3582 nicht meine. #3367 weiter ohne PR.

## Wache 09.11. 03:20
- CodeQL #90 auf PR #3585 (Regex <script> in Test, liest eigenes call.html): Falschmeldung, mit Antwort beantwortet; Schließen bei Antonio/Jonas. #3534 gemergt 02:03 (Wache "gefallen" falsch). #3583 grün; #3585/#3576 rot nur Testschutz/Freigabe (üblich). Kein neuer Mutations-Messwert; #3367 weiter ohne PR.

## Wache 09.11. 03:51
- #3589 (Antonio20045): Mutationswerkzeug zählt eingebettete Browser-Skripte (wing-canvas-engine.js) als "0 Testdateien erreichen den Code". Meine Aussage auf #3577 ("Test fehlt") war damit falsch; auf #3585 berichtigt. #3589 und #3367 betreffen dieselbe Zuordnung Mutant→Test in tools/pruefen.mjs: gemeinsam lösen. #3587 (3b, 20 Teile): 17 Jobs 5,7–10,4 min, 12/20 rot. #3560 geschlossen (ersetzt von #3585/#3588?). #3586/#3585 Testschutz (üblich).

## Wache 09.11. 04:21
- #3592 (löst #3589): Diff gelesen – schmal (EINBETTUNG-Regex auf new URL("./x.js", import.meta.url) in src/, leerer Lauf klar gemeldet, TEIL/TEILE mit Default); kein Zusatz an Prüfungen, Tests grün, keine Bedenken. Beschleunigt die Mutation nicht, #3367 bleibt nötig. #3586 aus Warteschlange gefallen 03:11, offen, nur Testschutz rot (Betreuung stellt neu ein).

## Wache 09.11. 04:52
- #3593 (Ausweg-Text: vm-Sandbox braucht process) und #3594 (CLAUDE.md Mutation nennt Einbettung) eingeordnet: nur als Ersatz/Erkennung, keine längeren Texte; Kommentare gesetzt. #3586 gemergt. #3587 Tests 4/6 rot (Log noch nicht gelesen; nächster Wecker). #3367 weiter ohne PR.

## Wache 09.11. 05:23
- #3587 grün. #3597 (CLAUDE.md Absolute Regel 2, Reihenfolge Offenlegung nach #3488/#3591): Owner-Entscheidung von Antonio, nicht meine; wenn eingetragen, Satz ersetzen statt anhängen. #3595/#3596 Folge-Issues, nicht meine. Kein Mutations-Messwert; #3367 weiter ohne PR.

## Wache 09.11. 05:53
- #3587/#3585 rot nur Testschutz (üblich bis Urteil + Label). #3599 Folge-Issue aus #3598, nicht meine. Kein Mutations-Messwert; #3367 weiter ohne PR.

## Wache 09.11. 06:24
- #3602/#3604 (eingebettete Skripte eng zuordnen + Stryker-Schalter in vm-Sandbox): +156/-10 Zeilen in pruefen.mjs/Test, Textheuristik + fs.readFileSync-Patch via --import; überschneidet sich mit #3367 (Ausführungsabdeckung). Auf PR hingewiesen, keine Blockade. #3587 grün, aber 05:19 aus Warteschlange gefallen (offen, nur Testschutz bei #3585/#3601 üblich). Issue #3603 nicht meine. #3367 weiter ohne PR.

## Wache 09.11. 06:55
- #3607 (Test für NODE_OPTIONS-Zusammenführen, Folge aus #3604): Folge-Issue des Bau-Weges, nicht meine Sache. Kein Mutations-Messwert; #3367 weiter ohne PR.

## Wache 09.11. 07:25
- #3606 (10 Teile): 8 Jobs 1,9–3,5 min; 5/10 14,6 min (Überlebender begründet), 6/10 rot 10,7 min (Überlebender vorspann-ablauf.js:81/25 ohne Begründung → Test nötig). Auf #3367 kommentiert. #3606/#3608 Testschutz (üblich). #3367 weiter ohne PR.

## Wache 09.11. 08:45
- #3608 rot nur Testschutz + Freigabe-Prüfung (üblich bis Urteil, Label, Approve). Nichts zu tun. #3367 weiter ohne PR.

## Wache 09.11. 09:15
- #3606: Prüfungen rot = gitleaks-Download 504 (GitHub-Ausfall, kein Code); Tests 1/6 + Node 26 1/6 rot = widget-anruffolge-messen.test.js:94 (bekannte Instabilität, #3578). Fehlgeschlagene Jobs im Lauf 42581716398 neu gestartet. #3367 weiter ohne PR.

## Wache 09.11. 09:46
- #3608 rot nur Testschutz (üblich bis Urteil + Label). Nichts zu tun. #3367 weiter ohne PR.

## Wache 09.11. 10:22
- #3606 und #3588 grün. Nichts zu tun. #3367 weiter ohne PR.

## Wache 09.11. 10:53
- #3611: zwei konkurrierende PRs. #3612 (Mutation vorab auf GitHub als Workflow, netto −1 Zeile) vs #3614 (lokal, 4 Stryker-Prozesse auf dem Mac, +161 netto) – #3614 widerspricht "Schweres nur in der CI"/Schrumpfen; auf #3614 kommentiert, #3612 empfohlen. Check-Namen ändern sich zu "Mutation / n/m" (meine Wache-Skripte nutzen startswith("Mutation"), ok). #3610 Testschutz (üblich), #3615 Prüfer-Folge, nicht meine. #3367 weiter ohne PR.

## Wache 09.11. 11:23
- #3617 = PR für #3367 (+194/−27, pruefen.mjs +62 netto): schneller Anfang 50 Dateien, dann V8-Abdeckungslauf der übrigen erreichenden Tests (in jedem Job einzeln!), zweite Runde nur deckende Tests mit 5 min je Mutant. Auf PR kommentiert: Kosten des Abdeckungslaufs unbeziffert, Abnahme an #3470/#3606/#3576 messen, Ziel kein Job > 10 min. NÄCHSTER SCHRITT nach Merge: Mutation-Läufe messen. #3620 Tests 2/6,4/6 rot/grün gewechselt (Wiederholungen, Flake). #3606 grün.

## Wache 09.11. 11:54
- #3617 noch offen (grün, keine Antwort auf meinen Kommentar). #3623 (bau.md ±1 Zeile, löst #3625) unauffällig. #3588 Tests 5/6 rot→grün (Wiederholung). Issues #3624/#3626 nicht meine. Nach Merge #3617: Mutation messen.

## Wache 09.11. 12:24
- #3588 gemergt 11:20 nach zwei Warteschlangen-Anläufen (10:47, 10:58 rot); Wache-Meldung "gefallen" veraltet. Nichts zu tun. #3617 Stand siehe 11:54.
- Ursache der zwei Abbrüche von #3588: test/iel-b8-weiche.test.js:498 und :502 (IEL-B8-16d/e "GEBUNDEN jung + frist/dial_ende") – zeitabhängig ("jung"), beide Male identisch, danach grün. Zweiter lastabhängiger Warteschlangen-Flake neben widget-anruffolge-messen; bei Wiederholung Issue anlegen.

## Wache 09.11. 12:55
- #3627 (Fenstergrenze-Test): eigener neuer Test rot auf Node 22+26 (Metrik 432 vs Trace 426, zeitabhängig); auf PR kommentiert (Zeitstempel statt Zähler). #3620 Testschutz/Freigabe (üblich). #3617 weiter offen. 

## Wache 09.11. 13:26
- #3627: "Tests Node 26 3/6" war rot, beim Nachsehen keine roten Checks mehr (Wiederholung). Nichts zu tun. #3617 Stand beim nächsten Wecken prüfen.

## Wache 09.11. 13:57
- #3628 Tests 2/6 + Node 26 2/6 rot, beim Nachsehen Lauf neu (Wiederholung); #3620/#3631 Testschutz (üblich); #3632 Review-Anfrage Betreuung; #3630 Folge-Issue. #3617 weiter offen.
- #3617: Messung des Bau-Agenten: #3364 längster Job 16,5 → 6,2 min (gleiches Urteil), #3346 3,8 → 4,2 min. Prüfer-FAIL (MUSS: Server-Abdeckung) vom Bau-Agenten widerlegt; ich habe lokal bestätigt, dass NODE_V8_COVERAGE auch in Kinder mit frischer env geht (Node 24). Auf PR kommentiert: Node-22-Bestätigung im CI-Log + zügig mergen. Zusagen offen: SIGKILL-Kinder, Query in URLs; #3632 (kindUmgebung) hängt damit zusammen.

## Wache 09.11. 14:27
- #3617: zweites Urteil liegt offenbar vor (SOLLTE-Folgen #3634–#3637); PR offen, nur Testschutz rot (Label ausstehend), Merge steht bevor. Danach Mutation an nächsten PRs mit src/ messen (Ziel kein Job > 10 min; Bau-Agent maß #3364: 16,5 → 6,2 min). #3628 mehrere Test-Röte (Tests 4/6, 6/6, Node 26 3/6) laufen neu, Wiederholungen; #3633 grün, aus Warteschlange 13:18 gefallen (offen). #3631 Testschutz üblich.

## Wache 09.11. 14:57
- #3628 (Vorspann Fristen 3b-2b): neuer Kopf 3427a4f2, Tests 3/6 + Node 26 3/6 rot (Lauf 42627939297, Log noch nicht lesbar); vorher 2/6, 4/6, 6/6 mit wechselnden Shards – wiederkehrend, evtl. eigener neuer Zeittest im PR. Beim nächsten Wecken Log lesen, wenn weiter rot. #3617 Stand prüfen.

## Wache 09.11. 15:28
- #3617 GEMERGT 13:29. Erste Messung am echten PR #3628 (15 Teile): 14 Jobs 6,0–8,7 min (Median ~7,5), Teil 3/15 rot 15,7 min (config.js:423 nicht geprüft/Frist, Zeile von fast allen Tests ausgeführt). Auf #3367 kommentiert. Ziel im Regelfall erreicht; Rest = zentrale Zeile + Überlebender. Weiter messen.
- #3633 aus Warteschlange 13:12 + 14:16 wegen nummerntausch-absender.test.js:150 und widget-ladezeit.test.js:34 (bekannte Flake-Familie, #3541); offen, grün. Issue #3638 (kindUmgebung) Folge aus #3617/#3632, nicht meine.

## Wache 09.11. 15:59
- #3628 neuer Lauf 42636312241 (läuft noch, Logs unlesbar): Mutation-Jobs 4,9–8,7 min (Median ~7), aber 1/15 rot 21,1 min, 2/15 16,3 min, 4/15 14,1 min. Wieder Überlebender/Frist vermutet; nach Laufende Log lesen (Zeile "Abdeckungslauf" und Überlebende) und Messung auf #3367 nachtragen. #3639 (Zeittests an der Wurzel) = Bau-Weg, nur test/; #3627 grün; #3640 Testschutz (üblich).

## Wache 09.11. 16:29
- WICHTIG: #3628 Teil 1/15: 0 von 4 getötet, alle "nicht geprüft (Frist)", 20,9 min (Lauf 42636312241, Basis enthält #3617). Gemergter Stand: Frist je Mutant fest 10 min, Jobfrist 20 min => jeder Überlebende kostet 10 min, zwei füllen den Job. Vorschlag auf #3367 kommentiert: Mutantenfrist = Jobfrist ÷ Mutanten je Teil und/oder ceil(Mutanten/2) je Teil. Hauptsitzung entscheidet (als Karte/Issue).
- #3627 zweimal aus Warteschlange (15:06/15:13); #3631 Mutation 1/3, 2/3 rot/laufend (H3 von #3493, widget); #3643 Freigabe fehlt (üblich). #3641 nicht meine.

## Wache 09.11. 17:00
- Berichtigung: #3628 Teil 1/15 war KEIN echter Überlebender, sondern Killer-Test fiel nach einer roten Kontrollprobe unter Last aus (basisRot). Hauptsitzung hat Ursache selbst gefunden (#3647/#3648: S1+S2). Meinen Vorschlag (Mutantenfrist koppeln) auf #3367 zurückgestellt.
- #3649/#3650: Antonio hat Fristen vorübergehend angehoben (25/45, Job 60), Rückbau auf 10/20/30 ist Abnahme. Kein Einspruch; Messung nach Merge #3648 fortsetzen. #3627 wieder 2x aus Warteschlange (15:38, 15:47, Flakes). Issues #3644/#3646 nicht meine.

## Wache 09.11. 17:31
- Warteschlange: #3627 5x, #3640 1x zurückgeworfen (15:07–16:10), immer lebenszeichen-prueft-event-loop-und-datenbank.test.js:506 oder widget-erste-zeichnung.test.js:98; beide stehen in #3639 (CLOSED) – auf #3639 kommentiert, Wiedereröffnen angeregt. #3631 grün.

## Wache 09.11. 18:02
- #3650 (Fristen 25/45/60) gemergt 16:16, #3648 (S1+S2) gemergt 16:55. #3628 Lauf 42659651674 mit beiden läuft: fertige Jobs 3,7–5,2 min, Rest pending; Mutation 8/15 war rot, jetzt neu. NÄCHSTER WECKER: Lauf auswerten (längster Job, Zahl "nicht geprüft (Frist)") und auf #3367 eintragen. Hinweis: Fristanhebung 25/45 heißt, Jobs > 10 min sind jetzt nicht mehr rot, Messung muss die Dauer nehmen, nicht das Ergebnis. Issues #3654/#3657/#3658 sind Prüfer-Folgen zu #3648/#3651, #3655 Zeit-Tests.

## Wache 09.11. 18:33
- #3628 grün, aber alle 15 Mutation-Jobs wieder "pending" (neuer Lauf nach Rebase?) – Auswertung beim nächsten Wecken. #3662 (H2: Abdeckung einmal je PR als Matrix k/6, Frist-Mutanten nicht begründbar): Bausystem netto −31 Zeilen (tools+workflows), schrumpft; #3661 war Dublette (geschlossen). Plan: Median 563–767 Kandidaten je Mutant, 8,5 % der Mutanten in der Frist – deckt sich mit meinen Messungen. Keine Einwände.

## Wache 09.11. 19:04
- ZIEL ERREICHT AN ZWEI ECHTEN PRs: #3628 (15 Teile) alle Jobs 3,9–8,2 min (Median ~6,5), #3631 (3 Teile) 1,1–1,4 min, beide grün gemergt 17:46. Auf #3367 eingetragen. Offen: Messung mit echtem Überlebenden; Rückbau Frist 25/45/60 → 10/20/30 (#3649/H5) erst nach Messfenster. Issues #3664–#3667 Folge-Issues der Pakete, nicht meine.

## Wache 09.11. 19:35
- #3669 (W3-Folge: Nachladen bleibt bei RPC-Fehler stecken) = Widget-Folge-Issue, nicht meine Sache. Kein Mutations-Messwert.

## Wache 09.11. 20:06
- #3670 (Vorspann: Bein auflegen bei Speicherfehler): Tests 3/6 (D5, uebergabe.test.js:273), Node 26 3/6 + 6/6 (F7a, fristen.test.js:355) rot, "Bedingung nicht innerhalb der Testfrist" – auf PR kommentiert (Auflegen-Weg prüfen statt neu starten). Mutation 3 Jobs 1,9–2,3 min grün (zweiter Messpunkt, kein Überlebender).

## Wache 09.11. 20:37
- #3670 grün, aus Warteschlange 19:25 wegen test/gemeinsam/stopp-weist-aussen-ab-und-laesst-interne-spruenge-durch.test.js:102 (SIGTERM/healthz, zeitabhängig) – dritter Flake neben lebenszeichen:506 und widget-erste-zeichnung:98 (siehe #3639-Kommentar). Bei Wiederholung auf #3639 nachtragen. Test 2/6 Rot vorher = Wiederholung.

## Wache 09.11. 21:19
- #3671/#3673 (ElevenLabs-Vorlage/Doku, Reste aus #3641/#3642) = Produkt-Folge-Issues, nicht meine Sache. Kein Mutations-Messwert.

## Wache 09.11. 21:49
- #3672 (Vorspann: EL-Ergebnis vor Abrechnung): "Prüfungen" war rot, beim Nachsehen Lauf neu/keine roten Checks. #3627 grün (offen). Nichts zu tun.

## Wache 09.11. 22:20
- CodeQL #91 auf #3662 (JSON.stringify(PRUEFEN) im Test-Attrappen-Quelltext): Falschmeldung, mit Antwort beantwortet; Schließen bei Antonio/Jonas. Offen für Antonio/Jonas gesamt: CodeQL #81–#91 (alle Tests/Hilfen, kein Produktcode). #3672 Tests 4/6 + Node 26 4/6 rot (Wiederholung abwarten), #3627 wieder aus Warteschlange 20:55 (Flakes), #3675 grün, #3674 Review Betreuung.

## Wache 09.11. 22:50
- #3679 (Testläufe ohne Werkzeug-Steuervariablen, +6/−1 in pruefen.mjs, Test +65): Vorbedingung für #3662 (drittes Urteil FAIL wegen geerbter MUTATION_ABDECKUNG). Klein, unauffällig, keine Einwände. #3672 grün (Node-26-Röte = Wiederholung), #3676 grün. #3678 Folge-Issue. Kein Mutations-Messwert.

## Wache 09.11. 23:21
- #3662 (H2 Abdeckung als Matrix k/6) GEMERGT 22:14; #3679/#3680 (Dublette/Vorbedingung) geschlossen. Erste Läufe mit Matrix: #3685 Abdeckung 1–6/6 je 0,7–1,0 min, Mutation 1/1 10 s. NÄCHSTER WECKER: #3683 (Zeiteinheiten, src/, 2 Mutation-Jobs) auswerten – Dauer + Abdeckung; erster Fall mit echtem src-Umfang nach H2. #3685 rot nur Lint (Bau-Agent); #3681 Testschutz üblich. #3684 Folge-Issue (F7a-Wackler), nicht meine.

## Wache 09.11. 23:51
- #3683 (Zeiteinheiten, src/): erster echter Lauf mit Abdeckungsmatrix (Lauf 42713892478): Abdeckung 1–6/6 je 2,9–5,6 min, danach Mutation 1/2 + 2/2 laufen (früherer Lauf Mutation 1/2 rot, Ursache nicht gelesen). Kette Abdeckung → Mutation ist nacheinander: Gesamtdauer = max(Abdeckung) + Mutation, nicht nur je Job – bei Auswertung beachten. NÄCHSTER WECKER: Ergebnis auswerten. #3685 grün; #3686/#3687 Folge-Issues.

## 10.11. 00:21 (Wache)
- PR #3683 (erstes echtes src-PR nach H2, Lauf 42713892478): Abdeckung 6 Teile 2,9–5,6 min; Mutation 2/2 grün nach 18,4 min; Mutation 1/2 läuft seit 23:08Z (>14 min), Log erst nach Laufende lesbar. Heißt: Jobs liegen über 10 min (Fristen 25/45/60 aus #3650 gelten noch). Offen: Log von 1/2 und 2/2 lesen (Überlebende? „nicht geprüft“? Zahl Kandidatendateien), dann Kommentar auf #3367.
- PR #3688 ist gemergt (23:18:38Z); die zwei „aus der Warteschlange gefallen“ waren vorübergehend (zweiter Versuch ging durch). Ursache der ersten Ausfälle nicht untersucht.
- Bekannt: Wache meldet gemergte PRs fälschlich als „gefallen“ (braucht Haupt-Sitzung).
- STAND.md existiert nicht mehr; Einträge hier.

## 10.11. 00:51 (Wache)
- #3690: Testschutz war rot bis Urteil+Label; Approve 23:40Z, jetzt grün und wieder in der Warteschlange (AWAITING_CHECKS). „Gefallen“ 23:46Z Ursache unbekannt, vermutlich Testschutz-Zeitpunkt/Flake.
- #3683: Lauf 42713892478 Mutation 1/2 rot nach 26,0 min: ein Überlebender (middleware.js:133/2) hat 25 min Frist verbraucht („nicht geprüft (Frist)“, nicht begründbar). Autor hat Begründung im PR-Text ergänzt (Mutation 1/2 jetzt grün) UND einen Test (ratenfenster-aufraeumtakt) → Rotprobe rot, da auf master grün. Prüfungen rot, Ursache ohne Log ungeklärt (Lauf 42722136749 läuft noch, Mutation 2/2). Kommentar auf PR und auf #3367 geschrieben. Nächstes Wecken: Log von Prüfungen lesen, Mutation-2/2-Dauer notieren.

## 10.11. 01:22 (Wache)
- #3683 (Lauf 42724673003): Rotprobe UND Prüfungen/Architektur rot wegen derselben neuen Testdatei ratenfenster-aufraeumtakt (grün auf master; importiert src/middleware.js direkt = tests-nur-ueber-eingaenge). Alles andere grün: Mutation 1/2 1,5 min (mit Begründung im PR-Text), Mutation 2/2 15,6 min. Kommentar auf PR: Datei entfernen. Nächstes Wecken: prüfen, ob entfernt und PR in der Warteschlange.
- Messwert: Begründung statt Test macht aus 26 min rot → 1,5 min grün für Mutation 1/2; Frist-Schleife (siehe #3367) entsteht, weil der Bau-Agent beides tut.

## 10.11. 01:53 (Wache)
- #3683: Testdatei entfernt, Kopf d87eac50: Prüfungen, Rotprobe, Testschutz, Freigabe grün; Mutation 1/1 lief noch (00:54Z). Nächstes Wecken: Dauer Mutation 1/1 notieren, Merge-Warteschlange prüfen.

## 10.11. 02:23 (Wache)
- #3683 gemergt 01:06:14Z. Mutation 1/1 15,7 min (grün; Abdeckung 3,2–6,1 min) – über 10 min, Ursache nicht untersucht (Log nach Merge noch lesbar: Lauf zu Kopf d87eac50).
- #3691 (Zeiteinheiten H2, Telefonie): Abdeckung 4,3–6 min; Mutation 1/3 2,1 min, 2/3 4,6 min, 3/3 Versuch 1 rot nach 3,0 min wegen 1 Überlebendem (signature.js:35/2, Grenzwert; Überlebender kostete 125 s/35 Läufe, keine Frist). Versuch 2 läuft ohne Begründung im PR-Text → wird rot. Kommentar auf PR mit Vorschlag (Begründungszeile, kein Test). Nächstes Wecken: prüfen, ob Zeile ergänzt, dann Warteschlange.

## 10.11. 02:54 (Wache)
- #3692 (Telnyx-Replay-Grenze ungetestet): Folge-Issue des Bau-Agenten statt Begründungszeile; Abnahme sauber (Verhaltenstest über Eingang, steuerbare Uhr, Handmutant). Nichts zu tun. #3691 hat dafür signature.js + Test wieder auf master-Stand gesetzt: Mutation 1/1 2,8 min grün, Prüfungen/Rotprobe grün.
- #3691 Tests 1/6 Versuch 1 rot (Lauf 42737650573, 233 s): test/werkzeuge/mutation-zeilen-abdeckung.test.js:294 „Die Zeile des Mutanten bestimmt, welche Testdateien zuerst laufen“ (mein S2-Test aus #3648). PR ändert nichts am Werkzeug → vermutlich Zeit-/Lastabhängigkeit (Test lässt 5 echte Prozesse mit 4-s-Schlaf laufen und erwartet genau a1–a3+z). Ursache NICHT belegt (Ausgabe des Vergleichs nicht im Log). Versuch 2 läuft. Nächstes Wecken: Ergebnis Versuch 2; wenn grün → Flake in Liste #3639-Familie, Test umbauen (Reihenfolge statt Zeitschlaf); wenn rot → Ursache suchen.

## 10.11. 03:24 (Wache)
- #3691 (02:03:40Z) und #3695 (02:12:40Z) sind GEMERGT; „gefallen“-Meldungen = Wache-Fehler (bekannt).
- Wackler aus 02:54 (mutation-zeilen-abdeckung.test.js:294) belegt und behoben durch #3693 (gemergt 02:03:24Z): Ursache 4-s-Wanduhrschlaf, unter Last laufen a4/a5 mit (laeufe 7 statt 5). Meine Vermutung war richtig. Folge-Issue #3694 (Attrappen enden mit Elternprozess, SOLLTE) – Bau-Agent-Sache, Teil von #3639.
- Mutation-Messwerte: #3695 (nur Test, kein src) Abdeckung ~1 min, Mutation 1/1 9 s. #3696 (src/config.js, zentral): Abdeckung 3,1–6,0 min, Mutation 1/2 5,2 min grün, 2/2 läuft (02:25Z noch). Nächstes Wecken: Dauer 2/2 und ggf. Überlebende notieren.

## 10.11. 03:55 (Wache)
- #3696 (src/config.js, zentral) gemergt 02:40:03Z; Mutation 1/2 5,2 min, 2/2 7,6 min, beide grün, ohne Überlebende – erstes zentrales src-PR unter 10 min (Abdeckung 3,1–6,0 min). „Gefallen“ 02:33Z = Wache-Fehler/kurzer Rücklauf, dann gemergt.
- #3697 (Wackler 3365-F7a) vom Prüfer geschlossen: kürzeres Abfrageintervall schließt das Fenster nicht; Lösung = steuerbare Uhr für Produktfristen (#3639, H3). Testschutz-rot war nur fehlendes Urteil. Nichts zu tun.
- #3698 (signature.js MS_PER_SECOND) Approve da, Mutation 1,6 min, steht in Warteschlange (AWAITING_CHECKS).

## 10.11. 04:26 (Wache)
- #3698 gemergt 03:02:55Z („gefallen“ 02:56Z = Wache-Fehler/Rücklauf).
- #3699 (TTS-Zyklus-Schlüssel, Monatsende, Folge aus #3388): echter Fehler mit klarer Abnahme, wartet auf Merge von #3609 (src/store). Nichts zu tun.
- #3700 (Eingabeprüfung, Teil #3479): rote Prüfungen stammten von früheren Köpfen; Bau-Agent hat dreimal nachgepusht (03:16, 03:21, 03:26Z), frühere Läufe abgebrochen, aktueller Lauf 42749434589 läuft. Nächstes Wecken: Ergebnis + Mutationsdauer notieren.

## 10.11. 04:56 (Wache)
- #3700 (Eingabeprüfung, #3479): Lauf 42749434589 rot wegen Rotprobe (test checkout-rueckkehr-abfrage grün auf master, Bau-Agent hat danach umgebaut), Lauf 42751246524 (Kopf b87b16ee) rot nur wegen Architektur: test/sicherheit/eingabe-pruefen.test.js importiert src/utils/eingabe-pruefen.js direkt (tests-nur-ueber-eingaenge). Lösung läuft als #3701 (Eintrag in tools/bereiche.json, Bereich fachlogik, wie stripe-ereignis-regeln/#3674; keine Lockerung, Weg bleibt erlaubter Fachlogik-Pfad). Reihenfolge: #3701 zuerst, dann #3700 neu starten. Mutation bei #3700: 1,0/1,1 min grün.
- Nichts kommentiert; #3701 entspricht dem Standardweg.

## 10.11. 05:26 (Wache)
- #3701 gemergt 04:12:26Z; #3700 danach grün (Abdeckung 2,7–5,5 min, Mutation 1,2/0,8 min), wartet auf Merge/Freigabe. Nichts zu tun.

## 10.11. 05:57 (Wache)
- #3700 gemergt 04:28:30Z, #3703 gemergt 04:48:14Z (Mutation 2,3/1,3 min).
- #3702 (Vorspann-Frist, failed statt completed; src/elevenlabs/vorspann-ablauf.js): Mutation 3/5 und 4/5 rot nach je 3 min, je 1 echter Überlebender (98/2 leerer catch, 99/3 logFehler-Text) im neuen Fehlerweg vermerkeNichtAbgespielt – kein Test dafür; PR-Text „Keine bekannt“ falsch. Kommentar mit Vorschlag (Test mit werfendem Store). Testschutz rot = Urteil+Label fehlt (normal). Nächstes Wecken: prüfen, ob Test ergänzt.

## 10.11. 06:27 (Wache)
- #3702: kein neuer Stand geprüft (letzter Stand: 2 echte Überlebende im Fehlerweg, Kommentar steht).
- #3704 (Eingaben mit Schema, 2b; api-calls.js, self-service-routes.js): Mutation 1/2 3,9 min; 2/2 Versuch 1 rot nach 19,8 min wegen 1 Überlebendem (self-service-routes.js:167/3, .catch("") → "Stryker was here!"; 376 Läufe, 1146 s – knapp unter Frist 1500 s). Kein Abschnitt Überlebende im PR-Text → Versuch 2 (05:25Z) wird rot. Kommentar mit Begründungsvorschlag. MESSWERT für #3367: ein Überlebender in einem von ~376 Tests erreichten Modul = ~19 min; mit Frist 10 min wäre er „nicht geprüft (Frist)“, nicht begründbar → vor Rückbau #3649 klären.

## 10.11. 06:57 (Wache)
- #3702: neuer Kopf e1679844 (05:52Z) mit Test für „Fehler beim Vermerken verhindern das Auflegen nicht“ (Antwort auf meinen Kommentar). Testschutz rot = Urteil+Label fehlt (normal). Mutation für den neuen Kopf noch nicht abgelesen. Nächstes Wecken: Mutationsergebnis.
- #3704: neuer Kopf 84852ff0, Mutation 1/2 und 2/2 laufen seit 05:57Z; PR-Text ohne Abschnitt Überlebende (Stand 05:58Z). Nächstes Wecken: ob Fall 167/3 wieder 19 min kostet oder behoben.
- #3585 (Flügel der Anrufkarte, H1 von #3492; mein Prüffall für eingebettete Skripte): „grün“ der Wache ist veraltet – PR ist CONFLICTING (100 Commits hinter master, 5 voraus), Kopf f8fdcb25, letzter Commit 05:50Z „Flügel-Test steht in der Mutationsprüfung vorn“. Hält seit #3589; #3592 ist gemergt, Paket kann weiter. Bau-Agent arbeitet offenbar daran; nach Rebase Mutationsdauer für wing-canvas-engine.js messen (Kernfall aus #3367).

## 10.11. 07:28 (Wache)
- Gemergt: #3704 (06:11Z), #3702 (06:13Z), #3585 (06:26:30Z). Mutation: #3585 0,9/1,3 min (Abdeckung 3,4–5,8) = Ursprungsfall wing-canvas-engine nun < 2 min; #3702 max 5,6 min; #3704 4,1/2,6 min.
- MEINE FALSCHE EINORDNUNG korrigiert (#3367): #3704 167/3 war nicht äquivalent; Bau-Agent schrieb Test „Abmelde-Link ohne Text-Token meldet niemanden ab“, tötet in 38 s. Lehre: erst prüfen, ob ein Verhaltenstest den Mutanten tötet, bevor ich „äquivalent“ vorschlage.
- Folge-Issues #3705 (F10-Test prüft Grund nicht), #3708 (Pille-Test) vom Prüfer, SOLLTE, Bau-Agent-Sache; nichts zu tun.

## 10.11. 07:58 (Wache)
- #3706 (Eingaben mit Schema 2c, nur src/self-service-routes.js + 1 Test): Lauf 42770045505 Versuch 1: Mutation 2/2 grün 2,8 min; Mutation 1/2 läuft seit 06:46Z (>13 min um 06:59Z) → vermutlich wieder ein Überlebender in einem von ~376 Tests erreichten Modul. Log erst nach Laufende lesbar. Nächstes Wecken: Log lesen (Schlüssel, Läufe, Zeit) und prüfen, ob ein Verhaltenstest ihn töten kann, bevor Begründung vorgeschlagen wird.
- #3709 (Ring der Anrufkarte H2, call.html): Tests 3–6/6 rot im ersten Lauf (Pin-/Vertragstests wegen geänderter Widget-Bytes, eigener Test widget-ring-rund Kreis, widget-anruffolge-last 20 von 20 unter CPU-Last = zeitabhängig, hud-card-css-sync). Mutation 1/1 1,1 min grün. Bau-Agent iteriert; nichts kommentiert.

## 10.11. 08:29 (Wache)
- #3706 Versuch 1 (Lauf 42770045505): Mutation 1/2 rot nach 21,6 min: 168/2 (.catch("") → "Stryker was here!"; diesmal WIRKLICH äquivalent, knownPlanSlug macht beides zu null; 1085 s/378 Läufe) + 462/6 (echter Testmangel, 62 s). Kopf e9e99b88 (07:27Z) hat Begründungszeile + neuen Test; Versuch 2 läuft (Lauf 42775535569). Kommentar mit Hinweis: Muster z.string().catch("") erzeugt äquivalente Mutanten, die 18 min kosten, auch wenn begründet; Alternative optional()/undefined. MESSWERT: Begründung spart keine Laufzeit, nur Urteil. Vorschlag für #3479-Bau-Briefe prüfen: Muster vermeiden (nur Hinweis, keine neue Prüfung).
- #3711 (bau.md: ein Push-Weg über paket-push/paket-pr, +2/-2, keine Prüfung hinzu): passt zum Grundsatz „genau ein Weg“; Urteil des Prüfers liegt noch nicht vor. Nach PASS freigeben (gh-Review als Antonio20045).
- #3712 Folge-Issue des Prüfers zu #3710 (Migrationstest 0011 vergleicht nur id): SOLLTE, Bau-Agent-Sache.
- #3709 Testschutz rot = Urteil fehlt; kein neuer Stand geprüft.

## 10.11. 09:01 (Wache)
- Gemergt: #3709 (08:00:18Z, mit Label+Approve), #3711 (07:52Z), #3714 (08:01Z). #3706: Versuch 2 (Lauf 42775535569) grün, Mutation 1/2 22,0 min (äquivalenter Mutant 168/2 = 1091 s/378 Läufe, begründet), 2/2 4,3 min; neuer Kopf 96e67ce4 (07:57Z, Rebase), Lauf 42778978469 läuft. Messung auf #3367: Überlebender in stark erreichtem Modul bestimmt die Jobzeit, auch begründet. Optionen (a) Muster vermeiden, (b) begründete Mutanten nicht laufen (verliert Gegenprobe). Neige zu (a), nichts gebaut.
- #3717 (Mutation erreicht eingebettete Skripte in widgets/*.html nicht, aus #3709): echte Lücke im Werkzeug; zurückgestellt (nach 10-min-Auftrag, nur mit Ausgleich), Kommentar im Issue. #3715 (bau.md präzisieren) und #3716 (Glow in Flügel-Karten, Produkt) sind SOLLTE-Folgen, nichts zu tun. #3711-Prüferbefund 1 (ls-remote als Lease = Force) beachten.

## 10.11. 09:32 (Wache)
- #3706: Kopf 96e67ce4 grün; Mutation 1/2 15,6 min (äquivalenter Mutant 168/2), 2/2 2,8 min; „Node 26 4/6 rot“ war ein früherer Versuch, jetzt grün. Offen: Merge.
- #3718 (eigene Nummer ohne Ziel-Limit, outbound-gates.js): Mutation 1/2 1,9 min, 2/2 1,3 min grün; Tests 1/6 und 6/6 (+Node 26) im laufenden Lauf 42781714876 rot, Log erst nach Laufende lesbar. Nächstes Wecken: rote Tests lesen.
- #3720 (H2b Flügelzyklus, wing-canvas-engine.js; Ursprungsfall #3367): Mutation 1/4, 3/4, 4/4 rot nach je ~2,1 min, 2/4 läuft; Lauf 42781394504 läuft noch, Logs nicht lesbar. Testschutz rot = Urteil fehlt. Nächstes Wecken: Überlebende lesen, prüfen ob ein Verhaltenstest sie töten kann (nicht vorschnell „äquivalent“).
- #3719: Issue zu H2b (Bau). Nichts zu tun.

## 10.11. 10:02 (Wache)
- Gemergt: #3706 (08:33:50Z, Mutation 15,6/2,8 min), #3722 (08:55Z). Grün/in Arbeit: #3718 (Mutation 3 Jobs je ~2,3 min), #3724, #3725 (je ~1 min), #3721 (Mutation 4/5 lief um 09:02Z seit 08:49Z = >13 min; Log erst nach Laufende).
- #3720 (H2b Flügelzyklus; wing-canvas-engine.js): ERSTER Beleg, dass Mutation das Engine-File jetzt erreicht und schnell tötet (Jobs 1,0–1,1 min, Mutanten 5–16 s). Rot wegen 4 Überlebender an Zeile 470 (preset === "olympian" ? olympianCycle : classicCycle): kein Test unterscheidet die Zyklen je Preset → echter Testmangel; Kommentar mit Vorschlag (Bild mitten im Schlag je Preset). 
- #3723 (TTS-Zyklus, #3699): Prüfungen rot nur wegen Architektur (Test importiert src/store/state-ops.js direkt); Kommentar: über den Eingang des Bereichs store, keine bereiche.json-Ausnahme.
- Nächstes Wecken: #3721 Mutation 4/5 Log (Überlebender? wie lange?), #3720 Antwort des Bau-Agenten.

## 10.11. 10:33 (Wache)
- #3721 gemergt 09:13:15Z. Mutation 4/5 15,2 min mit 3 getöteten Mutanten: 173/8 erst nach 850 s/359 Läufen (Töter sec-p3-eingabegrenzen-csrf spät in der Reihenfolge). Dritter Zeitfresser neben Überlebender und äquivalentem Mutant; Messung auf #3367. Alles andere der Stunde ≤ 5 min (#3720 1,1, #3728 1,2, #3718 2,3, #3724/#3725 ~1).
- #3727 (Stripe-Abgleich): „Node 26 1/6 rot“ stammt aus früherem Versuch, neuer Lauf läuft. #3723 neuer Kopf 026bb591, CI läuft. #3720 Kopf unverändert 2d9b3882 (kein Push des Bau-Agenten auf meinen Kommentar bisher).
- #3726, #3729: Folge-Issues des Prüfers/Bau, SOLLTE; nichts zu tun.

## 11:04 (Wache, 10.11.)
- #3727 gemergt 09:56:16Z (Mutation 1,2/1,1 min). #3723 (da2b9ac0) und #3730 (823a39c2) grün und in der Merge-Warteschlange (AWAITING_CHECKS); Semgrep-Rot von #3723 war früherer Kopf, jetzt grün. „#3730 gefallen 09:58Z“ = Rücklauf/Wache-Fehler, steht wieder in der Schlange. Mutation #3723 1,0 min, #3730 1,5 min.
- #3720: Prüfer-Urteil FAIL (08:31Z, MUSS 1: Kriterium „starten im selben Bild“ nicht gezeigt), plus meine Überlebenden an Zeile 470; Bau-Agent arbeitet noch (Kopf 2d9b3882 unverändert). Nichts zu tun.

## 10.11. 11:34 (Wache)
- #3720: Kopf 5a9a0ec0 (Antwort auf Urteil+meinen Kommentar): Mutation 1/3–3/3 grün in 1,2–1,4 min (4 Überlebende an Zeile 470 weg) ✔; Testschutz rot = Urteil fehlt. Ursprungsfall #3367 damit praktisch belegt.
- #3733 (Stripe-Ereignisregister Teil 2): Prüfungen rot nur gitleaks (1 Fund, vermutlich erfundenes whsec_ im neuen Test); Kommentar: erfundene-geheimnisse.js benutzen, keine Ausnahme. Mutation 3 Jobs 1,4–4,6 min.
- #3731 (EL-Bein-Kennung, vorspann-ablauf.js + store/pg.js): Rotprobe rot (Log erst nach Laufende lesbar; Vermutung: ein neuer Test schon auf master grün). Mutation 1/1 läuft.
- #3732 (a9-5 EL-Webhook-Körper): Mutation 1/4 rot nach 2,1 min (Log nicht lesbar), 2/4 lief um 10:34Z seit 10:19Z = >15 min (möglicherweise stark erreichtes Modul). Nächstes Wecken: Logs von #3731 und #3732 lesen.
