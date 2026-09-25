# Phase IP1 — Gesprochene Umlaute im Inbound-Begruessungskatalog

**Gate: PASS**
**finalBranch:** `phase/ip1-inbound-umlaute`

## Ueberblick

Die zwei DE-Begruessungsvorlagen (`src/store/defaults.js DEFAULT_GREETING`,
`src/i18n/locales.js LOCALES.de.greetingVariants[0]`) trugen die ASCII-Ersatzschreibung
"fuer" statt "für". Ziel der Phase: korrekte Umlaute im gesprochenen Text, ohne den
Pflichtsatz (Offenlegung/AI-Kennzeichnung), die Sprach-Fallback-Reihenfolge oder
Bestandsdaten (settings.greeting at rest) zu gefaehrden.

## Plan (gekuerzt)

Basis: `master` (`1d7f43d`).

- **B1:** Zwei Codestellen betroffen, kein Test/Fixture pinnt den Wortlaut literal.
- **B2:** Es existiert bereits eine Boot-Migration (`greeting-notice-migration.js`) fuer
  den Pflichtsatz — nicht fuer Orthografie. IP1 verdrahtet KEINE zweite Boot-Migration.
  Bestands-Begruessungen sind at rest immer "umhuellt" (Pflichtsatz-Praefix).
- **B3:** Reihenfolge in `greetingForLanguage` ist verhaltenstragend: Normalisieren MUSS
  vor der Listenpruefung passieren, sonst gilt ein alter DE-Wert nach dem Fix als
  Admin-Freitext, und ein EN-Tenant mit diesem Altwert wuerde die alte deutsche
  Begruessung hoeren (Sprachregression).
- **B4:** Karten-Lookup (`GREETING_ORTHOGRAPHY_MIGRATION`) muss prototyplos sein
  (`Object.create(null)`), sonst liefert ein at-rest-Wert wie `"toString"` eine
  `Object.prototype`-Funktion, die der Renderpfad (`replaceAll`) crashen liesse.
- **Abweichungen im Plan selbst (A1/A2):** `SPOKEN_DE_FIELDS` bekommt S15+S16.0, NICHT
  S16.1 (traegt von sich aus keinen Umlaut, IP1-G1 deckt stattdessen jede DE-Vorlage
  per Iteration ab); `knip.json` bekommt den neuen Skript-Pfad als `entry` (mechanisch
  erzwungen, sonst meldet `npm run deadcode` das Skript als toten Code).

**Neue Datei:** `scripts/greeting-orthografie-nachziehen.mjs` — idempotenter Nachzieh-Lauf
fuer Bestandsdaten, Dry-Run als Default, `--apply` schreibt ueber den regulaeren
Store-Schreibweg (`store.updateSettings`), KEIN Boot-Eingriff, KEIN rohes SQL.

**Exakte Edits:**
- `src/store/defaults.js` — `DEFAULT_GREETING`: ein Zeichen ("fuer" -> "für").
- `src/i18n/locales.js` — `LOCALES.de.greetingVariants[0]`: ein Zeichen.
- `src/i18n/greeting-catalog.js` — neue Karte `GREETING_ORTHOGRAPHY_MIGRATION`
  (prototyplos, Referenzen auf gebaute Vorlagen, keine Literal-Kopie) + Funktion
  `greetingWithCurrentOrthography`; `greetingForLanguage` normalisiert zuerst, prueft
  dann gegen die Vorlagenlisten.
- `test/de-umlaut-orthography.test.js` — `SPOKEN_DE_FIELDS` um S15/S16.0 erweitert.
- `knip.json` — neuer Skript-Entry.

**Nicht angefasst (laut Plan):** `.env.example`, `render.yaml`, `src/config.js`,
`package.json`, `src/routes/voice.js`, `src/self-service.js`,
`src/store/greeting-notice-migration.js`, `src/store/state-ops.js`, `src/bridge.js`.

## Impl-Zusammenfassung

- Beide Zeichen-Fixes umgesetzt, Wortlaut sonst byte-identisch.
- `greeting-catalog.js`: prototyplose At-Rest-Karte + `greetingWithCurrentOrthography`,
  aufgerufen VOR der Vorlagenpruefung in `greetingForLanguage` — hebt eine gespeicherte
  alte Schreibweise zur Laufzeit, ohne dass ein Nachzug noetig waere; Sprach-Fallback
  (PROMPT-03) bleibt intakt.
- Neues Skript `scripts/greeting-orthografie-nachziehen.mjs`: Dry-Run Default, `--apply`
  schreibt idempotent ueber den Settings-Schreibweg, kein Boot-Eingriff.
- `knip.json` um den Skript-Entry ergaenzt.
- Tests: neues `test/ip1-greeting-orthography.test.js` (IP1-G1, M1–M4, N1–N3, 8 Faelle,
  alle gruen), `test/de-umlaut-orthography.test.js` um S15/S16.0 erweitert.
- Voller Regressionslauf (`npm test -- --test-concurrency=4`): 5989 pass / 0 fail (Impl-
  Messung; siehe Safety-Review fuer die unabhaengige Gegenmessung).
- `git diff --stat` entspricht exakt der Plan-Erwartung: 5 geaenderte + 2 neue Dateien,
  `defaults.js`/`locales.js`-Diff je 4 Zeilen (2 raus, 2 rein).
- Head-Commit der Implementierung: `ab497ed18c5105d4b400098bb5be9597ea4776ef`.

### Deviations (Implementierung, keine Plan-Abweichung in der Sache)

1. **Testhelfer-Fix:** Der geplante Helfer `greetingAtRest()` ging implizit von einer
   owner-keyed Settings-Map auf der Platte aus. Tatsaechlich migriert `src/store/json.js`
   flat->Map nur in-memory beim Laden; ohne anschliessendes `store.save()` (Dry-Run ruft
   `save()` nicht auf) bleibt die Datei flach. Fix betrifft nur den Test-Fixture-Code
   (`greetingAtRest()` unterscheidet jetzt beide Formen), keine Aenderung an Produktions-
   code oder Assertions.
2. **Lint-Nacharbeit:** Der Repo-Pre-Commit-Hook (`npm run lint`, `id-length`/
   `no-magic-numbers` als Errors) blockierte den ersten Commit wegen kurzer Bezeichner
   (`t`/`d`/`s`/`r`) und Magic Numbers (3/9) im neuen Code. Behoben durch sprechende Namen
   und zwei benannte Konstanten (`ANZAHL_DE_VORLAGEN`, `ANZAHL_ALLER_VORLAGEN`); Verhalten
   und Assertions unveraendert.

## Safety-Urteil

**approved: true** — alle Einzelkriterien (testsPassIndependently, safetyGatesIntact,
disclosureIntact, authFailClosedIntact, noSecretsLeaked, scopeRespected,
behaviorAsIntended) erfuellt, keine Blocker.

**Unabhaengige Testmessung** (frischer Worktree, Branch `review-ip1` auf `ab497ed`):
- `npm test -- --test-concurrency=4`: Branch 5989 Tests, 5988 pass, 1 fail
  (`AL-P10-2`, `test/al-p10-precall-research.test.js`); Baseline `master` (`1d7f43d`):
  5981 Tests, 5980 pass, 1 fail (`AL-P10-1`, dieselbe Datei). Delta = +8 = exakt die
  8 neuen IP1-Faelle. Der rote Fall ist ein vorbestehender Parallelitaets-Flake
  (isoliert 12/12 gruen auf dem Branch; auf `master` ist der Nachbarfall in derselben
  Datei ebenso rot) — kein IP1-Defekt.
- `npm run test:gates`: Branch 129 Tests / 126 pass / 3 fail (GAP-05, GAP-15, E2E-03);
  Master 129/125/4 fail (dieselben drei + `OUT-05`). Gleiche Testzahl, strikt weniger
  rot auf dem Branch — kein neuer Gates-Fund, kein IP1-Test in die Gates-Bank gerutscht.
- Isoliert gruen: IP1-Testdatei + de-umlaut-orthography + p11-greeting-language +
  p1b-no-booking + inbound-disclosure-mandatory = 32/32; store-pg-json-parity +
  greeting-notice-migration = 29/29; route-auth-inventory + security = 28/28.
- Eigene Gegenproben ueber die echte Route `POST /voice/incoming` (3 Faelle, je Status
  200): alte at-rest-Fassung -> jetzt "für", Pflichtsatz genau 1x; neue Fassung ebenso;
  ein Freitext mit "fuer" wird NICHT umgeschrieben und traegt den Pflichtsatz ebenfalls
  genau 1x. Trockenlauf/`--apply`/Idempotenz des Nachzieh-Skripts selbst nachgefahren.

**Concerns (keiner blockierend):**
1. Sachlich falsche Begruendung im Testkommentar zu S16.1 (Abdeckung geht trotzdem nicht
   verloren, da IP1-G1 alle drei DE-Vorlagen iteriert).
2. Latente Index-Kopplung `HISTORISCHE_DE_ROHFASSUNGEN[i]` <-> `greetingTemplatesFor("de")[i]`
   — aber test-gedeckt (IP1-M1 pinnt den Rundlauf).
3. `await store.save()` ohne `drainFlushes()` vor `process.exit(0)` im neuen Skript —
   folgt jedoch der etablierten Repo-Konvention (8 Bestandsskripte mit identischem Muster),
   kein von IP1 eingefuehrter Defekt.
4. Dashboard-Nebenwirkung (kosmetisch): ein Tenant mit alter at-rest-Fassung matcht kein
   Dropdown-Element mehr, bis er neu waehlt oder der Nachzieh-Lauf gefahren wird; gesprochen
   ist der Satz bereits korrekt (HTTP-belegt).
5. Betrieb: Nachzieh-Lauf MUSS nach einem Deploy/Neustart gefahren werden (pg-Spiegel im
   Speicher, sonst Ueberschreiben beim naechsten Voll-Flush).
6. Offene Messung M5: ob der Owner-Test-Tenant ueberhaupt `DEFAULT_GREETING` traegt oder
   eine eigene Begruessung — vor der Aussage "Owner-Beschwerde erledigt" per Prod-DB-
   Schnappschuss zu pruefen.
7. `knip.json` (+1 Zeile) steht nicht in der urspruenglichen Spec-Dateiliste, ist aber
   mechanisch erzwungen (kein Feature-Extra).

## Clean-Code-Audit (S1–S4)

- **S1 (Blocker):** keine Befunde.
- **S2 (Blocker):** keine Befunde.
- **S3:** ein Befund, akzeptiert — `HISTORISCHE_DE_ROHFASSUNGEN` in
  `src/i18n/greeting-catalog.js` sind Vollzitate statt aus den aktuellen Vorlagen
  abgeleitet (G5, leicht). Bewusste, dokumentierte Ausnahme: der Kommentar begruendet
  ausdruecklich, dass die Historie bei kuenftigen Wortlaut-Aenderungen NICHT mitwandern
  soll ("EINGEFROREN UND GESCHLOSSEN"). Kein Fix noetig.
- **S4:** keine Befunde.

**Verdict: PASS.** Reine String-Korrektur plus kleiner, reiner Hebe-Mechanismus
(prototyplos abgesichert, Reihenfolge getestet), Nachzieh-Skript folgt etablierten
Repo-Mustern (Store-Fassade, kein rohes SQL, idempotent, PII-bewusst geloggt), volle
Testabdeckung der Katalog-Invarianten, der At-Rest-Falle, der Sprachfallback-Reihenfolge
und des Skript-Laufs. Keine blockierenden To-dos.

## Fix-Runden

Keine — der Workflow konvergierte im ersten Durchlauf auf PASS (Safety + Clean-Code je
PASS ohne Blocker; die einzigen Deviations traten waehrend der Implementierung selbst auf
und wurden dort behoben, s.o.).
