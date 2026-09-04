# EL-Agenten-Stimme: Umsetzung ST0-ST5 (2026-09-03, Lead-Session)

Auftrag: Phasenplan aus tasks/PLAN-AGENTEN-STIMME.md umsetzen. Freigegeben vom Owner:
ST0 inkl. Mitschnitt-Testanruf (Entscheidung 1), ST1/ST3 (Code+Tests). Vor JEDEM dieser
Schritte EINZELN Owner-Gate: EL-Push in ST2, (A/B-)Testanrufe in ST4. Befund-Doc:
tasks/EL-STIMME-BEFUNDE.md (ST0-Belege + Phasenprotokoll). Die 7 Owner-Entscheidungen
2026-09-02 gelten; nicht erneut stellen.

- [x] 1. ST0 Forensik schliessen (read-only + Testanruf): elevenlabs:drift (Exit-Code +
      Feldliste der Abweichungen, LIVE-Erlaubnis-Karte inkl. first_message-Status,
      Entscheidung 7), 30-Tage-[el-tags]-Rueckblick in Render-Logs
      (srv-d8m0fhflk1mc73bno570), Mitschnitt-Testanruf eigene Nummer — VORHER belegen,
      dass Recording aktiv ist — + Audio-Auswertung (Filler-Frage: Sprechpause/
      Stimmwechsel zwischen den Saetzen?).
      ERWARTET: Befund-Doc mit Drift-Exit-Code + Abweichungsliste, [el-tags]-Trefferzahl
      als Zahl, first_message-Status, Mitschnitt-Urteil Filler ja/nein/unentscheidbar;
      Erkenntnis-Kopplung: erschuettern die Befunde ST1/ST2?
      VERIFIKATION: Exit-Codes + Audio-Messwerte im Doc; Lead-grep auf Secret-Muster und
      vollstaendige E.164 im Doc = 0 Treffer.
      BELEG: tasks/EL-STIMME-BEFUNDE.md — drift Exit 1 (38/38 verglichen, 2 bewusste
      Ausnahmen retention/record_voice, 1 blockierend: 2 LIVE-only Erlaubnis-Schluessel);
      [el-tags]-Trefferzahl=3 im beobachtbaren Fenster (Render-Retention NUR 7 Tage,
      30-Tage-Fenster logseitlich unerreichbar; 3/3 der seit 30.08. log-sichtbaren
      Outbounds betroffen); first_message=TRUE (Entscheidung 7 beantwortet); Recording
      aktiv-belegt (record_voice=true, Audio-Abruf HTTP 200 am Vorfall). FILLER-FRAGE AM
      ORIGINAL-VORFALLS-AUDIO GEKLAERT: urteil=eine-generation (Grenzpause 0,33 s unter
      Baseline-Median 0,58 s; kein Stimm-Sprung; Frueheinsatz-Fenster still; Luecke durch
      Endpointing+LLM-Latenz erklaert, Initiierung nach 0,512 s VOR der 2,0-s-Schwelle).
      Owner 2026-09-03: Testanruf UEBERSPRUNGEN (Entscheidung 8); Erlaubnis-Karte:
      2 LIVE-only Schluessel in Vorlage aufnehmen (Entscheidung 9, Erledigung ST2).
      Lead-grep auf Doc: Umlaute 0, volle E.164 0. Kein Code geaendert -> keine Suite.
- [x] 2. ST1 Regeln (O1): B1-Regel + B2-Ergaenzung im Vorlagen-Master-Prompt,
      soft_timeout_prompt_override-Umformulierung, speechRules de/en/fr (ENDE-Insert,
      Quell-Kommentar auf Vorlage); Tests AS2 (inkl. Unberuehrtheits-Assertion der
      Art.-50-Felder), AS3, AS4 in der Bahn test:abnahme.
      ERWARTET: AS2/AS3/AS4 gruen in npm run test:abnahme; npm test gruen; phase-impl
      mit dualem Review (S1/S2 = Blocker).
      VERIFIKATION: "# pass"/"# fail"-Zeilen als Beleg hier; Merge nur mit Suite-Beleg.
      BELEG: phase-impl Run wf_e4493e04-490, Branch phase/task-impl (93bfbaf + Fix
      c9b7aed), Merge 1c10a6b. Safety-Review FREIGABE (Art.-50-Felder byte-identisch
      gepeinnt, Scope exakt, Branch-Suite 5684/5684 im Reviewer-Lauf); Clean-Code
      Runde 1: 1x S1 (Regel-Pins liefen nur in der Abnahme-Bahn) -> Fix-Runde:
      AS1-AS4 in die Regressionsbahn gewandert (Siegel [abgenommen ASn] am Namensanfang,
      abnahme-ausgewandert.json 3->7, R2-Ratsche gruen) + S4-Fix LANGS=Object.keys-
      (LOCALES); Re-Audit pass=true, 0x S1/S2. LEAD-SUITE AUF MERGE (1c10a6b):
      test:abnahme "7 von 7 Abnahmekriterien erfuellt", Exit 0. npm test Volllaufen:
      5668/5666/2 bzw. 5668/5667/1 — Fail-Namen WANDELN zwischen Laeufen, EL-CONSULT S1
      isoliert 3x gruen (Spawn-Flake, Reviewer sah dasselbe Muster an HM4/originateVia-
      CallControl). test:gates 3 rot (GAP-05 SOLL, GAP-15 SOLL rot, E2E-03) — alle 3
      PER BASELINE-LAUF AUF cd8a88c VOR dem Merge identisch rot belegt (vorbestehende
      Produktbefunde, nicht ST1). KEIN Push ans Live-System: nur Repo-SOLL geaendert;
      drift wird bis ST2 erwartungsgemaess um agent.prompt.prompt + llm_override
      zusaetzlich rot (Befund-Doc ST1-Abschnitt).
- [x] 3. ST2 Pin & Push (O2) — OWNER-GATE vor dem Push (patcht Live-Agenten): frischer
      Drift-Lauf unmittelbar DAVOR (LIVE-Erlaubnis-Karte, R7; kein stiller Push),
      Pin-Erweiterung use_llm_generated_message + max_soft_timeouts_per_generation mit
      _hinweis + Aenderungsweg (AS5), Push mit Ruecklese, Drift exit 0 danach (AS6).
      ERWARTET: Push-Protokoll (geaenderte Felder + Ruecklese) im Befund-Doc; AS5/AS6
      gruen.
      VERIFIKATION: Drift-Exit-Code 0 nach Push dokumentiert; test:abnahme-Beleg.
      TEILBELEG (Repo-Vorbereitung 2026-09-03, KEIN Push): Entscheidung 9 umgesetzt -
      Karte um tts.supported_voices=false und additional_soft_timeout_messages=false
      erweitert (Einfuegeposition per read-only LIVE-GET; Karte SOLL == LIVE), Pins
      soft_timeout_llm_filler/soft_timeout_filler_limit mit SOLL=LIVE-Messwert und
      Aenderungsweg gesetzt; AS5 GRUEN, AS6 ROT wie erwartet ("8 von 9"), npm test
      5687/5687; Push-Semantik im Befund-Doc dokumentiert (Karten-PATCH ersetzt das
      Gesamtobjekt, Skriptkopf GEGENPROBE STATT VERTRAUEN); read-only Drift-Lauf:
      Karte aus der Abweichungsliste gefallen, 40/40 verglichen, rot nur noch
      retention/record_voice (BEWUSST AUSGENOMMEN) + agent.prompt.prompt +
      llm_generated_message_prompt_override. OFFEN: OWNER-GATE Push (frischer
      Drift-Lauf DAVOR, R7); danach Protokoll-Abschnitt "## ST2 Push-Protokoll" mit
      "Ruecklese" und "Drift nach dem Push: Exit-Code 0" nach den AS6-Markern ins
      Befund-Doc (tasks/EL-STIMME-BEFUNDE.md).
      BELEG (PUSH + AS6, 2026-09-03): Owner-Freigabe nach Patch-Prognose. R7-GUARD
      ZUGESCHLAGEN: Vor-Push-Drift meldete 5 statt 4 Abweichungen — EL hatte 4
      allowed_values:null-Keys an get_consult/look_up migriert (version_id unveraendert,
      Deep-Diff ST0-GET vs Frisch-GET); R7-Nachzug Commit 9b52004 (Vorlage-SOLL + Doc-
      Abschnitt), danach 4 Abweichungen wie erwartet. Push (erst Trockenlauf, dann echt
      mit --felder=prompt,soft_timeout_prompt_override --ausfuehren): GENAU 2 Pfade
      geschrieben (agent.prompt.prompt + llm_generated_message_prompt_override),
      Ruecklese "OK - 2 Felder geschrieben und zurueckgelesen"; Drift nach dem Push:
      Exit-Code 0 ("2 abweichend, ALLE bewusst ausgenommen, 40/40, keine
      Verbots-Verletzung"). Push-Protokoll im Befund-Doc ("## ST2 Push-Protokoll").
      AS6 gruen -> gewandert (Siegel, ausgewandert.json 8->9); npm run test:abnahme
      "9 von 9 Abnahmekriterien erfuellt"; Selbsttest + Datei 15/15 gruen.
      BELEG (Merge + Suite, 2026-09-03): phase-impl Run wf_c59e926d-0b5, Commit 73a92f2,
      Safety FREIGABE + Clean-Code PASS (je 0 Blocker, kein src/-Kontakt). Merge 8a45f40;
      AS5 gruen abgeliefert und direkt in die Regressionsbahn gewandert (Siegel
      [abgenommen AS5], ausgewandert.json 7->8, Commit bce9d6f; npm run test:abnahme
      "8 von 9 Abnahmekriterien erfuellt"). LEAD-SUITE AUF MERGE+MIGRATION (bce9d6f):
      npm test # pass 5688 / # fail 0 (komplett gruen, kein Flake); test:gates 3 rot
      (GAP-05/GAP-15/E2E-03, per Baseline-Lauf auf cd8a88c als vorbestehend belegt,
      s. ST1-Beleg); test:abnahme Exit 0. Push-Prognose fuer das Owner-Gate: der
      Live-Push schreibt voraussichtlich NUR agent.prompt.prompt (B1/B2-Regeln) und
      llm_generated_message_prompt_override (neuer Text); Karte und neue Pins stehen
      SOLL==LIVE und sind keine Schreibkandidaten.
- [x] 4. ST3 Detektoren (O3, NUR Diagnose): [el-b1]-Heuristik (eng: nur unmittelbar
      aufeinanderfolgende Saetze, loggt NUR Trefferzahl/Cues/Zeilenindizes — R8),
      Zaehlfeld [el-tags]/[el-b1] am Call-Datensatz (Entscheidung 6), Kommentar-
      Erweiterung outbound.js (Vorfall 2026-09-02), anonymisierte Vorfalls-Fixture
      conv_0501... (AS7), Gegenprobe an sauberen Fixtures (AS8), String-Check (AS9).
      ERWARTET: AS7/AS8/AS9 gruen; gespeicherte Transkripte unveraendert (Art. 50);
      npm test gruen.
      VERIFIKATION: test:abnahme + npm test Beleg hier; Merge nur mit Suite-Beleg.
      BELEG: phase-impl Run wf_c4e3da6a-efa, Commits 31394c3 + Fix 598d322 + 7e7eb88,
      Merge 42dfdf0. Runde 1 BLOCKED (2x S1: ungegruendete pg.js-Lint-Pin-Anhebung
      makePgStore 576->581 ohne FINGERPRINT-Nachzug — Ratsche ist Owner-Gate; fehlender
      publicCall-Strip-Pin-Test fuer elDetectorCounts). Fix: Pin-Anhebung zurueckgebaut
      via Modul-Fabrik elDetektorMutatoren + dokumentierter KV2-7-Kompaktionspraezedenz
      (makePgStore exakt 576, Legacy-JSON byte-identisch zu master, Ratsche 41/41) +
      Strip-Pin-Test AL-P1-5-Muster. Re-Audit pass=true, 0x S1/S2. Umsetzung: reines
      Heuristik-Modul src/elevenlabs/b1-doppelankaendigung.js, Reporter [el-b1] (nur
      Trefferzahl/Cues/Zeilenindizes — R8), Zaehlfeld elDetectorCounts durch komplette
      Store-Kette inkl. idempotentem pg-Schema-Migrationspfad, Vorfalls-Kommentar am
      reportAudioTags-Block, anonymisierte Vorfalls-Fixture (AS7, kein Nummern-/Eigen-
      namen-Grep-Fund). AS7-AS9 von der Impl direkt gewandert (ausgewandert.json 9->12).
      LEAD-SUITE AUF MERGE (42dfdf0): npm test 5683/5683 fail 0; test:gates 3 rot
      (bekannt vorbestehend, s. ST1-Beleg); test:abnahme "12 von 12 Abnahmekriterien
      erfuellt". AS10/AS11 folgen in ST4/ST5.
- [x] 5. ST4 Verifikations-Testanruf — OWNER-GATE vor den Anrufen (Kosten): echter
      Anruf mit Detektoren live, Transkript als anonymisierte Fixture, Owner-Hoer-Urteil
      (natuerlicher Uebergang, Stille-Wahrnehmung) ins Befund-Doc (AS10); A/B-Testanrufe
      ignore_default_personality (Entscheidung 3, Schaltung nur auf Messung).
      ERWARTET: AS10 gruen (Klammer-Marken in Agent-Zeilen = 0, B1 ungemeldet,
      Hoer-Urteil-Abschnitt im Doc, Fixture anonymisiert).
      VERIFIKATION: call-/conv-ID + grep-Exit-Code im Befund-Doc; test:abnahme-Beleg.
      BELEG (Abschluss ohne Anruf, 2026-09-04): Owner-Anordnung "den testanruf mach ich
      nicht" — Verifikationsanruf UND A/B (Entscheidung 3) nicht durchgefuehrt,
      Entscheidung 10 im Plan-Doc. DEPLOY DURCHGEFUEHRT (freigegeben): dep-dad718gn74is73
      dia44g auf 4368c00 live (/healthz belegt), Detektoren + Zaehlfeld + ST1-i18n im
      Prod-Gateway, Owner-Self-Call scharf, Recording aktiv. AS10 als BEWUSST ROTES
      Doc-Kriterium gepinnt (Kennung + Grund-Zeile, Marker '## ST4 Verifikationsanruf'
      / 'Klammer-Marken in Agent-Zeilen: 0' / 'B1: ungemeldet' / 'Hoer-Urteil'),
      nachholbar laut Protokoll ST0-3. Befund-Doc: ST4-Abschluss + Offene Punkte
      (Endstand). npm run test:abnahme: "13 von 14 Abnahmekriterien erfuellt"
      (AS10 das einzige offene).
- [x] 6. ST5 Lehren sichern + Abschluss: tasks/lessons.md EL-Regel mit VIER Kernsaetzen
      (AS11, deterministischer Grep); Aufraeum-Pflicht (Prozessmuell der Kette im
      Merge-Commit: untrackte Doku erst committen, dann loeschen, nie git add -A);
      volle Suite EINMAL vom Lead (npm test, test:gates, test:abnahme — nur wenn Code
      geaendert); Kostenmessung per temp-HOME-Symlink (Memory
      workflow-kosten-claude-zai-pfad) + node scripts/workflow-kosten.mjs <run-id>.
      ERWARTET: AS11 gruen; Kostenzahl aus workflow-kosten.mjs (nie subagent_tokens).
      VERIFIKATION: test:abnahme-Beleg + Kostenzahl hier.
      BELEG: AS11 gruen abgeliefert und direkt gewandert (Siegel, ausgewandert.json
      12->13) — lessons.md L5 "EL-Agenten-Stimme: vier Kernsaetze" mit den Signatur-
      Phrasen MELDEN NICHT ENTFERNEN / Beispiel schlaegt Regel / Dashboard schlaegt
      ungepinntes Repo / Vorlage ist kanonisch. Aufraeumung: keine Worktrees/Phase-
      Branches mehr (alle entfernt), keine per-run-Skripte dieser Kette in
      .claude/workflows/runs/, PLAN-GEO-NUMMERN.md (andere Kette) bewusst untracked
      gelassen. FINALE SUITE (Endstand 2026-09-04): npm test Lauf1 5684/5683/1
      (wandernder Spawn-Flake) -> Zweitlauf 5703/5703 fail 0 KOMPLETT GRUEN
      (Beleg-Muster wie Reviewer-/Fix-Agenten-Laeufe); test:gates 3 rot (GAP-05/
      GAP-15/E2E-03, per Baseline cd8a88c als vorbestehend belegt); test:abnahme
      "13 von 14" (AS10 bewusst rot, einziges offenes Kriterium der Kette).
      KOSTEN (echte Messung 2026-09-04, temp-HOME-Symlink, nie subagent_tokens):
      ST0 wf_ac26e11f-91a 4,8 Mio (220 Turns) + ST1 wf_e4493e04-490 33,0 Mio (631) +
      ST2 wf_c59e926d-0b5 18,0 Mio (360) + ST3 wf_c4e3da6a-efa 40,2 Mio (622)
      = ~96 Mio Token Workflows gesamt (davon >95 % Cache-Reads), zuzueglich rund 10
      Einzelagenten ausserhalb der Workflows (Audio-Forensik, Fix-/Re-Audit-, R7- und
      Anruf-Vorbereitungs-Agenten). Beobachtung fuer kuenftige Ketten: 3 Agenten
      liefen deutlich ueber der 150-Turn-Leitlinie (274/201/334) — Implementierungs-
      agenten der phase-impl-Groessenordnung kosten quadratisch.

# EL-Agenten-Qualitaet: Forensik + Strategie-Doc "Agenten-Stimme verbessern" (2026-09-02)

Auftrag: B1 (doppelte Ankuendigung) + B2 (gesprochene Klammermarke "[froehlich]") aus Testanruf
call_mtka4kunn0qy / EL conv_0501m1hddb92f5d8hktsr4cb813m. Lead + Workflow-Orchestrierung
(Eigentuemer-Anordnung); KEINE Code-Aenderungen ohne erneute Freigabe. Doc-only Lauf ->
volle Suite entfaellt (workflow.md 2a, Regel 2).

- [x] 1. FORENSIK (3 Agenten parallel, read-only): EL-Live-Agent (System-Prompt, tts.*,
      Modell), Repo-Landkarte ([el-tags]-Detektor, Registrierung, Prompt-Tests PROMPT-*/GAP-*),
      Historie (Befund 3 vom 18.08.).
      ERWARTET: 3 Berichte mit Quellen (EL-Feldnamen/file:line), Secrets maskiert,
      Telefonnummern maskiert, Luecken als offene Fragen.
      VERIFIKATION: Workflow-Rueckgabe: je summary vorhanden; kein Secret-Muster und keine
      vollstaendige E.164-Nummer im Rueckgabetext (Lead-Stichprobe per grep).
      BELEG (Run wf_af77fc54-7f2): 3 Berichte mit Quellen; version_id des Live-Agenten
      identisch mit Testanruf-conv -> Konfig = Vorfalls-Konfig. Kern: B2 suggested_audio_tags
      LEER, Prompt verbietet Klammern explizit -> [froehlich] = Improvisation,
      tts.expressive_mode=true als Gegen-Sog-Vermutung; B1 beide Ankuendigungen in EINER
      Generation, erster Satz passt aufs soft_timeout-Filler-Profil (2.0 s vs. 2.067 s TTFB).
      Kein Pinning-File "registrierung.js" fuer Agenten - Pin ist
      elevenlabs/agent_configs/outbound-agent.template.json (38 Felder) + drift/push-Skripte.
      Lead-Grep auf Doc: kein Secret/E.164-Treffer.
- [x] 2. STRATEGIE-DOC tasks/PLAN-AGENTEN-STIMME.md: Optionen O1 EL-Prompt-Regeln (de/en/fr
      konsistent), O2 Pin in Registrierungs-Vorlage (Befund-3-Mechanik), O3 Detektor B1 nur
      Diagnose (Art. 50 AI Act, nie Transkripte strippen); Phasenplan mit ABNAHME-<ID>-Kriterien;
      offene Owner-Entscheidungen.
      ERWARTET: Datei existiert mit Pflichtabschnitten, ohne Umlaute, ohne Secrets/PII.
      VERIFIKATION: grep '^## ' tasks/PLAN-AGENTEN-STIMME.md zeigt Pflichtabschnitte;
      grep -c '[äöüÄÖÜß]' tasks/PLAN-AGENTEN-STIMME.md = 0.
      BELEG: grep '^## ' -> 8 Pflichtabschnitte (Zeilen 9/27/116/138/258/277/362/391);
      Umlaut-Grep = 0; Secret/PII-Grep kein Treffer. Phasen ST0-ST5 mit ABNAHME-Kriterien,
      7 offene Owner-Entscheidungen.
- [x] 3. PRE-MORTEM-Abschnitt im Doc: je Risiko Entscheidung vermeiden/entschaerft/akzeptiert.
      ERWARTET: Abschnitt "## Pre-Mortem" mit Tabelle; Massnahmen zurueck in den Phasenplan.
      VERIFIKATION: grep 'Pre-Mortem'; Abnahme-Agent prueft mit.
      BELEG: Abschnitt Zeile 362; 10 Risiken R1-R10, je Entscheidung (8x entschaerft,
      1x vermeiden, 1x bewusst akzeptiert), Massnahmen in Phasenplan zurueckgeflossen.
- [x] 4. CLEAN-CODE-GATE (.claude/refs/clean-code.md): S1/S2-Blocker im Entwurf; G5 keine zweite
      Wahrheit neben src/i18n/prompts/*.js; keine Magic Strings; Kommentar-Konvention.
      ERWARTET: pass=true nach hoechstens einer Fix-Runde.
      VERIFIKATION: Review-Verdict pass=true, blockers=[].
      BELEG: Runde 1 pass=false (3 Blocker: Umlaute "Gruens-Bedingung"/"verdaechtigen",
      G5 Wahrheits-Kette Vorlage vs. i18n, +1) -> Fix-Runde -> Runde 2 pass=true,
      blockers=[]; 3 kleinere findings (u.a. G11: 'pacing' fehlt in den i18n-Ableitungen -
      fuer ST1 notiert).
- [x] 5. ABNAHME: Doc gegen eigene Abnahmekriterien; Stichprobe file:line-Referenzen (5+).
      ERWARTET: pass=true, blockers=[].
      VERIFIKATION: Abnahme-Verdict; danach Kostenmessung per temp-HOME-Symlink
      (Memory workflow-kosten-claude-zai-pfad) + node scripts/workflow-kosten.mjs <run-id>.
      BELEG: Abnahme pass=true, geprueft=44, blockers=[], Stichprobe 17 Referenzen
      (outbound.js:493/513-524/944/1036-1046, convai.js:96/108/138-155/217,
      de.js:36-43, Tests, Vorlage, gq-doc) alle ok; 1 Einschraenkung dokumentiert
      (gq-Zitat ist Paraphrase). KOSTEN (workflow-kosten.mjs, temp-HOME): 8,0 Mio Token
      gesamt, davon 7,4 Mio Cache-Reads, Output 146k, 384 Turns, 9 Agenten, ~29 min;
      workflow-Anzeige subagent_tokens 0,64 Mio erneut ~12x zu niedrig.
      Doc-only Lauf: kein Code geaendert, Suite nicht noetig; nichts committet.
- [x] 6. Owner-Entscheidungen eingeholt und dokumentiert (2026-09-02, alle 7 im Sinne der
      Doc-Empfehlung): 1 Mitschnitt-Testanruf in ST0, 2 expressive_mode anlassen mit
      Escalations-Schwelle, 3 ignore_default_personality per A/B in ST4 messen, 4 Pin minimal
      erweitern (use_llm_generated_message + max_soft_timeouts_per_generation), 5 B1-Heuristik
      nur Diagnose mit Gegenprobe-Pflicht, 6 Zaehlfeld [el-tags]/[el-b1] am Call-Datensatz,
      7 first_message-Erlaubnis in ST0 mitlesen (Weiterverfolgung OC-Kette).
      ST0-Start: "noch nicht" - Kette startet auf Kommando.
      ERWARTET: je Entscheidung eine "Entscheidung 2026-09-02 (Owner)"-Zeile im Doc.
      VERIFIKATION: grep -c 'Entscheidung 2026-09-02 (Owner)' tasks/PLAN-AGENTEN-STIMME.md
      -> 7; Umlaut-Grep bleibt 0.

# KV2-11: EL-Settlement freigeben + Deploy KV2-10/11 (2026-09-02)

- [x] 1. KV2-11 gebaut und gemergt (merge d0bf81b, Phase phase/task-impl 4c0ed9d):
      EL-Riegel aus sweepDarfKorrigieren entfernt, B6-Schutz lebt in
      istVollBelegt/dataComplete. Gate PASS (Safety FREIGABE, Clean-Code PASS),
      Suite auf master 5683/5683 gruen. Spec tasks/kostenv2/spec-kv2-11.md,
      Tests test/kv2-11-el-settlement.test.js (6 Faelle).
      VERIFIKATION: npm test -> "# pass 5683 / # fail 0".
- [x] 2. Deploy KV2-10+11: ERLEDIGT 2026-09-02 12:26 MESZ. gh-Login (Antonio20045)
      erneuert; upstream-Divergenz (2 Website-Commits, Analytics-Consent +
      Login-Redirect-Guard) sauber gemergt (9b6b197), beide Suiten gruen
      (Backend 5664/5664, Web 195/195), push zu BEIDEN Remotes, Render-Deploy
      dep-dabvj9btqb8s73dn7fn0 live auf 9b6b197.
      BELEG: /healthz -> {"ok":true,"commit":"9b6b197..."}; DB-Migration gelaufen
      (call_cost_evidence-Tabelle + cost_profile-Spalte in Prod-DB je count=1).
- [x] 3. ERLEDIGT 2026-09-02 19:33 MESZ: EL-Testanruf call_mtka4kunn0qy (42 s,
      17:57 MESZ) komplett durch die KV2-Kette. BELEGE (Prod-DB):
      elevenlabs_convai vorlaeufig 8.086.110 µct bei Anrufende -> im 17:26-UTC-
      Sweep gereift zu belegt (el_reifung=bestaetigt(1), el_abweichung=0);
      telnyx_sip belegt 4.010.000 µct; cost_trued_at=17:26:39Z,
      cost_trued_source=kostenbuch_vollbeleg, actual_cost_micro_cents=12.096.110
      (= exakte Belegsumme). ERSTATTUNG: spend_month 2026-09 60 -> 41 ct,
      cost_eur 15.92 -> 15.73 (delta -19 ct = Prognose: 12,096 US-ct x 0,92
      = 11 ct gegen 30 ct Schaetzung). Sweep-Zeile: "abschluesse=vollstaendig(1)".
      Altanrufe: 13x telnyx_sip-only Teilbeleg, 0 ct bewegt (B6-Schutz live).

# Durchgang 2026-08-19 (2): EL-Weg LIVE bringen — ERLEDIGT bis auf 2 Restpunkte

Auftrag: "mache alles, was du jetzt gesagt hast"; Nachtrag: KEIN Testanruf.

- [x] 1. Merge upstream/master: Richtung GEDREHT (HEAD=upstream, Commit 047f8c6) -
      Begruendung und Hergang in .fortschritt.md (Suppressions-Gate zaehlt beim
      Merge die Gegenseite als Bewegung). 7 Konflikte aufgeloest, ingest-Datei
      regulaer bereinigt (recordHangupOutcome/endStatusFor auf Modulebene).
      BELEG: Hook gruen ohne neuen Altlast-Eintrag; 57 Ingest-Tests gruen.
- [x] 2. Suite: 4888/4888 gruen auf dem Endbaum. (Huerde: nodemailer fehlte -
      npm install, nicht nur lockfile; dazu Zombie-Suite von 09:25 gekillt.)
- [x] 3. Push origin + upstream: beide auf 047f8c6.
- [x] 4. Render-Inventur: Service vodafone-agent srv-d8m0fhflk1mc73bno570,
      autoDeploy=no; hermes-web hat NICHT mitdeployt (Marketing-Gate intakt).
- [x] 5. Env additiv gesetzt (merge): EL-Outbound-Flag+IDs+Tool-Token,
      LOOKUP_ENABLED, EXA_API_KEY, Consult-Flags. BELEG: Boot-Banner
      "In-Call-Nachschlag: AKTIV ... EXA_API_KEY gesetzt".
- [x] 6. Deploy dep-da2rc3b7uimc73b91g50 live; /healthz zeigt 047f8c6.
- [x] 7. Owner-Tenant allowLookup: BELEGT per psql-Readback (19.08. abends,
      nach Allowlist-Fix): Admin-Tenant t_user_01KX600834GCJFV9GTZQKWZMTH traegt
      allowLookup=true SEIT der AL-Aera - live wirksam seit dem 15:57-Boot,
      kein Write, kein Neustart noetig. Die zwei Member-Tenants (weitere
      WorkOS-Logins des Owners) stehen auf false; optionaler Owner-Befehl ist
      in der Session uebergeben (DB-Writes blockt der Classifier fuer Agenten).
      NEBENBEFUND: DB-Allowlist jetzt 0.0.0.0/0 (Owner selbst, s. PLAN-SECURITY);
      Render-API-Key liegt in ~/.config/hermes/render-api-key.
- [x] 8. Routen-Smoke: POST lookup/consult ohne Token -> 403 (vorher 404);
      Server-Log zeigt "[el-lookup] abgelehnt grund=token". healthz 200.
- [ ] 9. Prod-Smoke-Anruf: AUSGELASSEN (Eigentuemer-Ansage "kein Testanruf").
      Der naechste MCP-Anruf ist der Beleg - kann zugleich die offene
      get_consult-Probe sein (Frage stellen, die NICHT im Briefing steht).
- [x] 10. Doku (.fortschritt.md Cutover-Eintrag), Commit, Push beide Remotes,
      Caffeinate aus.

## Geo-Nummern-Strategie (Start 2026-09-01, Workflow geo-nummern-strategie)

- [x] 1. Strategie-Doc PLAN-GEO-NUMMERN.md erstellt: Telnyx-Regulatorik (KYC/Requirement
      Groups), Laender-Matrix, Interims-US-Nummer-Konzept, Zustandsmaschine Swap,
      Phasenplan mit Gates, Pre-Mortem, offene Owner-Entscheidungen.
      ERWARTET: Datei existiert, alle Pflichtabschnitte vorhanden, Abnahme-Agent
      pass=true und blockers=[].
      VERIFIKATION: Workflow-Abnahme-Verdict; grep '^## ' PLAN-GEO-NUMMERN.md zeigt
      die Pflichtabschnitte; grep -c '[äöüÄÖÜß]' = 0.
      BELEG: Abnahme pass=true, geprueft=8/8, blockers=[] (Run wf_31f308d2-6b8);
      11 H2-Pflichtabschnitte vorhanden; Umlaut-Grep = 0; 768 Zeilen.
- [x] 2. Fakten gesichert: jede Telnyx-Kernaussage im Doc traegt eine Quelle,
      Unsicherheiten als UNBESTAETIGT markiert, file:line-Referenzen stimmen.
      ERWARTET: Fakten-Check-Linse und Abnahme melden 0 Abweichungen nach Fix-Runde.
      VERIFIKATION: Abnahme-Verdict blockers=[]; Stichprobe per grep im Repo.
      BELEG: Fakten-Check-Linse 6 Befunde, alle in Fix-Runde 1 eingearbeitet
      (23/23 angewandt, 0 widerlegt); Abnahme-Stichprobe 5 file:line ok.
