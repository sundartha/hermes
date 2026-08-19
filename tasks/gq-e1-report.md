# Phase GQ-E1 — Eröffnungs-Komposition (Detailbericht)

**Ziel:** ein kohärenter gesprochener Eröffnungssatz — kein Doppelpunkt-Rahmenbruch, kein
Du/Sie-Registerbruch, keine Doppelfrage.

**Gate:** PASS
**finalBranch:** `phase/gq-e1-eroeffnung-fix1`
**headCommit (Impl):** `debafa707037d27f6e2211bf8d9d65a6024085d0`
**Basis:** `master` b036b00

---

## 1. Plan (gekürzt)

Grundlage: `tasks/gq-e1-spec.md`, `tasks/gq-strategie-2026-08-19.md`, `.claude/refs/clean-code.md`.
Keine neue Datei, keine neue Dependency, keine Gate-Berührung.

### Blast-Radius (gemessen)
- **Produktion:** `src/elevenlabs/opening-line.js`, `src/elevenlabs/opening-line-llm.js`,
  `src/elevenlabs/call-locale.js`, `src/i18n/locales.js`
- **Anbieter-Vorlage:** `elevenlabs/agent_configs/outbound-agent.template.json`
- **Tests:** `test/el-opening-line.test.js`, `test/elevenlabs-torzustand.test.js`,
  `test/elevenlabs-anrufstart.test.js`, `test/elevenlabs-sprachwahl.test.js` (nur Kommentar)
- **Nicht berührt (belegt):** `src/elevenlabs/outbound.js`, `src/routes/api-calls.js`,
  `src/store/state-ops.js`, `src/store/pg.js`, `src/claude.js`, `src/mcp-tools.js`,
  `elevenlabs/test_configs/*.json` (18 Dateien), alle Gates.

Vorbedingung: `LLM_PROVIDER=anthropic npm test`. Baseline vor Änderung: 4888 Tests
(erwartet 4887 grün/1 Flake, laut Notiz — im Impl-Lauf selbst nachgemessen, s. Deviations).

### Drei Wurzeln, drei Änderungen

1. **Doppelpunkt-Rahmenbruch:** die feste Frage reist neu *im Wert* statt im statischen
   Anbieter-Rahmen. Neue Funktion `composedOpeningLine(reason, locale)` in
   `opening-line.js` — die EINE Stelle, an der komponiert wird: hängt
   `locale.openingQuestion` genau dann an, wenn die Grund-Zeile nicht selbst fragt.
   `providerOpening` (call-locale.js) und alle drei `first_message`-Werte der
   Anbieter-Vorlage enden entsprechend mit `{{opening_line}}` — dahinter kein
   statischer Text mehr.
2. **Du/Sie-Registerbruch:** `de.openingQuestion` „Wie sieht es damit bei Ihnen aus?“ →
   „Wie sieht es damit aus?“; `de.openingReasonFallback` „...mit Ihnen zu klären.“ →
   „...zu klären.“; analog FR („Qu'en est-il ?“, „J'appelle pour régler une petite
   demande.“). EN unverändert (kein Register im Englischen). `bridgePhrase` bleibt in
   allen Sprachen unangetastet — Telnyx-Weg byte-identisch.
3. **Doppelfrage:** `validOpeningLine` lässt neu eine Zeile zu, die AM ENDE fragt
   (`SENTENCE_END` neu `/[.!?]$/`), lehnt aber zwei Fragen bzw. ein Fragezeichen mitten
   im Satz weiter ab (neuer Wächter `fragtHoechstensAmEnde` — eine Prüfung kommt DAZU,
   keine fällt weg). `bridgedObjective` lässt einen bereits fragenden Auftrag ohne
   Brücken-Rahmen durch, sonst wird ein mitgebrachtes `[.!]` gestrichen, damit
   `bridgePhrase` genau ein Satz-Endzeichen setzt.

### Reihenfolge-Invariante
Komponiert wird auf der SCHREIBSEITE (`fetchOpeningLine`, vor `createCall`, also vor dem
Annahme-Hash). `verifiedOpeningLine` gibt den gespeicherten Wert weiterhin byte-genau
zurück und komponiert nur den selbst erzeugten Rückfall.

### Tests (Plan)
- Bestand mitziehen: Erwartungswerte in den vier o.g. Testdateien auf `composedOpeningLine`-
  Ergebnisse umstellen (Helfer `komponiert(reason, lang)`, nie getippt).
- 11 neue Fälle `GQ-E1-01` bis `GQ-E1-11` (Präfix trifft keinen Katalog-/Abnahme-Pattern,
  bleibt im Regressionslauf): Befundfall byte-genau (01), Frage-Zeile gültig (02),
  Rotprobe Doppelfrage/Fragezeichen mittig (03), keine Anrede-Pronomen in DE/FR (04),
  Rahmen endet mit Variable (05), Deckel-Arithmetik `OPENING_QUESTION_MAX_CHARS=40` (06),
  ganzer gesprochener Satz je Sprache (07), Komposition beide Richtungen (08), Stufe 2
  mit Frage-Auftrag ohne Rahmen (09), Stufe 3 komponiert (10), Prompt-Pin (11).
- Eine überholte Rotprobe (verbot Fragezeichen-Ende generell) entfällt, Zusage lebt in
  02/03 weiter.

### Deploy-Reihenfolge (Plan Abschnitt 8, Eigentümer-Pflicht)
`npm run elevenlabs:push` aus dem Branch, danach `npm run elevenlabs:drift` — zwingend
VOR dem Deploy. Zwischenzustand „Code deployt, Vorlage nicht gepusht“ ergäbe zwei
aufeinanderfolgende Fragen und wäre schlechter als der heutige Defekt.

### Bewusst offen / außer Scope
- 18 `elevenlabs/test_configs/*.json` setzen `opening_line` weiterhin als Aussagesatz
  (Spec §7 explizit außer Scope) — kein `elevenlabs:check`-Fund.
- `voicemail_message` bleibt unverändert (E-O5, akzeptiert).
- 42-Dateien-`LLM_PROVIDER`-Bestandsdefekt bleibt unangetastet (Regel 6).

---

## 2. Implementierungs-Zusammenfassung

Vollständig gemäß Plan umgesetzt, 9 Dateien, 1 Commit (`debafa7`), keine neue Datei,
keine neue Dependency, keine Gate-Datei im Diff.

**Geänderte Dateien:**
- `src/elevenlabs/opening-line.js`
- `src/elevenlabs/opening-line-llm.js`
- `src/elevenlabs/call-locale.js`
- `src/i18n/locales.js`
- `elevenlabs/agent_configs/outbound-agent.template.json`
- `test/el-opening-line.test.js`
- `test/elevenlabs-anrufstart.test.js`
- `test/elevenlabs-torzustand.test.js`
- `test/elevenlabs-sprachwahl.test.js`

**Befund-Anker (GQ-E1-01):** Fall `call_mt0ddduxuzgl` byte-genau gepinnt — Auftrag
„Ich wollte fragen, ob du morgen um 15 Uhr Zeit für eine Runde Tennis hast.“ ergibt jetzt
„...hast. Wie sieht es damit aus?“ — ein Register, ein Fragezeichen, kein doppeltes
Satzzeichen.

**Tests:** Baseline 4888 (selbst gemessen) → 4898, alle grün, 0 rot.
`node --check` grün auf alle vier `.js`, JSON-Parse der Vorlage grün, `npm run
elevenlabs:check` grün, Smoke gegen echten Server bestanden (GET /healthz 200; je Sprache
der ganze gesprochene Satz geprüft — genau ein Fragezeichen, kein doppeltes Satzzeichen,
Offenlegung wörtlich am Anfang).

**cleanCodeSelfCheck (Auszug):** G5/S2 Komposition existiert genau einmal; G25 alle
bedeutungstragenden Literale benannt; G35 `OPENING_QUESTION_MAX_CHARS` bewusst nicht in
`config.js` (Modul-Invariante, kein Betriebsparameter); F1/G30/G34 Argumentzahlen/
Verschachtelungstiefe im Rahmen; C2 betroffene Kommentare mitgezogen; C5/G9/G12/T4 kein
toter Code, überholte Rotprobe gelöscht statt deaktiviert; Umlaut-Regel eingehalten
(gesprochene Strings mit Umlauten, Kommentare deutsches ASCII); eslint 0 errors.

### Deviations
1. **Baseline-Abweichung nach oben (kein Befund):** Plan erwartete 4888/4887 grün + 1
   bekannter Spawn-Flake. Selbst gemessen vor der ersten Änderung: 4888/4888 grün, 0 rot
   — der Flake trat nicht auf. Nach Änderung entsprechend 4898/4898 grün statt
   4897+1. Rechnung 4888 − 1 + 11 = 4898 bleibt exakt.
2. **node_modules-Symlink:** vorgegebene Form erzeugte im Worktree einen zirkulären
   Selbstverweis; ersetzt durch Symlink auf das node_modules des Haupt-Repos. Nicht
   committet (gitignored, Status sauber).
3. **Zusätzlich zum Plan:** in `test/el-opening-line.test.js` mussten
   `OPENING_LINE_VARIABLE` und `OWNER_NAME_VARIABLE` als benannte Konstanten eingeführt
   werden (Plan nannte sie nur für `elevenlabs-anrufstart.test.js`), weil `GQ-E1-07`
   ebenfalls in `el-opening-line` den Rahmen zusammensetzt — nackte Literale wären
   G25-Verstoß gewesen.
4. **T5 (e) in `elevenlabs-anrufstart.test.js`:** die geplante „analoge Meldung“ war
   nicht nötig, da die Meldung dort den Ausdruck „Brücke + Frage“ gar nicht enthielt —
   Zusicherung blieb unverändert grün.
5. **`npm run test:gates` (darf rot sein):** 3 rote Fälle (GAP-05 Stripe
   allow_promotion_codes, GAP-15 EN-Fassung Rechts-Slug, E2E-03 Polly.Vicki vs.
   Azure.de-DE-KatjaNeural) — alle außerhalb der berührten Fläche (Billing, Rechtstexte,
   TTS-Stimmenwahl), Bestandsbefunde, nicht durch diese Phase entstanden.
6. **Offene Eigentümer-Handlung, bewusst nicht Teil des Commits, zwingend vor Deploy:**
   `npm run elevenlabs:push` + `npm run elevenlabs:drift` aus diesem Branch. Ohne Push
   wirkt R1 nicht am Konto; Zwischenzustand wäre schlechter als der heutige Defekt.
7. **Bewusst offen (Spec §7):** die 18 Anbieter-Testdefinitionen unter
   `elevenlabs/test_configs/*.json` setzen `opening_line` weiterhin als Aussagesatz —
   Realismus-Verlust der Testdefinitionen, kein `elevenlabs:check`-Fund.

---

## 3. Safety-Urteil

**FREIGABE (approved: true).**

Unabhängige Prüfung in frischem Worktree (`review-gq-e1-r1`, HEAD `ec54441`, direkt auf
`master` b036b00, sauber, kein `.env` im Worktree).

- Regressionsbank (Standard-Env): 4917/4917 grün (korrigiert 4898/4898), exit 0, 147 s.
  Deckt json- und pg-Backend ab.
- Pflichtlauf `LLM_PROVIDER=anthropic`: 4898/4897 grün, 1 rot —
  `test/b2-quota-gate.test.js:189`, isoliert grün (Spawn-Flake, kein GQ-E1-Bezug, Quota-/
  Billing-Gate außerhalb Diff).
- pg-Backend explizit (4 Dateien): 57/57 grün.
- 11 neue `GQ-E1-*`-Fälle im Regressionslauf nachweisbar grün, korrekt eingeordnet
  (weder i18n-Katalog- noch Abnahme-Pattern getroffen).
- `elevenlabs:check` grün, `node --check` grün.
- Eigene Gegenprobe (10 Proben, alle grün): Offenlegung byte-identisch je Sprache;
  ganze Eröffnung beginnt mit Offenlegung, genau ein „?“, endet darauf;
  `validOpeningLine` lehnt bei Frage-Endung weiterhin Länge>120, verbotene Zeichen,
  Preise, Offenlegungs-Wiederholung, Doppelfrage, mittiges Fragezeichen, fehlendes
  Satzende ab; `bridgedObjective` korrekt (null bei unbrauchbar, ein Satz-Endzeichen,
  Frage-Auftrag ohne Rahmen); Deckel-Arithmetik hält; Hash-Kette scharf;
  `providerOpeningFor` endet je Sprache auf `{{opening_line}}`; `bridgePhrase`
  byte-identisch (Telnyx-Weg unberührt).

**Diff-Umfang:** 9 Dateien, 370+/56−. Unberührt: `src/claude.js`, `src/bridge.js`,
`src/config.js`, `src/routes/**`, `src/telephony/**`, `src/store/**`, `src/auth.js`,
`src/web-auth.js`, `src/middleware.js`, `src/route-policy.js`, `package.json`.

**Safety-Gates:** kein Gate im Diff. Denylist/Land/Stundenlimit/Budget/Max-Dauer,
`OUTBOUND_FROZEN`, Abo+KYC-Permit, Telnyx-Ed25519 unangetastet. `OPENING_LINE_MAX_CHARS`
bleibt 120; `validOpeningLine` verliert keine Prüfung (nur `fragtHoechstensAmEnde` kommt
dazu). Store-Schema/`createCall`/`openingLineHash` unverändert.

**Offenlegung:** `disclosureSentence` in `claude.js`/`bridge.js` nicht im Diff;
`LOCALES.*.disclosure` byte-identisch. Bleibt wörtlich und allererster Satz.

**Auth/Secrets/Audio/Scope:** keine Route/Middleware/Policy berührt; kein Secret/PII im
Diff; Log bleibt `quelle=`+`zeichen=` ohne Auftragstext; kein MCP-Pfad berührt; keine
neue Dependency; einzige Spec-Abweichung: `fetchOpeningLine` bildet `[reason, source]`
als ein Tupel statt zweier paralleler Ketten (Review-Befund aus Runde 1, verhaltensgleich).

**Verhalten:** EL-Weg abgeschaltet → Telnyx-/Budget-Weg byte-identisch (eigens
nachgemessen). Notaus `openingLineLlm=false` fällt weiter ohne LLM-Aufruf auf Stufe 2/3.

### Concerns (merge-verträglich, teils Deploy-bindend)
1. **Deploy-Reihenfolge (hart, operativ):** Code allein ergibt erst mit dem
   Anbieter-Push einen kohärenten Satz. Code ohne Push → zwei aufeinanderfolgende
   Fragen (schlechter als heutiger Defekt); Push ohne Code-Deploy → Eröffnung ohne
   Frage, Rückfall in den 11-s-Stille-Befund aus Anruf 6. Kein automatischer Riegel,
   nur manuelles `elevenlabs:drift`.
2. `voicemail_message` trägt weiterhin statischen Text hinter der Variable — stellt
   einem Anrufbeantworter künftig eine Frage (E-O5, akzeptiert).
3. Die 18 Anbieter-Testdefinitionen bilden die echte Eröffnung nach dem Push nicht mehr
   ab (enden nicht auf Frage) — bewusst nicht angefasst (Spec §7).
4. `OPENING_QUESTION_MAX_CHARS` (40) nur testseitig durchgesetzt, nicht zur Laufzeit.
5. Bestand, nicht durch diese Phase eingeführt: `openingLineHash` ist ungeschlüsseltes
   SHA-256 — schützt gegen versehentliche Veränderung, nicht gegen DB-Schreibzugriff.

---

## 4. Clean-Code-Audit (final)

**Verdict: PASS.** Keine S1/S2-Befunde.

- **s1 (Blocker):** keine
- **s2 (Muss vor Merge):** keine
- **s3 (Kann, nicht blockierend):**
  - N1/G16 · `src/elevenlabs/opening-line-llm.js:167-176` (`fetchOpeningLine`) —
    verschachtelter Ternary zur Tupel-Bildung `[reason, source]`, liest sich nicht auf
    den ersten Blick trotz erklärendem Kommentar. Vorschlag bei nächster Berührung:
    kleine benannte Helper-Funktion statt geschachteltem Ternary. Kein Blocker.
- **s4 (Hinweise):**
  - Keine „later“-Deaktivierungen, keine abgeschalteten Checks gefunden — PASS.
  - `composedOpeningLine` sauber als eigene reine Ein-Zweck-Funktion exportiert, an
    genau zwei Stellen verwendet — kein Layer ohne Mehrwert.

**passNotes (Auszug):** P1/G5 keine parallele Kompositionslogik mehr; T5/P14 Grenzfälle
gut abgedeckt (Frage-Zeile gültig, Doppelfrage/mittiges Fragezeichen ungültig,
Deckel-Arithmetik, beide Kompositionsrichtungen je Sprache, Prompt-Pin); Tests bauen
Erwartungen dynamisch aus `LOCALES`/`composedOpeningLine`; EN-Locale bewusst
unverändert (kein Anrede-Register), `GQ-E1-04` grenzt das explizit ein; Magic Numbers
sauber benannt; kein toter/auskommentierter Code, keine TODO/FIXME.

**topTodos (optional, kein Blocker):**
1. Verschachtelten Ternary in `fetchOpeningLine()` bei nächster Berührung in benannte
   Helper-Funktion auflösen.
2. Bei künftiger 4. Sprache prüfen, ob sie eine Du/Sie-artige Anredeform hat, und ggf.
   `SPRACHEN_MIT_ANREDEFORM` (Test) sowie zugehörigen `openingQuestion`/
   `openingReasonFallback`-Baustein mitziehen.

---

## 5. Fix-Runden

**Runde r1 (einzige Runde):** G5-Blocker behoben — `fetchOpeningLine`
(`src/elevenlabs/opening-line-llm.js`) bildete `reason` und `source` über zwei
parallele Ternary-Ketten mit denselben drei Bedingungen (generated/bridged/Fallback).
Ersetzt durch ein einziges `[reason, source]`-Tupel pro Fallstufe, danach ein
`composedOpeningLine`-Aufruf. Danach: PASS in Safety und Clean-Code.
