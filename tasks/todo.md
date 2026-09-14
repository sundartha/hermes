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
- [ ] IEL-S Spec + Review (Security/Regeln opus, Clean-Code sonnet) -> `tasks/iel-spec.md`
      Runde 1-2: 3 Rest-Blocker; Lead-Entscheidungen R-A..R-F (Secrets per Skript, Pflichtsatz bei
      Frist, gleiche Stimme, Owner nur Testanruf) -> Runde 3 laeuft.
- [ ] IEL-B* Bau je Phase per Workflow (Plan -> Impl -> Safety + Clean-Code + Security -> Self-Fix)
      Pruefung: Gate PASS, Lead `git diff --stat`, Merge, volle Suite einmal `# fail 0`.
- [ ] IEL-D Push upstream + Deploy + Schalter nur fuer den Owner-Tenant an
      Pruefung: Boot-Banner/Render-Log zeigt Commit und Schalter.
- [ ] IEL-T Owner-Testanruf (Owner) — Pruefung: Render-Log + ElevenLabs-Conversation + Owner-Urteil
- [ ] IEL-X Budget-Engine entfernen — NICHT vor IEL-T.
