# E7 — Detailbericht: Challenge-Route + Widget-Metadaten (OpenAI Apps)

**Gate: PASS** (0 Blocker)
**finalBranch:** `phase/openai-e7-challenge-metadaten` (HEAD `5bec453`, Basis `master` @ `87b8ec1`, Fast-Forward moeglich)

---

## 1. Ziel der Phase

Zwei OpenAI-Apps-Einreichungsanforderungen umsetzen, ohne bestehende Sicherheitsmechanismen anzufassen:

- **O-4/O-5:** eine oeffentliche Domain-Ownership-Challenge-Route `GET /.well-known/openai-apps-challenge`, die einen von OpenAI zugewiesenen Klartext-Token ausliefert (oder 404 bei leerem/ungesetztem Token).
- **T-30/T-31:** Widget-`_meta`-Pflichtfelder (`csp`, `domain`) fuer die MCP-native Widget-Auslieferung.

---

## 2. Plan (gekuerzt)

**Basis-Verifikation:** Arbeitsbaum == `master` == `87b8ec1`, alle Zwangspunkt-Zahlen der Spec am Zielstand nachgemessen (PUBLIC_ROUTES=31, ROUTE_FINGERPRINT=65, Probe-Tabelle=71, CONFIG_NAMESPACES.server=8/total=198).

**Drei Korrekturen an der Spec (bindend):**
- **K1:** `startServer` liefert `srv.stdout`, nicht `srv.output` — Test T7 musste das echte Feld verwenden, sonst still-gruener Nulltest.
- **K2:** `MCP_ALLOWED_ORIGINS` steht nicht in `render.yaml`; Env-Eintrag stattdessen bei `OWNER_IDP_SUBJECT` (Gateway-Block, `sync: false`).
- **K3:** A11 (Probe-Tabellen-Eintrag) ist Pflicht, nicht Kuer — `probe-auth-table.test.js` erzwingt Vollstaendigkeit gegen `PUBLIC_ROUTES`.

**Zwei zusaetzliche Absicherungen:** kein Bestandstest deepEqualt `_meta` (A10 ist damit non-breaking); `src/app.js` hat keinen eigenen 404-Handler, daher darf der POST-Test (T6) nur "Token nicht im Body" pruefen, nicht "openai nicht im Body" (Express-finalhandler echot den Pfad).

**Blast Radius (13 Dateien):** `src/config.js`, `src/app.js`, `src/route-policy.js`, `src/ui/contract.js`, `src/ui/adapters/mcp-native.js`, `.env.example`, `render.yaml`, `scripts/probe-auth.sh`, `test/route-auth-inventory.test.js`, `test/config-namespaces.test.js`, `test/helpers.js`, `test/mcp-ui.test.js`, neu `test/openai-e7-challenge.test.js`. Kein Anruf-, SMS-, Kosten- oder Auth-Pfad beruehrt.

**Verbote (Review-Blocker bei Verstoss):** kein Scope-Zuwachs ueber A1-A11 hinaus, keine zweite Env-Variable, keine bedingt registrierte Route, kein `--no-verify`, kein Push/Merge/Deploy, keine Formular-Inhalte, ChatGPT-Adapter unangetastet, kein direkter `process.env`-Zugriff im Handler, keine Magic Numbers/Strings ausser dem einen begruendeten Pfad-Literal-Paar.

**Owner-Aufgaben (kein Code):** Token im Render-Dashboard eintragen (O-A1), Challenge-Base-URL im OpenAI-Portal setzen (O-A2), Probe-Zeile nach Eintrag auf 200 ziehen (O-A3), restliche Formular-Inhalte (O-A4), `MCP_UI_ENABLED`-Live-Wert VOR Einreichung mit UI messen (O-A5).

---

## 3. Implementierung — Zusammenfassung

**Kernaenderungen:**
- `src/config.js`: neuer Config-Wert `openaiAppsChallengeToken` (aus `OPENAI_APPS_CHALLENGE_TOKEN`, `.trim()`ed), `CONFIG_NAMESPACES.server` 8 → 9.
- `src/app.js`: Konstante `OPENAI_CHALLENGE_PATH`, `HTTP_NOT_FOUND=404`; neue Route `GET /.well-known/openai-apps-challenge` in `registerPublicRoutes` (VOR `registerWellKnown`) — liefert Klartext-Token oder 404 bei leerem/ungesetztem Wert. Laufzeit-Pruefung statt bedingter Registrierung (sonst im Routen-Inventar unsichtbar).
- `src/route-policy.js`: `PUBLIC_ROUTES`-Eintrag mit Begruendung (31 → 32).
- `src/ui/contract.js`: `UI_CSP` (leere `connectDomains`/`resourceDomains`, gemessen: 0 externe Ladevorgaenge in allen 5 Widget-Quellen/12 Dateien), `uiSubmissionMeta()` liest `config.server.publicUrl` zur Aufrufzeit (kein Cache/Lazy-Init).
- `src/ui/adapters/mcp-native.js`: `buildMeta` ergaenzt um `...uiSubmissionMeta()` — wirkt auf alle 5 `enableWidgetUi`-Aufrufstellen; ChatGPT-Adapter unberuehrt.
- `test/route-auth-inventory.test.js`: `ROUTE_FINGERPRINT` 65 → 66.
- `test/config-namespaces.test.js`: `server` 8→9, `EXPECTED_TOTAL_KEYS` 198→199, `EXPECTED_PRIMITIVE_LEAVES` 184→185 (dieser dritte Zaehler fehlte in der Spec-Tabelle, wurde aber mechanisch erzwungen mitgezogen — Befund liegt bei der Spec, nicht beim Code).
- `test/helpers.js`: `BASE_ENV.OPENAI_APPS_CHALLENGE_TOKEN=""` (Lehre `test-base-env-drift`).
- `.env.example`, `render.yaml`: Env-Var dokumentiert bzw. deklariert (`sync: false`, Anker bei `OWNER_IDP_SUBJECT`).
- `scripts/probe-auth.sh`: Zeile 71 → 72, Status `404` als korrekter **deployter** Ist-Zustand (Token dort noch nicht gesetzt).
- `test/mcp-ui.test.js`: neue Faelle E7-T10..T13 (CSP/domain am Widget-`_meta`, ChatGPT-Nicht-Regression).
- `test/openai-e7-challenge.test.js` (neu): E7-T1..T9, echter Server-Spawn ueber `test/helpers.js` (200/404, Byte-Form, `.trim()`, POST-Verweigerung, kein Log-Leak, configHash-Neutralitaet, Doku-Kohaerenz mit Positiv-Kontrolle).

**Ergebnis:** `node --check` auf allen 11 geaenderten + 1 neuen `.js`-Datei gruen, `bash -n` auf `probe-auth.sh` gruen. Nachgemessen: `PUBLIC_ROUTES.length=32`, `CONFIG_NAMESPACES` `server=9`/`total=199`, Probe-Tabelle=72 Zeilen. Volle Testbank via `npm test -- --test-concurrency=4`: 6134 pass / 0 fail. Isolierter Lauf des neuen Tests: 9/9 pass.

**Deviations:**
1. Clean-Code-Korrektur ueber den Plan hinaus (Selbstfund, keine Verhaltensaenderung): `test/mcp-ui.test.js` E7-T13 hatte eine Law-of-Demeter-Verkettung (`chat.tools.get(tool).config._meta`), die den Pre-Commit-Hook (`check-staged-suppressions`, G36-Suppressionszaehler 38→39) blockiert haette. Behoben durch Destrukturierung (`const { tools: chatTools } = captureUi(...)`); Suppressionszaehler unveraendert.
2. Smoke-Test lokal nicht sauber gelungen — Boot-Guard verlangt einen `bootstrap-tenant`-Seed, der fuer den Wegwerf-Smoke nicht angelegt war ("Keine aktive Nummer im Store"). Kein Befund an der E7-Aenderung selbst: die automatisierten E7-T1..T9-Tests spawnen bereits erfolgreich den echten Server (Test-Harness uebernimmt dort das Seeding) und belegen das E2E-Verhalten (200/404, Byte-Form, Trim, POST-404, Log-Freiheit, configHash-Neutralitaet). `smokePass=false`, kein Blocker fuer die Phase.

---

## 4. Safety-Urteil

**Verdict: approved (PASS) — 0 Blocker, 7 Concerns.**

- `testsPassIndependently`: true (eigener Lauf 6134/6134, Exit 0)
- `safetyGatesIntact`: true — kein Safety-Gate, kein Anruf-/SMS-/Geldpfad beruehrt
- `disclosureIntact`: true — `src/claude.js`, Offenlegungs-Kette und ElevenLabs-Bridges haben leeren Diff
- `authFailClosedIntact`: true — die eine neue oeffentliche Route ist dreifach verankert (Begruendungs-Kommentar, `route-policy.js`-Eintrag, `ROUTE_FINGERPRINT`-Pin) und fail-closed (leerer/Whitespace-Token → 404, ununterscheidbar von "Route existiert nicht")
- `noSecretsLeaked`: true — eigene Gegenprobe: Token weder in `/healthz` noch in `/.well-known/oauth-protected-resource` noch im Server-stdout
- `scopeRespected`: true — exakt die 13 Spec-Dateien, keine neue Dependency, kein Push/Merge/Deploy
- `behaviorAsIntended`: true

**Eigene HTTP-Gegenprobe (Safety-Reviewer, unabhaengig von den Branch-Assertions):**
- `GET /.well-known/openai-apps-challenge` mit Token `" REVIEW-TOKEN-9z9\n"` → 200, `content-type: text/plain; charset=utf-8`, Hex-Dump exakt 16 Byte, **kein `0a` am Ende** (`.trim()` greift korrekt)
- ohne Token → 404, leerer Koerper
- `GET /api/calls` ohne Identitaet ≠ 200 (Auth-Kette unveraendert)

**Zwei Testlaeufe verifiziert:**
- LAUF 1 (json-Backend): 6154 Tests / 6154 pass / 0 fail (6134/6134 korrigiert nach Abzug der 20 Datei-Wrapper), 144 s
- LAUF 2 (`STORE_BACKEND=pg` erzwungen): 100 fail — als Umgebungsartefakt entlarvt (pg lokal nicht erreichbar); identische rote Dateiliste auf `master` reproduziert (Diff leer). Kein einziger E7-Test dabei rot.

**Concerns (kosmetisch/Kenntnisnahme, kein Blocker):**
1. `UI_CSP` ist exportiert, aber nirgends importiert (toter Export außerhalb der Definitionsdatei) — Kandidat fuer knip.
2. Doku-Pin-Regex in E7-T9 (`\s*(#.*)?$`) ist schwaecher als beabsichtigt, weil `\s` auch `\n` matcht; Positiv-Kontrolle im selben Test ist aber vorhanden und korrekt.
3. Express-Default-Routing liefert den Token zusaetzlich unter Trailing-Slash- und Case-Varianten des Pfads — folgenlos (Token ist oeffentlich bestimmt), steht aber im Spannungsverhaeltnis zur Spec-Aussage "kein Praefix, kein Suffix".
4. `_meta.ui.csp`/`.domain` gehen ab Deploy an JEDEN MCP-Host mit `MCP_UI_ENABLED=on` (auch den live verbundenen claude.ai-Connector) ohne eigenen Schalter — Risiko gering, MCP ignoriert unbekannte `_meta`-Felder, aber sichtbare Verhaltensaenderung vor der OpenAI-Einreichung. Einziger Rueckfall bleibt `MCP_UI_ENABLED`.
5. Spec-Zwangspunkt-Tabelle war unvollstaendig (`EXPECTED_PRIMITIVE_LEAVES` fehlte); Umsetzung hat den Zaehler korrekt mitgezogen — Befund liegt bei der Spec.
6. Kein `tasks/e7-report.md` zum Zeitpunkt des Safety-Reviews gefunden — dieser Report schliesst diesen Punkt.
7. pg-Backend in dieser Umgebung nicht echt fahrbar (kein erreichbares Postgres) — gleiche Einschraenkung wie im E8-Review dokumentiert; reale pg-Abdeckung laeuft ueber die pglite-Tests im Default-Lauf.

**Flag-off-Byte-Identitaet strukturell belegt:** `enableWidgetUi` liefert `{}` solange `uiRenderer` null ist, `uiRendererFor` gibt bei `!hostHint?.enabled` null zurueck; `uiSubmissionMeta()` wird ausschliesslich im mcp-nativen `buildMeta` gerufen. Bestehende FALLBACK_CASES-Tests bleiben unveraendert gruen. Kein Import-Zyklus durch `import { config }` in `src/ui/contract.js`.

---

## 5. Clean-Code-Audit (S1-S4)

**Verdict: PASS.** S1: [] · S2: [] · S3: [] · S4: [] · `blocker: false`.

**passNotes:**
- Neue Route korrekt als Auth-Ausnahme in `src/route-policy.js` begruendet + im `ROUTE_FINGERPRINT` gepinnt (Absolute Regel 3 erfuellt).
- Token wird getrimmt gelesen, nie geloggt, nie in eine andere Antwort gemischt, ist keine configHash-Achse (Test E7-T8 belegt es) — Regel 4 (Secrets) beachtet.
- Fail-closed: leerer/Whitespace-Token → 404 ohne "openai" im Body; Route ist unbedingt gemountet (keine bedingte Registrierung, die im Routengraph unsichtbar waere).
- Neue Magic-Konstanten (`OPENAI_CHALLENGE_PATH`, `HTTP_NOT_FOUND`) sauber benannt (G25).
- `uiSubmissionMeta()` wertet zur Aufrufzeit aus (kein Lazy-Init/Cache, P15-konform); CSP-Listen leer und mit konkreter Messmethode begruendet, keine erfundene Angabe; `domain` entfaellt sauber bei leerer `publicUrl` statt einen falschen Origin zu behaupten.
- ChatGPT-Pfad bleibt unangetastet (Test E7-T13, Nicht-Regression).
- Doku-Kohaerenz (`.env.example`/`render.yaml`/`config.js`) ist selbst getestet (E7-T9) mit Positiv-Kontrolle (Lehre `pruefkommando-ohne-positiv-kontrolle` beachtet).
- Keine Umlaute in neuen Kommentaren, keine Secrets im Diff, keine ausgeschalteten Sicherungen, kein toter/auskommentierter Code.
- Literal-Duplikation des Pfad-Strings zwischen `app.js` und `route-policy.js` folgt dem bestehenden Repo-Muster (andere `.well-known`-Routen sind ebenso dupliziert) — keine neue Abweichung.

`topTodos: []`

---

## 6. Fix-Runden

Keine Fix-Runde noetig — Safety und Clean-Code kamen beide im ersten Durchlauf auf PASS ohne Blocker. Die einzige waehrend der Implementierung selbst behobene Korrektur ist die G36-Verkettung in `test/mcp-ui.test.js` E7-T13 (s. Deviations, Abschnitt 3), die vor dem Commit gefunden und behoben wurde, nicht als separate Review-Runde.

---

## 7. Pflicht-Vermerke aus Spec Abschnitt 6

1. **`MCP_UI_ENABLED` ist im Live-Betrieb UNKNOWN** (0 Treffer in `render.yaml`, Gateway dashboard-verwaltet). Ist er live aus, liefert `tools/list` gar kein `_meta.ui` — dann traegt kein Deskriptor ein Widget, T-30/T-31 sind gegenstandslos. Es bleibt offen, ob die Widgets ueberhaupt ausgeliefert werden. Loeser ist O-A5 (Owner-Aufgabe), nicht Code.
2. Der Bestandskommentar bei `test/mcp-ui.test.js` ("ausschliesslich place_call traegt ein Widget-`_meta`") stimmt am Zielstand nicht mehr — es sind fuenf Aufrufstellen (`place_call`, `get_my_number`, `list_calls`, Kalender, `get_agent_status`). Bewusst nicht angefasst (Scope).
3. Nachgemessene Zaehler (Ist → Soll, am gemergten Stand erneut geprueft): `PUBLIC_ROUTES` 31→32, `ROUTE_FINGERPRINT` 65→66, Probe-Tabelle 71→72, `CONFIG_NAMESPACES.server` 8→9, `total` 198→199, `EXPECTED_PRIMITIVE_LEAVES` 184→185 (letzterer in der Spec nicht genannt, aber mechanisch erzwungen korrekt mitgezogen).
4. Die drei Spec-Korrekturen K1-K3 (s. Abschnitt 2 oben).
5. Offene UNKNOWNs U-1…U-7 aus der Spec (Parent-Host-Akzeptanz, Origin-Eindeutigkeit T-31, leere CSP-Listen/`data:`, `csp`/`domain` am TOOL- vs. RESOURCE-`_meta`, `MCP_UI_ENABLED`, Render-Neustart-Verhalten, Developer-Mode-Geltung) — aendern im Trefferfall jeweils einen Wert, nicht die Struktur.

---

## 8. Owner-Aufgaben (offen, ausdruecklich kein Code)

| ID | Aufgabe | Ort |
|---|---|---|
| O-A1 | Token als `OPENAI_APPS_CHALLENGE_TOKEN` am Gateway-Service eintragen; Prozess neu starten | Render-Dashboard |
| O-A2 | Challenge Base URL im Formular = `https://app.sundartha.com` | OpenAI-Portal |
| O-A3 | Nach O-A1 die Probe-Zeile von `404` auf `200` ziehen | Repo, eigener Ein-Zeilen-Commit |
| O-A4 | Name, Beschreibungen, Logo, Kategorie, Starter-Prompts, Lokalisierung, Laenderverfuegbarkeit, Release Notes, Policy-Attestationen, Support-/Website-/Privacy-/Terms-URL | OpenAI-Portal |
| O-A5 | Live-Wert von `MCP_UI_ENABLED` messen, BEVOR mit UI eingereicht wird | Render-Dashboard / Live-`tools/list` |

---

## 9. Status

Branch `phase/openai-e7-challenge-metadaten` liegt lokal, nicht gemerged, nicht gepusht, kein Deploy. Merge sollte diesen Report sowie O-A1/O-A3/O-A5 beruecksichtigen, bevor die OpenAI-Einreichung mit UI-Widgets erfolgt.
