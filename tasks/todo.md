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
