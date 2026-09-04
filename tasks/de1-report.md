# Phase DE1 — Sprach-Ruckfall auf die englische EL-Basis beseitigen

**Gate:** PASS
**finalBranch:** `phase/de1-impl-fix1`

## Problem

Der ElevenLabs-Anrufbeantworter-Text (`voicemail_message`) lag als statischer englischer
Volltext am Agenten. Ein deutscher Anruf, der auf Mailbox lief, hinterliess trotz
deutscher Eroeffnung eine englische Nachricht — Ruckfall auf die englische Basis,
inklusive einer zweiten, nicht sprachlich passenden Art.-50-Offenlegung.

## Plan (gekuerzt)

**Schritt 0 (blockierend, nur lesend):** Messung gegen den Live-Agenten
(`agent_5301kwkh9vv3ezesf100pggfj9rs`) und das Anbieter-Schema
(`https://api.elevenlabs.io/openapi.json`) ergab: weder `language_presets.<lang>.overrides`
noch `conversation_config_override` fuehren im Schema einen `built_in_tools`-Zweig —
`voicemail_message` sitzt unter `agent.prompt.built_in_tools.voicemail_detection.params`,
einem Pfad, den beide Uebersteuerungswege nicht erreichen. Preset- und Per-Anruf-Override
sind damit tot. Der tragfahige Weg: `VoicemailDetectionToolConfig.voicemail_message`
unterstuetzt laut Schema dynamische Variablen und loest live bereits `{{owner_name}}`/
`{{opening_line}}` auf — also wird das Feld zu einer neuen dynamischen Variable
`{{voicemail_line}}`, deren Wert pro Anruf in der Sprache des Anrufs komponiert wird.

**Neue Dateien:** keine Produktionsdatei (die Naht existiert bereits in
`src/elevenlabs/call-locale.js`); ein neuer Test `test/el-voicemail-sprache.test.js`.

**Kernaenderungen:**
- `src/i18n/locales.js`: neues `voicemailBody(openingLine)` je Sprache (de/fr/en);
  EN byte-identisch zum bisherigen Live-Text verifiziert.
- `src/elevenlabs/call-locale.js`: neue Funktion `providerVoicemailMessage({locale,
  ownerName, openingLine})` = `[locale.disclosure(ownerName), locale.voicemailBody(openingLine)].join(" ")`
  — dieselbe Reihenfolge/Quelle wie `providerOpeningFor`, Offenlegungssatz bleibt
  strukturell der allererste Satz.
- `src/elevenlabs/outbound.js`: neue Funktion `voicemailText({owner, bundle,
  openingLine})`, liefert `""` bei unversorgtem `{{`-Rest (fail-safe, Bestandsmuster
  von `calleeRelationText`); neue 14. dynamische Variable `voicemail_line` in
  `dynamicVariables(...)`.
- `elevenlabs/agent_configs/outbound-agent.template.json`: `voicemail_message` ->
  `"{{voicemail_line}}"`; `_besitz.felder` und Hinweistexte nachgezogen.
- 18 `elevenlabs/test_configs/*.json`: `voicemail_line: ""` ergaenzt (fuer
  `npm run elevenlabs:check`, das Variablen-Vokabular beidseitig abgleicht).
- Bestandstests angepasst: `el-vorlage-variablen-abgleich` (13->14 Variablen, dritte
  Quelle voicemail_message), `el-stimme-abnahme` (englischer Byte-Pin ersetzt durch
  Platzhalter-Pin + Je-Sprache-Pruefung `startsWith(LOCALES[x].disclosure(...))`),
  `elevenlabs-agent-werkzeuge` (Regel (a) gedreht — Sprache des Anrufs statt fest
  Englisch), `elevenlabs-aussprache` (Pruefung auf `providerVoicemailMessage` statt
  `{{owner_name}}`), `callee-is-owner-elevenlabs` (nur Kommentar).

**Ausdruecklich NICHT angefasst:** `agent.language="en"` (Weltdefault-Ruckfall bleibt),
die drei `language_presets`, `OVERRIDE_ALLOWED_LEAF_PATHS`/Allowlist, alle Safety-Gates
(Budget/Denylist/Land/Stunden/Max-Dauer/Signatur/Auth), die OC-Owner-Selbstanruf-Ausnahme
(gilt weiter nur fur `first_message` — der Anrufbeantworter tragt auch beim Owner-Ziel
den vollen Offenlegungssatz), `npm run elevenlabs:push` (nicht ausgefuhrt).

## Impl-Zusammenfassung

DE1 exakt gemass Plan umgesetzt: `voicemail_message` am ElevenLabs-Agenten tragt jetzt
nur noch den Platzhalter `{{voicemail_line}}`, dessen Wert pro Anruf in der Sprache des
Anrufs komponiert wird (`LOCALES.<lang>.voicemailBody` + der bestehende Offenlegungssatz,
uber `providerVoicemailMessage()` in `src/elevenlabs/call-locale.js`, gefullt in
`src/elevenlabs/outbound.js#dynamicVariables` als 14. dynamische Variable). Neuer
Regressionstest `test/el-voicemail-sprache.test.js` (2 Falle, grun) plus funf angepasste
Bestandstests inkl. aktualisierter Golden-Fixture (`test/fixtures/el-anrufstart-fremdziel.json`).
`npm run elevenlabs:check` meldet OK. Voller Regressionslauf: 5684/5686 grun — die zwei
roten Falle (`el-fixtures-echte-antworten.test.js` Timing-Off-by-one,
`telnyx-p5-origination.test.js` Notification-Race) liegen ausserhalb des Anderungsbereichs,
isoliert je 3/3 grun, Spawn-Parallelitats-Flakes.

Committed auf `phase/de1-impl` (Erstfassung), finaler Stand nach Fix-Runde auf
`phase/de1-impl-fix1` (HEAD `7559e82`, headCommit-Vorlaufer `da05b551...`).

### Deviations (gegenuber Plan)

- Symlink-Fehler in Schritt 1 des Vorgehens (`ln -s ./node_modules node_modules`
  erzeugte im leeren Worktree einen selbst-referenziellen Symlink statt auf das echte
  Verzeichnis im Haupt-Repo zu zeigen) liess `npm run lint` mit ELOOP/Exit 194
  scheitern und den ersten Commit-Versuch falschlich als Linter-Verstoss melden.
  Korrigiert: Symlink auf den echten `node_modules`-Pfad gesetzt.
- Nach der Symlink-Korrektur zwei echte Clean-Code-Befunde sichtbar geworden und
  behoben: Magic Number 20 in `test/el-voicemail-sprache.test.js` (jetzt
  `BAUSTEIN_LAENGE`) und eine zu tiefe Aufrufkette (G36) in
  `test/el-vorlage-variablen-abgleich.test.js#voicemailMessageOf` (jetzt in Stufen
  gelesen, Bestandsmuster aus `el-stimme-abnahme.test.js`).
- `test/fixtures/el-anrufstart-fremdziel.json` (Golden-Fixture OC-P2-A3) musste um das
  neue Feld `voicemail_line` erganzt werden — der Plan nannte fur diese Datei nur eine
  Kommentaranderung (6e), der Golden-Vergleich brach aber mit der neuen 14. Variable.
- `npm run lint` / `npm run elevenlabs:check` lieferten in der Sandbox teils Exit 194
  bei Aufruf uber `npm run` (npm-Wrapper-Artefakt); direkter Skriptaufruf bestatigte
  Exit 0 / "OK".
- `npm run elevenlabs:drift` konnte nicht gegen den Live-Agenten gefahren werden (kein
  `ELEVENLABS_API_KEY` in der Sandbox — fail-closed, wie vorgesehen).
- Voller Server-Smoke-Test (`PORT=3999 SKIP_TWILIO_SIGNATURE_CHECK=true`) erreichte
  keinen `/healthz`-fahigen Zustand (`boot-guard`: "Keine aktive Nummer im Store", kein
  Seed in der isolierten Worktree-`DATA_DIR`). `smokePass=false`, kein Blocker — der
  veranderte Pfad lief stattdessen end-to-end uber die Integrations-Attrappe
  `test/helpers/elevenlabs-anrufstart-attrappe.mjs` (echter `originateCall`-Aufruf,
  kein Netzzugriff).

## Fix-Runde r1 (Scope-Drift-Rucknahme)

Erste Reviewrunde markierte einen Scope-Drift: der Plan sah `agent.language`/den
`HOW YOU SPEAK`-Prompt-Satz ("Begin the call in English.") als unverandert vor (Punkt 7
der Tabelle "was ausdrucklich NICHT geandert wird"), die Erstumsetzung hatte diesen Satz
aber dennoch auf "Speak the language of your first message and stay in it." geandert —
eine Anderung, die JEDEN Live-Anruf betroffen hatte, nicht nur den Voicemail-Fall.

**r1-Fix:** Prompt-Satz und zugehorige Vorlagen-Kommentare auf Bestand zuruckgesetzt;
`test/elevenlabs-agent-werkzeuge.test.js` faellt dadurch vollstandig aus dem Diff heraus.
DE1 spricht seither ausschliesslich fur den Anrufbeantworter-Text die Sprache des
Anrufs; der gesprochene System-Prompt bleibt unverandert beim Bestand.

## Safety-Urteil (final)

**APPROVED.** Alle Kernkriterien erfullt: `testsPassIndependently=true`,
`safetyGatesIntact=true`, `disclosureIntact=true`, `authFailClosedIntact=true`,
`noSecretsLeaked=true`, `scopeRespected=true`, `behaviorAsIntended=true`,
`blockers=[]`.

Unabhangige Nachfahrung auf `review-de1-r1` (= `phase/de1-impl-fix1`, HEAD `7559e82`):
`npm test` Lauf 1: 5686 Tests, 5685 grun, 1 rot (AL-P10-1, isoliert 12/12 grun —
Last-Flake, DE1-fremder Pfad); Lauf 2 (Wiederholung): 5686/5686 grun. Beide Store-Backends
(json-Default + pglite-in-process) laufen grun. `npm run test:abnahme`: 13 von 14
Abnahmekriterien erfullt (unverandert zum Bestand). `npm run lint`: 0 Fehler. Eigene
Messung bestatigt: `LOCALES.en.disclosure("{{owner_name}}") + " " +
LOCALES.en.voicemailBody("{{opening_line}}")` ist byte-identisch mit dem bisherigen
statischen englischen Live-Text.

Diff bleibt vollstandig in DE1 (28 Dateien): Template, 19 Test-Konfigs, drei src-Dateien,
funf Tests + eine Fixture. Keine Gate-Datei im Diff (`outbound-gates.js`, `state-ops.js`,
`config.js`, `route-policy.js`, Routen alle unberuhrt). Kein neuer Endpunkt, kein neuer
Call-/SMS-/Geld-Auslöser. `src/claude.js`/`src/bridge.js` nicht im Diff —
`disclosureSentence` unangetastet. Owner-Selbstanruf (OC) unangetastet: Verkurzung
bleibt allein an `first_message`, der Anrufbeantworter tragt auch dort den vollen Satz.
Keine `eslint-disable`-, `.only`-, Skip-Marker im Diff. `package.json`/Lockfile
unverandert — keine neue Dependency.

### Offene Concerns (kein Blocker, in die getrennte Owner-Push-Freigabe)

1. **Deploy-Reihenfolge ist ein Art.-50-Risiko:** wird die Vorlage an den Live-Agenten
   gepusht, BEVOR der Server-Code mit `voicemail_line` live ist, rendert EL den nackten
   Platzhalter `{{voicemail_line}}` — eine Anrufbeantworter-Nachricht ohne jede
   Offenlegung. Der `_voicemail_message_hinweis` benennt den Preis "Variable fehlt",
   aber nicht die Reihenfolge-Regel "Code zuerst live, Push danach". Gehort in die
   Push-Freigabe.
2. Die Ausflosung von `{{voicemail_line}}` genau in diesem Blatt ist erschlossen
   (Schema-Beschreibung + Live-Verhalten fur andere Variablen), nicht end-to-end
   belegt — die Spec verbietet den Push in dieser Phase, deshalb unvermeidbar. Der
   erste echte Anrufbeantworter nach dem Push braucht eine Hor-/Transkript-Gegenprobe.
3. `voicemailText()` liefert bei einem `{{`-Rest still `""` (= gar keine Nachricht),
   ohne Log-Zeile — Bestandsmuster, aber in der Diagnose unsichtbar. Praktisch nur
   uber einen Auftraggeber-Namen mit `{{` auslosbar (`openingLine` kann es nicht
   tragen, `FORBIDDEN_CHARS` in `src/elevenlabs/opening-line.js` sperrt `{}` bereits).
4. Keine DE1-Berichtsdatei war zum Zeitpunkt der Review im Repo (jetzt mit dieser
   Datei nachgeholt).
5. `npm run elevenlabs:drift` nicht gegen Live gefahren (kein Key/Netz in der
   Sandbox) — die neue Soll-Abweichung auf `voicemail_message` ist nach Spec erwartet,
   solange der Push aussteht.
6. Suite-Flake AL-P10-1 im ersten Volllauf rot, isoliert und im zweiten Volllauf grun —
   last-abhangig, DE1-fremder Pfad, verrauscht aber jede kunftige Abnahme.

## Clean-Code-Audit (final)

**s1 (Blocker):** keine.
**s2 (schwerwiegend):** keine.

**s3 (info/geprueft, kein Fund):**
- `src/elevenlabs/outbound.js:679` (`voicemailText`) — Name unauffallig, Verhalten
  passt: liest wie `calleeRelationText`/`ownerFirstMessage` denselben `{{`-Wachter —
  Konsistenz statt Verstoss.
- `src/i18n/locales.js voicemailBody` — Reihenfolge Offenlegung -> Grund -> Abschied
  korrekt getrennt von `disclosure()` gehalten (G5-Vermeidung explizit kommentiert),
  keine zweite Wortlaut-Quelle.

**s4 (Beobachtung):**
- `src/elevenlabs/call-locale.js` — sehr hohe Kommentardichte (mehr Kommentar- als
  Codezeilen), aber jede Begrundung inhaltlich tragend (G5-Abgrenzung,
  Owner-Entscheidungen, Pfad-Messung) — nicht geflaggt (Vorrang Lesbarkeit).

**Verdict:** PASS. Neues Verhalten durch dedizierte Tests gedeckt, Fail-safe-Pfad folgt
exakt dem Bestandsmuster von `calleeRelationText`/`ownerFirstMessage`, kein Money-Float,
keine Race Condition, kein abgeschaltetes Gate. G5 (Duplizierung) aktiv vermieden:
owner-Ausdruck einmal berechnet und in `owner_name` UND `voicemail_line` wiederverwendet;
`disclosure()` bleibt einzige Quelle des Offenlegungssatzes. Fix-Commit `7559e82` nimmt
den Scope-Drift (Prompt-Sprachregel) sauber zuruck — erwarteter Selbstkorrektur-Zyklus,
kein neuer Befund.

### Offene topTodos (kein Blocker)

1. Vor Merge prufen: lauft `npm test` im Ziel-Merge-Zustand isoliert (nicht unter Last)
   tatsachlich vollstandig grun (5684/5686, 2 dokumentierte Last-Flakes)?
2. Beobachtung: `providerVoicemailMessage()` erzeugt Text ohne Langenbegrenzung
   (anders als `opening_line` uber `verifiedOpeningLine`) — falls ein sehr langer
   `openingLine`-Fallback je auftreten kann, lohnt ein Blick, ob `voicemail_message`
   am Anbieter ein Langenlimit hat (nicht im Diff sichtbar, nur Hinweis).
3. Merge-Begleitpflicht gemass CLAUDE.md: Prozessmull der Phase (Kickoff-Prompts,
   verbrauchte per-run-Skripte) im selben Zug wie der Merge aufraumen.

## Offene Punkte fur den Owner (nicht Teil dieser Phase)

- Getrennte Push-Freigabe fur `elevenlabs/agent_configs/outbound-agent.template.json`
  an den Live-Agenten, MIT der Reihenfolge-Regel "Server-Code mit `voicemail_line`
  zuerst live, danach erst der Push" (Concern 1 oben).
- Nach dem Push: Hor-/Transkript-Gegenprobe eines echten Anrufbeantworter-Falls in
  mindestens einer nicht-englischen Sprache.
- `platform_settings.evaluation.criteria`/`data_collection` (englische
  Zusammenfassungs-Prompts) bewusst nicht angefasst — kein Preset-/Override-Pfad im
  Schema, eigener Befund notig.
