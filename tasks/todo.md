# todo: Sprachdefekt 2026-09-04 — Messphase ABGESCHLOSSEN, Fix wartet auf Freigabe

Ausgangslage + Ergebnis: `tasks/UEBERGABE-SPRACHDEFEKT.md` (Nachtrag Session 2, BELEGT 15–23).
Regel: kein Push, kein Deploy, kein Testanruf ohne ausdrueckliche Freigabe des Eigentuemers.

## Messauftraege (erledigt, rein lesend)

- [x] **A Audio-Forensik 12:37** — Ergebnis: Eigentuemer sagte NICHTS (Stille −83 dB zwischen
      7,13 s und 9,15 s); Phantom-Turn. Verifikation: Scribe-Laeufe auto/deu/spa wortidentisch,
      `scratchpad/audio/scribe-*.json`; WAV `segmente/spanisch_luecke_5.4-9.4s_STILLE.wav`.
- [x] **B Werkzeug-Ausloesung** — Ergebnis: Mailbox = erster echter Mailbox-Kontakt; language_
      detection Folge des Phantoms; Payload-Diff GUT vs. 09-02 = null. Verifikation:
      `scratchpad/conv/tabelle.md`, 17 JSONs.
- [x] **C Fremdeinfluss** — Ergebnis: keine Version nach v39, upstream==origin, kein Changelog-
      Treffer; Deploy-Zeitstrahl 04.09. ergaenzt. Verifikation: `scratchpad/c/branch.json`,
      `list_deploys`, `git log upstream/master`.
- [x] **D Server/Telco** — Ergebnis: Server loest fuer 12:37 dieselbe Sprache (de) und byte-
      identische Eroeffnung wie 09-03; 06:01 = eigene Fehlerklasse (Telnyx verbunden mos=1,
      EL 1011), 27.08. = D51. Verifikation: Render-Logs, DB-`call`-Zeilen, `detail_records`.

## Synthese (Lead)

- [x] Spanisch: Mechanismus BELEGT (Phantom-Turn -> transcribe_on_disabled_interruptions ->
      Prompt-Regel "continue in that language" -> language_detection verriegelt). Leckpfad des
      Phantoms NICHT BELEGT.
- [x] Voicemail-Erstausloesung: BELEGT trivial (erster echter Mailbox-Kontakt).
- [x] 06:01: Fehlerklasse BELEGT (SIP-Timeout bei verbundener toter Leitung), Ursache NICHT BELEGT, n=1.
- [ ] **Freigabe des Eigentuemers** fuer F1 (+F2/F3) einholen — s. Uebergabe "Fix-Vorschlag"
- [ ] Danach: Server-Variable `call_language` -> Deploy -> Prompt-Push -> ECHTER Testanruf
      (Gespraechspfad), getrennt Mailboxpfad. Erwartet: Agent bleibt deutsch trotz Phantom;
      Verifikation: EL-Transkript ohne `language_detection`-Aufruf, Audio deutsch.

## Umsetzung (autonom freigegeben 2026-09-04, Spec `tasks/sprache-gegenkraft-spec.md`)

- [ ] **SP1** Vorlage: Prompt-Regel E-5b + `transcribe_on_disabled_interruptions=false` + Tests umgepinnt.
      Erwartet: `npm test` gruen, lint 0, JSON parsebar. Verifikation: Suite-Lauf im Lead nach Merge.
- [ ] **SP2** Push-Werkzeug: `voicemail_message` ueber `je_schluessel` auf `built_in_tools`.
      Erwartet: Zusammenfuehrungs-Tests (1)-(6) gruen. Verifikation: Suite-Lauf im Lead nach Merge.
- [ ] Eigentuemer: Push in Reihenfolge, zwei Testanrufe (Gespraech + Mailbox).
