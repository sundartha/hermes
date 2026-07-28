# Phase AL-P3 — Endpointing konfigurieren

- **Gate**: PASS
- **finalBranch**: `phase/al-p3-endpointing`
- **Basis**: `master` (`320c003`)
- **headCommit**: `4697e8aac7f3a73f73236c60644c5e842fb3e002`

---

## Plan (gekuerzt)

Ziel der Phase: `interruption_settings.start_speaking_plan` (Endpointing) am Telnyx-Assistant
konfigurieren — vor AL-P3 stand das Feld auf `null`, Telnyx entschied mit unbekannten internen
Defaults, und diese Wartezeit sitzt vor **jedem einzelnen Turn**.

**Vorpruefung (bereits vor der Umsetzung ausgefuehrt)**: read-only `GET /v2/ai/assistants` +
`GET /v2/ai/assistants/{id}` gegen das Live-Objekt zeigte den echten Schema-Slot:

```
interruption_settings.start_speaking_plan.wait_seconds
interruption_settings.start_speaking_plan.transcription_endpointing_plan.on_punctuation_seconds
interruption_settings.start_speaking_plan.transcription_endpointing_plan.on_no_punctuation_seconds
interruption_settings.start_speaking_plan.transcription_endpointing_plan.on_number_seconds
```

Das widerlegte zwei Annahmen aus dem Plan-Doc: (1) das Feld liegt unter `interruption_settings`,
nicht unter `transcription` — kein Guard-Umzug in `PRESERVED_SAFETY_FIELDS` noetig, der
`transcription`-Guard bleibt gueltig; (2) die Endpointing-Sekunden liegen eine Ebene tiefer unter
`transcription_endpointing_plan`, nicht als Geschwister von `wait_seconds`.

**Scope**: keine neuen Dateien, keine neue Env-Var (Werte als benannte Modul-Konstanten neben
`INTERRUPT_PREDICTION_THRESHOLD`), keine neue Dependency. Edits an bestehenden Dateien:

1. `scripts/telnyx-assistant-provision.mjs` — vier neue Modul-Konstanten
   (`START_SPEAKING_WAIT_SECONDS=0.4`, `ENDPOINTING_ON_PUNCTUATION_SECONDS=0.1`,
   `ENDPOINTING_ON_NO_PUNCTUATION_SECONDS=0.8` — der eigentliche Hebel, Anker-Preset war 1.5 —,
   `ENDPOINTING_ON_NUMBER_SECONDS=0.5`); `start_speaking_plan` in `buildAssistantConfig` gesetzt,
   Barge-in-Felder (`enable`, `interrupt_prediction_threshold`) unveraendert; vier neue Blaetter in
   `APPLIED_FIELDS_TO_VERIFY` ueber gemeinsame Pfad-Praefixe `START_SPEAKING_PLAN_PATH` /
   `ENDPOINTING_PLAN_PATH` (gegen Duplizierung, G5).
2. `PLAN-ASSISTANT-LEAP.md` — Faktenkorrektur des Phase-3-Bullets (Vorpruefung erledigt statt
   offen, Schema-Slot korrigiert).
3. `docs/RUNBOOK-TELNYX-ASSISTANT.md` — neuer Abschnitt 9 (Endpointing), Abnahme-Reihenfolge
   (Basislinie vor Provisioning, Provisioner-Lauf, Nachher-Messung), Abbruchkriterium.
4. `tasks/al-testcall-checklist.md` — drei neue Zeilen (Basislinie, Provisioner-Lauf,
   Nachher-Messung) mit Abbruchkriterium `turns/Anruf +15%` bzw. sinkender `chars`-Median.

**Tests** (P11-Pflicht): 3 neue Tests in `test/telnyx-assistant-config.test.js` (Verschachtelung +
Werte, Object.keys-Regressionsschutz fuer Barge-in-Felder, `transcription` wird nicht gesendet),
2 neue + 1 angepasste Erwartung in `test/telnyx-assistant-merge-guard.test.js`
(`appliedFieldSnapshot` liest die vier neuen Blaetter; stiller Drop von `start_speaking_plan`
lasst `sendAssistantConfig` werfen statt `smokePass=true`). Summe: 26 -> 31 Tests.

**Pre-Mortem** (Kern): Abschneiden von Anrufern durch zu aggressives
`on_no_punctuation_seconds` -> Abnahmekriterium `chars`-Median; Kostenanstieg durch mehr Turns ->
Abbruchkriterium `turns/Anruf +15%` und `bookTokenUsage`-Beobachtung; stiller Feld-Drop durch
Telnyx -> alle vier Blaetter in `APPLIED_FIELDS_TO_VERIFY`, fail-closed; unbekannter
`null`-Default koennte schneller gewesen sein -> Basislinien-Messung ist zwingend erste
Checklistenzeile. `time_limit_secs`/`PRESERVED_SAFETY_FIELDS` bleiben unangetastet.
Bewusst nicht entschaerft: `disable_greeting_interruption` wird weiter nicht gesendet (inert, da
`greeting` leer ist).

**Ausdruecklich nicht Teil der Phase**: Provisioner ausfuehren, deployen, Render-Env aendern,
`transcription.settings.*` (Flux/Eager-EOT), `custom_endpointing_rules`, `voice_speed`.

---

## Impl-Zusammenfassung

Exakt gemaess Plan auf Branch `phase/al-p3-endpointing` (Basis `master 320c003`) umgesetzt, Commit
`4697e8a`. Genau die 6 im Plan genannten Dateien geaendert:

- `scripts/telnyx-assistant-provision.mjs`
- `test/telnyx-assistant-config.test.js`
- `test/telnyx-assistant-merge-guard.test.js`
- `PLAN-ASSISTANT-LEAP.md`
- `docs/RUNBOOK-TELNYX-ASSISTANT.md`
- `tasks/al-testcall-checklist.md`

Kein Zugriff auf `src/`, keine neue Env-Var, keine neue Dependency. `buildAssistantConfig` bleibt
ein Objekt-Argument (F1), keine neuen Parameter.

**Tests**: 5 neue Tests (3 in `telnyx-assistant-config.test.js`, 2 in
`telnyx-assistant-merge-guard.test.js`) + 1 angepasste Snapshot-Erwartung
(`appliedFieldSnapshot` jetzt 7 statt 3 Schluessel). 26 -> 31 Tests, alle gruen. Negativ-Kontrolle
durchgefuehrt: `ENDPOINTING_ON_NO_PUNCTUATION_SECONDS` testweise aus `APPLIED_FIELDS_TO_VERIFY`
entfernt -> neuer Merge-Guard-Test wurde korrekt rot, danach zurueckgenommen und wieder gruen
verifiziert.

**Volle Suite**: `npm test` 3374/3375 pass, 1 Fail
(`test/voice-tariff-full-cost-guard.test.js:126`, "Server vorzeitig beendet, code null"),
isoliert nachgestellt 10/10 gruen — dokumentierter vorbestehender Spawn-Race-Flake, unabhaengig
von den geaenderten Dateien.

`node --check` auf allen drei geaenderten `.js`-Dateien gruen. Prettier `--write` angewendet (rein
formatierend), danach `--check` gruen. `npm run lint` konnte lokal NICHT ausgefuehrt werden
(eslint/@eslint/js fehlen im node_modules dieser Arbeitsumgebung) — Deviation, kein Diff-Effekt.

**Smoke**: kein Server-/Routen-Smoke noetig (reine Provisioning-Skript-Aenderung); stattdessen
`buildAssistantConfig()` direkt aufgerufen und `interruption_settings.start_speaking_plan`
visuell gegen die live-verifizierte Form geprueft — korrekt.

### Deviations

1. Plan-Abschnitt 5 sagte `grep -c start_speaking_plan -> 4` voraus; tatsaechlich 9 Treffer, weil
   der Begruendungskommentar den Begriff mehrfach in Fliesstext nennt. Fehleinschaetzung des
   Plan-Autors ueber die eigene Kommentarprosa, keine Implementierungsabweichung —
   Code-Struktur entspricht dem Plan exakt.
2. `npm run lint` (eslint) konnte nicht ausgefuehrt werden: eslint/@eslint/js fehlen im lokalen
   node_modules dieser isolierten Arbeitsumgebung (vorbestehendes Environment-Problem, nicht
   durch den Diff verursacht). `node --check` + volle Testsuite + Prettier `--check` sind gruen
   und decken die Code-Qualitaet ab.

---

## Safety-Urteil

**Verdict: PASS** (`approved: true`). Alle Einzelchecks bestanden: `testsPassIndependently`,
`safetyGatesIntact`, `disclosureIntact`, `authFailClosedIntact`, `noSecretsLeaked`,
`scopeRespected`, `behaviorAsIntended`.

Unabhaengig im frischen Worktree nachgefahren: Regressionslauf 3355/3355 pass (json-Backend +
pglite-in-process), Gates-Lauf 126/129 pass (identisch zur dokumentierten Bestandsbasis, unveraendert
durch diese Phase), gezielt 31/31 in den beiden Telnyx-Testdateien. Mutationsprobe
(`on_no_punctuation_seconds` 0.8 -> 1.5) liess den neuen AL-P3-Test korrekt rot werden — Tests
sind nicht vakuum.

**Begruendung**: reine Konfigurations-/Doku-Phase, null Aenderungen unter `src/`, `public/`,
`package.json`, `.env.example` oder `render.yaml` — Laufzeitpfad byte-identisch; betroffen ist
ausschliesslich der manuell vom Owner gestartete Provisioner. `PRESERVED_SAFETY_FIELDS` inkl.
`time_limit_secs` unveraendert und zusaetzlich per Test gepinnt, dass `transcription` nicht
gesendet wird. Barge-in-Felder (`enable`, `interrupt_prediction_threshold`) bleiben woertlich
stehen, gegen stilles Verlieren/Dazuerfinden per `Object.keys`-Test abgesichert. Die vier neuen
`APPLIED_FIELDS_TO_VERIFY`-Blaetter sind ein echter Sicherheitsgewinn (stiller Feld-Drop wird
faelschungssicher statt `smokePass=true` zu melden).

### Concerns (nicht blockierend)

1. **Unverifizierbare Kernbehauptung** (wichtigster Punkt): "SCHEMA-SLOT LIVE VERIFIZIERT" wird in
   Commit, Plan und Runbook behauptet, aber im Repo liegt dazu kein Artefakt (kein Dump, kein
   Log-Eintrag). Der Safety-Reviewer konnte den GET selbst nicht ausfuehren (vom
   Permission-Classifier blockiert, nicht umgangen). Kein Sicherheitsblocker, weil jeder falsche
   Slot fail-closed endet (HTTP 400 oder Merge-Guard wirft). Empfehlung: Owner soll den GET vor
   dem Live-Lauf einmal real ausfuehren und die Ausgabe anhaengen.
2. Operationsrisiko beim ersten Live-Lauf: Telnyx koennte serverseitig einen `transcription`-Block
   auto-befuellen, was `fieldsLostOnUpdate` falsch-positiv werfen liesse (fail-closed, aber
   erwartbar).
3. Produktrisiko (im Plan bewusst akzeptiert): `on_no_punctuation_seconds` 1.5 -> 0.8 kann
   Anrufer abschneiden / Turns erhoehen; Abbruchkriterium steht in Runbook/Checkliste,
   Basislinien-Messung ist noch offen.
4. Kleine Scope-Unschaerfe: ~8 Bestandszeilen wurden nebenbei Prettier-umformatiert (rein
   kosmetisch, keine Semantikaenderung).
5. Doku-Nit: die drei neuen Zeilen in Checkliste/Runbook nutzen Umlaute, waehrend die
   Bestandszeilen derselben Dateien transliteriert sind (betrifft keine Code-Kommentare).

---

## Clean-Code-Audit (S1-S4)

- **S1**: keine
- **S2**: keine
- **S3**: keine
- **S4**: eine Anmerkung — `scripts/telnyx-assistant-provision.mjs:139-140`,
  `START_SPEAKING_PLAN_PATH`/`ENDPOINTING_PLAN_PATH` als gute G5/G33-Extraktion (PASS, reiner
  Hinweis, kein Verstoss).

**Blocker: false. Verdict: PASS ohne Blocker.**

Begruendung: benannte Modul-Konstanten statt Magic Numbers (G25), Pfad-Praefixe verhindern
vierfache Verschachtelungs-Duplizierung (G5/G33), stiller-Drop-Fehlermodus wird per Skalarvergleich
getestet (keine Deep-Equal-Fallstricke, MAJOR-3-Lehre eingehalten), neues Verhalten durch 5 neue
Tests gedeckt (P11), Dokumentation konsistent nachgezogen, kein Widerspruch zwischen Kommentar und
Code (C2), `PRESERVED_SAFETY_FIELDS.transcription` bleibt unangetastet und per Test gepinnt.
Grossteil des Diffs ausserhalb der Kernaenderung ist reines, verhaltensneutrales
Prettier-Reformatting. Kein Produktivpfad (`src/`) beruehrt.

**Top-TODOs** (Prozess, keine Code-Garantie):
1. Vor dem Owner-Live-Lauf: Basislinie (`start_speaking_plan_extra_wait_duration_ms`, >=5 Anrufe)
   wirklich vor dem Provisioner-Lauf erheben.
2. Beim ersten echten Provisioner-Lauf auf die neue K1/K2-Fehlermeldung achten (stiller
   Feld-Drop wirft jetzt korrekt statt `smokePass=true` zu melden).

---

## Fix-Runden

Keine — Gate wurde ohne Fix-Runde mit PASS erreicht (Safety und Clean-Code beide PASS im ersten
Durchlauf, Abschnitt `=== FIXES ===` der Quelle ist leer).
