# Phase P1b — Buchen und Kalender-Schein-Erledigung abschalten (Owner-Entscheidung E1/L6)

**Status:** Gate = **PASS** (kein Blocker)
**finalBranch:** `phase/cq-p1b-no-booking-fix2`
**Basis:** `master` (Arbeitsbaum-Stand `e76eb71`)
**headCommit (Impl):** `d16425a707909be817859287d3bd3a232d9f7aa0`

---

## 1. Ziel der Phase

Owner-Entscheidung E1/L6: der Telefon-Agent bucht **nicht** und liest im laufenden Gespräch **keinen** Kalender. Das ist keine Bugfix-, sondern eine bewusste Fähigkeits-Rücknahme (Produktentscheidung aus der Gesprächsqualitäts-Analyse: 0 echte Aufträge über `book_appointment`, die Kalenderanbindung war reine Simulation ohne echten Kalenderdienst dahinter).

Die **Owner-Kalenderfläche** (MCP-Tool `get_calendar`, `POST /api/calendar`, Profil-Achse `resolveProfile`/`PROFILE_FIELDS`) ist explizit **nicht** Gegenstand dieser Phase und bleibt unangetastet bestehen — sie ist eine andere Achse als die hier entfernten Settings-Felder `allowCalendar`/`allowBooking`.

---

## 2. Plan (gekürzt)

### 2.1 Drei Befunde gegen den Plantext (vor Umsetzung aufgelöst)

Der ursprüngliche Plantext enthielt drei Abweichungen vom tatsächlichen Repo-Stand, die vor der Umsetzung aufgelöst wurden:

- **B1 — `SETTINGS_TYPES` existiert nicht.** Der Plan verlangte, Kommentare an einem Symbol `SETTINGS_TYPES` richtigzustellen. `grep -rn "SETTINGS_TYPES" src/ test/` → 0 Treffer. Die betroffenen Kommentare (`// get_calendar-MCP-Tool`, `// POST /api/calendar`) stehen tatsächlich auf `PROFILE_FIELDS` (`src/store/defaults.js`) und sind dort **fachlich korrekt** — sie gaten exakt die Owner-Kalenderfläche, nicht die Settings-Achse. Auflösung: C13 wörtlich nicht ausgeführt (hätte zwei korrekte Kommentare falsch gemacht), stattdessen Ersatz **C13'**: ein Zwei-Achsen-Kommentar an `defaultSettings()`.
- **B2 — `test/mcp-ui.test.js` ist nicht unverändert grün.** Der Plan listete diese Datei fälschlich unter „unverändert grün erwartet". Sie pinnt `permissionsSummary`-Output byte-genau (`PERMISSIONS_STR`), der durch C12 zwingend mitgezogen werden musste.
- **B3 — SP7 kollabiert auf SP2, nicht auf SP1.** Die Plan-Begründung für die SP7-Streichung war falsch benannt (SP1 statt SP2); die Schlussfolgerung (SP7 ersatzlos entfernen) blieb richtig.

### 2.2 Neue Datei: `test/p1b-no-booking.test.js` (Pflicht-Test)

In-process, kein Server-Spawn, läuft **gegen den Bestands-Settings-Zustand** (`allowCalendar: true, allowBooking: true`, wie `helpers.seedState()` es standardmäßig seedet und wie jeder heute existierende Prod-Tenant ihn trägt) — das ist die eigentliche Beweiskraft: es zeigt, dass die Fähigkeit unabhängig vom Settings-Wert weg ist, nicht nur ein Default geflippt wurde.

5 Tests (P1b-1..5):
1. Vorbedingung: Bestands-Settings tragen weiterhin `true`/`true`.
2. `toolDefs()` liefert genau `end_call` + `take_message`.
3. `systemPrompt` nennt inbound wie outbound keine Kalender-/Buchungsmarker mehr, UND enthält die beiden neuen unbedingten Zeilen (Gegenprobe: echter Zweig-Kollaps statt bloßer Löschung).
4. `execTool` kennt `get_calendar`/`book_appointment` nicht mehr, kein Kalendereintrag entsteht.
5. Begrüßungsvorlagen (Default + Templates) versprechen kein „Termin" mehr.

Vorgeschriebenes Vorgehen: erst Test schreiben und **rot-vor-Fix protokollieren**, dann Fix.

### 2.3 Edits an bestehenden Dateien (Kern C1–C13)

- **`src/claude.js`**: Kopfkommentar entstaubt (C0); `fmtDate` als toter Code entfernt (C6b, keine Aufrufer mehr); die beiden `allowCalendar`/`allowBooking`-Ternaries im System-Prompt auf ihren `false`-Zweig kollabiert → jetzt unbedingt (C5); Inbound-SITUATION und Outbound-Abschnitte von Kalender-/Terminverweisen bereinigt (C7, C8); `calendarExcerpt`/`calendarSection` gelöscht (C6); referenzlose Konstanten `CALENDAR_PREVIEW_LIMIT`, `DEFAULT_EVENT_DURATION_MINUTES` entfernt (C6c); `toolDefs()` auf festen Zwei-Tool-Satz reduziert, verliert ungenutzten `tenantId`-Parameter (C1, C2, C2b); `execTool()` verliert `get_calendar`/`book_appointment`-Cases samt `dateLocale` (C3, C4).
- **`src/bridge.js`**: `realtimeTools()` zieht den Parameter-Wegfall aus C2b nach (drei mechanische Einzeiler, keine `HEIKLE STELLE`-Sektion betroffen).
- **`src/store/defaults.js`**: `DEFAULT_GREETING` verspricht keine Terminbuchung mehr (C9); Zwei-Achsen-Kommentar an `defaultSettings()` statt des misgegroundeten C13 (C13').
- **`src/self-service.js`**: `allowCalendar`/`allowBooking` aus `SELF_SERVICE_FREE_FIELDS` entfernt — kein Self-Service-Feld mehr, da wirkungslos (C11); `GREETING_TEMPLATES[1]` bereinigt (C10).
- **`src/mcp-tools.js`**: `permissionsSummary` verliert Kalender-/Buchen-Zeile (C12); MCP-Tool `get_calendar`, `CALENDAR_OUTPUT`, Widget-Binding und `"appointment"`-Renderer bleiben unangetastet (Owner-Fläche + Bestandsdaten-Darstellung).

### 2.4 Testanpassungen

- `test/l2-calendar-prefetch.test.js` **komplett gelöscht** (Testobjekt existiert nicht mehr; Disclosure-Abdeckung bleibt über `disclosure-regression.test.js` + `personal-assistant-characterization.test.js` erhalten).
- `test/personal-assistant-characterization.test.js`: SP1–SP6-Literale aus tatsächlichem Output neu eingefroren; SP7 + `EXPECTED_SP_DE_RESTRICTED` + `T_RESTRICTED`-Tenant entfernt.
- `test/i9-self-service.test.js`: Testfeld von `allowCalendar` auf `agentName`/`agentStyle` umgestellt (Free-Field-Wegfall).
- `test/mcp-ui.test.js`: `PERMISSIONS_STR`-Pin nachgezogen (B2-Fund).

### 2.5 Deterministisch prüfbares Ergebnis (Plan §5)

Grep-Gegenproben vorgeschrieben: `grep -c "book_appointment\|get_calendar\|calendarSection\|calendarExcerpt" src/claude.js` → 0; `grep -c "allowCalendar\|allowBooking" src/claude.js` → 0; Positivliste der verbleibenden Owner-Treffer exakt auf 4 Dateien begrenzt (`mcp-tools.js`, `defaults.js`, `widget-bind.js`, `calendar.html`).

### 2.6 Sicherheitsrelevanz laut Plan

Keine — P1b entfernt ausschließlich Fähigkeiten. Weder `numberGateError`-Gates, `disclosureSentence`, Auth/Signaturprüfung noch Billing werden berührt. Kein `PLAN-SECURITY.md`-Eintrag nötig. Rollback = Commit-Revert.

---

## 3. Implementierungs-Zusammenfassung

- **Ergebnis:** `node --check` sauber, volle Test-Suite grün, Commit erstellt (`d16425a...`).
- **Test-Zahlen:** 2419 pass / 0 fail (Impl-Lauf); im finalen Review-Lauf auf `phase/cq-p1b-no-booking-fix2` 2421 pass / 0 fail (nach zwei Fix-Runden, s.u.).
- Der Telefon-Agent bucht nicht mehr und liest im laufenden Gespräch keinen Kalender: `book_appointment`/`get_calendar`-Tools aus `toolDefs()`/`execTool()` entfernt, `calendarSection`/`calendarExcerpt` gelöscht, die zwei `allowCalendar`/`allowBooking`-Ternaries im System-Prompt auf ihren `false`-Zweig kollabiert (jetzt unbedingt).
- `toolDefs()`/`execTool()` verloren den ungenutzten `tenantId`-Parameter; `bridge.js`s `realtimeTools()` zieht nach.
- `DEFAULT_GREETING` + Self-Service-Vorlagen versprechen keine Terminbuchung mehr; `allowCalendar`/`allowBooking` sind kein Self-Service-Feld mehr.
- Die Owner-Kalenderfläche (MCP `get_calendar`, `POST /api/calendar`, `PROFILE_FIELDS`) bleibt unberührt.
- Rot-vor-Fix für `test/p1b-no-booking.test.js` bewiesen (4/5 rot: Tool-Liste, Prompt-Marker, `execTool`-Dispatch, Greeting-Text), danach grün.
- Alle Deterministik-Checks aus Plan §5 verifiziert: grep = 0 in `src/claude.js`, exakte 4-Datei-Positivliste, Owner-Kalender-Tests unverändert grün.
- **Smoke:** Server lokal gestartet (`PORT=0`, `SKIP_TWILIO_SIGNATURE_CHECK`), `POST /voice/incoming` gecurlt — Greeting lautet „Ich kann eine Nachricht für Jonas Beispiel aufnehmen", kein Terminversprechen mehr, Disclosure/Struktur unverändert.

### 3.1 Deviations (Abweichungen vom Plan-Wortlaut)

1. **B1/B2/B3** wie in Plan-Abschnitt 0 vorgesehen umgesetzt: `SETTINGS_TYPES` existiert nicht → C13' an `defaultSettings()` statt an `PROFILE_FIELDS`; `mcp-ui.test.js`-Pin nachgezogen; SP7 kollabiert auf SP2 statt SP1 (Kommentar entsprechend formuliert).
2. **Interner Widerspruch im Plan gefunden und aufgelöst:** Der im Plan wörtlich vorgegebene Kommentartext für `toolDefs()` (Abschnitt 2.1, C1+C2 „Nachher") enthielt selbst das Token `get_calendar` — das widersprach der eigenen deterministischen Abnahmeprüfung des Plans (Check 2: `grep -c ... src/claude.js` soll 0 sein). Aufgelöst zugunsten der explizit zahlenmäßig spezifizierten Abnahmekriterien; Kommentar sinngemäß umformuliert ohne die geflaggten Literal-Token.
3. Ein einmaliger, lastbedingter Flake in `test/f1-geo-onboard.test.js` (unberührte Datei) trat bei einem von drei Voll-Suite-Läufen auf; isoliert lief die Datei grün, ein erneuter Voll-Lauf war wieder sauber (2419/0) — als vorbestehender Last-Flake gewertet, keine Regression.

---

## 4. Safety-Urteil (final)

**Verdict: APPROVED.**

- Unabhängig ausgeführte Tests im frischen Worktree auf `review-p1b-r2` (= `phase/cq-p1b-no-booking-fix2`): `npm test` → 2421/2421 pass, 0 fail, exit 0 (73,1 s). Beide Backends abgedeckt (json-Spawn-Tests + 52 Dateien gegen pg-Backend via pglite); zusätzlicher expliziter pg-Subset-Lauf: 379/379 pass. `node --check` über alle `src/**/*.js` + `scripts/*.js` sauber.
- Rot-vor-Fix eigenständig nachvollzogen: `test/p1b-no-booking.test.js` auf einen Branch von `master` kopiert → 1 pass / 4 fail (u.a. `execTool(call,'get_calendar')` lieferte „Kalender ist leer, alles frei." statt „Unbekanntes Tool."; `DEFAULT_GREETING` enthielt noch „oder direkt einen Termin vereinbaren").
- Runtime-Smoke mit echtem Server-Boot: `/healthz` → 200; `POST /voice/incoming` → 200, Say-Text ohne Termin/Buchen/Kalender-Treffer (Regex-Check negativ). Boot-Guard feuerte beim ersten Versuch korrekt fail-closed (keine aktive Nummer → Exit 1).
- **Diff-Radius geprüft:** genau fünf Produktionsdateien berührt (`src/bridge.js`, `src/claude.js`, `src/mcp-tools.js`, `src/self-service.js`, `src/store/defaults.js`). Gezielter `git diff` gegen `src/routes/`, `src/config.js`, `src/auth.js`, `src/web-auth.js`, `src/middleware.js`, `src/telephony/`, `src/billing/` ist **leer** — kein Safety-Gate, keine Signaturprüfung, kein Budget-Pfad, kein neuer Endpunkt berührt.
- **Offenlegung:** `disclosureSentence()` body-identisch, `src/bridge.js` ruft sie unverändert für den Realtime-Opener; Pins `DISCLOSURE_DE/FR/EN` und `openingText` im Diff unangetastet.
- **Auth:** `SELF_SERVICE_FREE_FIELDS` wurde ausschließlich **verengt**; entfernte Keys fallen in den generischen rejected-Zweig, abgesichert durch zwei neue Regressionstests (Unit + End-to-End).
- **Secrets:** keine Log-/Response-Änderung, `permissionsSummary` gibt sogar weniger preis; `package.json`/`package-lock.json` leerer Diff.
- **Überlöschen** (Hauptrisiko laut Plan) hat nicht stattgefunden: Gegenprobe-Grep liefert exakt die erlaubte Restmenge, Null Treffer in `src/claude.js`; Owner-Kalenderfläche lebt weiter, bleibt auf der Profil-Achse gegated.
- Eslint war in der Review-Umgebung nicht lauffähig (`@eslint/js` fehlt in `node_modules`) — Lint-Gate konnte nicht selbst nachgefahren werden; `node --check` war sauber, CI fährt Lint separat.
- `/voice/outbound` wurde nicht per Hand gesmoket, nur `/voice/incoming` + `/healthz`; Outbound-Pfad gilt über die grüne Vollsuite (byte-genaue Characterization-Pins für `openingText`/`disclosureSentence`) als abgedeckt.

---

## 5. Clean-Code-Audit (final)

**Verdict: PASS ohne Blocker.**

- **s1 (Blocker):** keine.
- **s2:** keine.
- **s3:** keine.
- **s4 (nicht-blockierend, außerhalb Diff-Scope):**
  - G11/G31 · `test/l3-prompt-caching.test.js:97` ruft weiterhin `toolDefs(BOOTSTRAP_TENANT_ID)` auf, obwohl `toolDefs()` sein einziges Argument verloren hat. JS ignoriert das überzählige Argument stillschweigend, Test bleibt grün — aber Call-Site ist jetzt irreführend/stale gegenüber der neuen Signatur. Fix: trivialer Folge-Commit, `toolDefs()` ohne Argument aufrufen.

**Begründung (Auszug):** Volle Suite lokal nachgestellt (Worktree + node_modules-Symlink): 2421/0 grün, inkl. aller phase-relevanten Dateien. `node --check` auf allen 5 geänderten Produktionsdateien ok. Tote Konstanten/Funktionen (`CALENDAR_PREVIEW_LIMIT`, `DEFAULT_EVENT_DURATION_MINUTES`, `calendarSection`, `calendarExcerpt`) vollständig mitentfernt, keine Leichen. Verbleibende `allowCalendar`/`allowBooking`-Felder im Datenmodell sind laut Kommentar weiterhin über die Profil-/MCP-Achse in Gebrauch — per Grep gegen den Branch-Stand bestätigt, also keine toten Spalten.

**passNotes:** Byte-genaue Characterization-Tests (SP1–SP6) korrekt aktualisiert inkl. SP7-Löschung (Restricted-Tenant-Fall existiert nicht mehr, weil die Fähigkeit selbst weg ist). L2-Kalender-Prefetch-Testdatei korrekt komplett gelöscht statt angepasst. Neue P1b-Testdatei deckt Tool-Liste, Prompt-Marker-Abwesenheit UND -Anwesenheit der neuen unbedingten Zeilen (Gegenprobe echter Zweig-Kollaps), `execTool`-Ablehnung alter Tool-Namen ohne Seiteneffekt, sowie Begrüßungsvorlagen ohne Terminversprechen. Self-Service-Feldentzug end-to-end (i9) UND unit (self-service-patch) regressionsgetestet. Keine sicherheits-/gate-relevanten Dateien berührt.

**topTodos:**
- Optionaler Folge-Cleanup (nicht blockierend): `test/l3-prompt-caching.test.js:97` von `toolDefs(BOOTSTRAP_TENANT_ID)` auf `toolDefs()` trimmen.
- Merge-bereit: keine S1/S2-Funde, volle Suite grün, Safety-Gates unberührt.

---

## 6. Fix-Runden

- **r1:** Blocker `P1B-S1-1` behoben — die outbound-SITUATION-Zeile in `systemPrompt()` (`src/claude.js`) widersprach den zwei Zeilen darüber neu eingefügten unbedingten Regeln („Du hast KEINEN Kalenderzugriff" / „Du darfst KEINE Termine fest buchen"), indem sie weiterhin von „eine Bestätigung vor einer Buchung" sprach. Behoben.
- **r2:** Branch `phase/cq-p1b-no-booking-fix2` von `phase/cq-p1b-no-booking-fix1` erstellt. Der einzige gemeldete Blocker (S1: fehlende Testabdeckung für die Rechte-Änderung durch das Entfernen von `allowCalendar`/`allowBooking` aus `SELF_SERVICE_FREE_FIELDS`) war ein reines Test-Coverage-Problem — die Produktionslogik war bereits korrekt; Regressionstests (Unit + End-to-End) ergänzt.

Nach beiden Fix-Runden: finaler Safety-Review und Clean-Code-Audit gegen `phase/cq-p1b-no-booking-fix2` → beide PASS, keine Blocker.

---

## 7. Offene Owner-/Deploy-Auflagen (NICHT-AGENTEN-ARBEIT, Restrisiken, Bestandsdaten-Auflagen)

**O1 — Bestands-Greeting in Prod (benanntes Restrisiko, kein Bug).** C9/C10 ändern nur `DEFAULT_GREETING` und die Self-Service-Vorlagen als *Vorlagen*. Jeder Tenant, der den alten Greeting-Text bereits gespeichert hat — **einschließlich des Owner-Tenants in Prod** — sagt weiterhin „…oder direkt einen Termin vereinbaren" als allerersten Inbound-Satz. Der Agent kann das ab sofort nicht mehr einlösen: der allererste gesprochene Satz verspricht eine Fähigkeit, die das Toolset nicht mehr hat. **Owner-Handlung erforderlich:** Greeting im Dashboard auf eine der aktualisierten Vorlagen umstellen. Bis dahin besteht die Lücke live weiter.

**O1b — Nebeneffekt.** Der alte `GREETING_TEMPLATES[1]`-String ist keine gültige Vorlage mehr. Ein Tenant, dessen gespeicherter Greeting exakt diesem alten String entspricht, kann ihn über `selfServicePatch` nicht erneut auswählen (fällt in den Ablehnungszweig, `self-service.js`). Harmlos und fail-closed, aber die Dashboard-Vorlagenauswahl zeigt für diese Tenants dann keine exakt passende Vorlage mehr an.

**O2 — Echter Probeanruf (NICHT-AGENTEN-ARBEIT).** Inbound-Greeting ohne Terminversprechen und das Verhalten bei einem echten Terminwunsch („nur Nachricht aufnehmen") sind nur am echten Telefon final zu bestätigen. Kein Teil der agentischen Umsetzung.

**O3 — Settings-Felder ohne lesenden Konsumenten.** `allowCalendar`/`allowBooking` bleiben bewusst in `defaultSettings()`, `store/pg.js` und der `settings`-DB-Spaltenstruktur bestehen; nach C11 nur noch über `POST /api/settings` (Plattform-Admin) beschreibbar, ohne funktionalen Leser mehr. Bewusste, dokumentierte Inkonsistenz — ein Spalten-Drop ist explizit **kein Teil dieser Phase** (Migrations-Risiko ohne funktionalen Gewinn). Aufräum-Task gehört in `tasks/lessons.md`.

**O4 — Vertagt auf P5 (Prompt-Redesign).** `src/claude.js` enthält weiterhin die Formulierung „…nenne sie nur so, wie das Gegenüber oder **dein Kalender** sie genannt hat", obwohl der Agent keinen Kalender mehr hat. Der Plan hat diese Zeile bewusst nicht in P1b geändert (keine Zweig-Kollaps-, sondern eine Prompt-Redesign-Änderung) — Nacharbeit gehört in P5.

**O5 — Phasen-Reihenfolge (zwingend einzuhalten).** P1b muss **vor P4** laufen (sonst misst die P4-Baseline eine Fähigkeit, die es nach P5 nicht mehr gibt) und darf **nicht parallel zu P1** laufen (einzige Überschneidung: `test/personal-assistant-characterization.test.js`). Läuft P1 danach, muss P1 die hier neu generierten SP1–SP6-Literale orthografisch nachziehen.

**O6 — Bench-Vorarbeit für P4 fehlt noch (aus dem Safety-Review, nicht Teil des P1b-Scopes).** `scripts/convo-bench/scenarios/friseur-voll.mjs` trägt weiterhin `expectBooking: true` und referenziert den Check `booked_with_nongeneric_title` (`scripts/convo-bench/checks.mjs`). Der ursprüngliche Umbrella-Plan platziert diese Anpassung im P4-Abschnitt, nicht in der autoritativen C1–C13-Liste von P1b — daher hier bewusst nicht umgesetzt. Kein Sicherheits- oder Produktionsrisiko (reines Dev-Werkzeug), aber der P4-Baseline-Bench-Lauf geht per Konstruktion rot, solange das Szenario eine Buchung erwartet, die der Agent nach P1b nicht mehr liefern kann. **Muss zwingend vor P4 nachgezogen werden.**

**O7 — Kosmetischer Nachzug (nicht blockierend).** `test/l3-prompt-caching.test.js:97` ruft weiterhin `toolDefs(BOOTSTRAP_TENANT_ID)` mit einem seit dieser Phase wirkungslosen Argument auf. Trivialer Folge-Commit möglich, kein Risiko.

**Sicherheitsrelevanz insgesamt: keine.** P1b entfernt ausschließlich Fähigkeiten. Weder Denylist/Land-Gate/Stundenlimit/Budget/Max-Gesprächsdauer, noch `disclosureSentence`, noch Auth/Signaturprüfung, noch Billing wurden berührt. Kein `PLAN-SECURITY.md`-Eintrag nötig. Rollback = Revert des Commits.
