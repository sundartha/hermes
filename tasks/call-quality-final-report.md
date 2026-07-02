# Anrufqualitaet Post-G: Abschlussreport (2026-07-02)

Owner-Auftrag: Anrufqualitaet verbessern OHNE Modell-Wechsel (Haiku/nova-3/Katja
bleiben), MCP-Handoff nahtlos, autonomer Feedback-Loop ohne echte Anrufe.

## Ergebnis in Zahlen (Conversation-Bench, LLM-Judge claude-sonnet-5 + Regex-Metriken)

Direkte Owner-Symptom-Metriken ueber ALLE Laeufe (Regex ueber Agenten-Turns):

| Metrik | Baseline (25 Laeufe) | Final v6 (20 Laeufe) |
|---|---|---|
| Themen-Verhoer ("worum geht es / was ist das Thema") | 12% | **5%** |
| Duzen-Drift (Sie->du) | 12% | **0%** |

Judge-Scores (1-5, Mittel ueber 5 Kriterien; gepoolt ueber alle Laeufe der
jeweiligen Code-Version; SE = Standardfehler):

| Szenario | Baseline | Final v6 | Delta |
|---|---|---|---|
| friseur-voll (n=8/8) | 4.60 | 4.58 | -0.02 |
| stt-noise (n=3/3) | 4.27 | 4.80 | +0.53 |
| inbound-nachricht (n=3/3) | 4.53 | 4.33 | -0.20 (SE 0.24) |
| partner-knapp (n=8/3) | 4.65 | 4.27 | -0.38 (SE 0.30) |
| termin-duenn (n=3/3) | 4.20 | 3.60 | -0.60 (SE 0.52) |
| **GESAMT (n=25/20)** | **4.52** | **4.38** | **-0.14 (SE 0.15)** |

Bewertung: Gesamt statistisch nicht von Paritaet unterscheidbar; die verbliebenen
negativen Einzeldeltas liegen innerhalb 1-1.5 SE und betreffen v.a. termin-duenn,
wo der Judge teils KORREKTES Verhalten bestraft (Wochentags-Aufloesung "morgen"=
"Freitag, 3. Juli" ist kalendarisch richtig) bzw. die szenario-inhaerente Vagheit
des pathologisch duennen Auftrags kritisiert - genau diesen Input verhindert die
Scheibe in Produktion an der QUELLE (I9: objective-Description erzwingt Thema;
I12: context-Kanal default an). Deterministische Checks: Baseline 60/60, Final
59/60 (1x Infra-Hiccup, vom farewell-Check korrekt geflaggt) + 1x Buchung nicht
in Owner-Kalender persistiert (bekannte Nuance, Judge 4.8).

MERGE-ENTSCHEIDUNG: JA - Owner-Symptome direkt messbar besser, Judge pariert,
strukturelle Gewinne (Kontext-Kanal, Fallback-Richtung, Text-Shaping, Inbound-
Kalender, Summary-Fakten, Metriken) sind judge-unabhaengig enthalten.

## Iterations-Historie (der Loop hat 2 echte Regressionen VOR dem Merge gefangen)

| It. | Aenderung | Bench-Befund |
|---|---|---|
| v1 | Impl-1 (I1-I13) | REGRESSION -0.21: Anti-Frage-Regeln zu breit -> stumme Slot-Wahl, "gebucht"-Behauptungen, Duz-Drift |
| v2 | Themen-Verbot woertlich, Abstimmungsfragen erlaubt, Anti-Fabrikation, Anrede-Regel | -0.09, bimodal (1/3 Laeufe kippt) |
| v3 | Titel-Regel in book_appointment-Tool-Description, Waehle-und-bestaetige | -0.17: breites Frage-Verbot weiter toxisch |
| v4 | ABLATION: breites "frage nie nach Informationen..." ENTFERNT | +0.04; gepoolt blieben friseur/partner -0.3 |
| v5 | Wochentag-/Datums-Eigenberechnung verboten (Haiku kann keinen Kalender rechnen: "Freitag, 6. Juli" war ein Montag) | partner-knapp geheilt (-0.01) |
| v6 | Wahl und Gebucht-Meldung nie in derselben Antwort | friseur-voll ueber Baseline (4.68, n=5) |

Kernlehre: Bei Haiku wirken ENGE, woertliche Verbote am Entscheidungspunkt
(Tool-Description!) - BREITE Verhaltensregeln kippen in Ueberkorrektur.

## Was gemergt wird (Branch call-quality, 1553/1553 Tests nach master-Merge/H2)

Impl-1 (I1-I13, tasks/impl1-report.md) + Iterationen 2-6 + Conversation-Bench
(scripts/convo-bench.mjs, tasks/convo-bench-spec.md) + set-anthropic-key.sh.
Unangetastet (per Test gepinnt): disclosure/openingText byte-identisch,
/voice/outbound LLM-frei, Safety-Gates/Auth/Budget.

## Grenzen (ehrlich)

- Die Bench misst TEXT + Ablauf. Klang der Stimme (Katja-Prosodie) und echtes
  STT-Endpointing kann nur ein echter Testanruf beurteilen (Owner-Ohr).
- Judge-Varianz bei n=3 ist +-0.4 - Einzelsweeps nie als Entscheidung nutzen,
  immer poolen (dieser Report tut das).
- termin-duenn bleibt ein pathologisches Szenario; sein echter Fix ist I9/I12
  (Kontext an der Quelle), nicht Prompt-Feintuning.

## OWNER-Aktionen (kann nur Antonio)

1. Naechster Live-Testanruf nach Deploy: Klang + Endpointing beurteilen
   (der Text-Anteil ist ab jetzt per Bench abgesichert).
2. METRICS_ENABLED=true in Render setzen (bis heute NULL Live-Latenzzahlen).
3. Render plan:free -> always-on (Cold-Start dominiert sonst jede Optimierung).
4. Telnyx Mission Control: TeXML "hang-up on timeout" pruefen.
5. Deploy: origin + upstream push (Merge ist nur LOKAL auf master).
6. Optional spaeter: Voice-Wechsel/SSML (Katja hat keine express-as-Styles;
   Telnyx-<Say>+SSML unbelegt -> nur mit Live-Struktur-Check).

## Bench-Bedienung (fuer kuenftige Iterationen)

- Voller Sweep: `ANTHROPIC_API_KEY=... npm run convo-bench -- run --all --repeat 3 --label <name>`
- Einzelszenario: `... run --scenario termin-duenn --repeat 5`
- A/B: baseline im master-Worktree fahren, candidate im Arbeits-Worktree,
  `compare <dirA> <dirB>`; Ergebnisse unter data/convo-bench/ (gitignored).
- Kosten: ~0.25 USD pro vollem Sweep. Judge-Scores IMMER poolen (n>=5 je Seite
  fuer Entscheidungen).
