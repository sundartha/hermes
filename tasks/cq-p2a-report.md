# Phase P2a — Messbarkeit: Metriken an, Ergebnisse sichtbar

- **Gate:** PASS
- **finalBranch:** `phase/cq-p2a-metrics-fix1`
- **Basis:** `master` = `b104d9d` (P1 gemergt)
- **Scope:** rein additiv — keine Safety-Gates, kein `disclosureSentence`, keine Auth-Middleware, kein Budget-Pfad, kein Store-Schema, keine neue Env-Var, keine neue Dependency berührt

---

## 1. Plan (gekürzt)

Ziel: die bereits vorhandene, aber ausgeschaltete Metrik-Infrastruktur (`METRICS_ENABLED`, `src/metrics.js`) um eine neue Messgröße erweitern und die im Backend längst vorhandenen, aber im Tenant-Dashboard unsichtbaren Datenfelder (`summary`, `objectiveAchieved`, Notifications) tatsächlich anzeigen.

**Scope-Korrektur am Plan (vor der Umsetzung erkannt):** Der ursprüngliche Plan-Text behauptete für Punkt 3 ("Ergebnisse sichtbar"), es fehle "ausschließlich die Anzeige". Das stimmte für das Tenant-Portal nicht: `public/tenant.html` pollt `/api/self-service/state` (nicht `/api/state`), und diese Route lieferte kein `notifications`-Feld. `summary`/`objectiveAchieved` waren dagegen tatsächlich schon vorhanden (`publicCall` in `src/store/views.js` strippt nur `streamToken`, `_finished`, `summarySmsSentAt`). Der Plan hat diese Lücke selbst benannt und einen zusätzlichen, minimalen additiven Server-Edit vorgesehen (`notifications: data.notifications` in `src/self-service-routes.js`), begründet als tenant-gescopt (`exportTenantData`), hinter demselben `webAuthMw`, keine neue Datenklasse.

Keine neue Env-Var ⇒ kein `.env.example`-, kein `test/helpers.js`-BASE_ENV- und kein `render.yaml`-Edit nötig (`METRICS_ENABLED` existierte an allen drei Stellen bereits).

**Geplante Datei-Änderungen:**

| Datei | Art | Umfang (Plan-Schätzung) |
|---|---|---|
| `src/metrics.js` | neue Funktion `logSpeechResult` (Zeichenzahl, kein Text) + Export + Kommentar-Korrektur (Konsument server.js → routes/voice.js) | ~12 Zeilen |
| `src/routes/voice.js` | 1 Call-Site nach `parseSpeechResult` | 3 Zeilen |
| `src/self-service-routes.js` | 1 additives Response-Feld `notifications` | 5 Zeilen |
| `public/tenant.html` | CSS + neue Karte "Meldungen" + `objectiveChip`/`callBody`/`renderNotifications`/`formatNotificationTime` + Aufruf in `refresh()` | ~55 Zeilen |
| `test/l0-metrics.test.js` | T-L0-2 auf sechs Funktionen erweitert + 2 neue Tests (T-L0-7, T-L0-7b: PII-Freiheit, chars=0-Signal) | ~25 Zeilen |
| `test/cq-p2a-dashboard-visibility.test.js` | neu, Kompositions-Integrationstest (pglite, kein Server-Spawn), 4 Tests (Notifications sichtbar / Fremd-Leak-Schutz H3 / summary+objectiveAchieved überleben publicCall / fail-closed 401 ohne Body-Leak) | ~150 Zeilen |
| `test/cq-p2a-tenant-html.test.js` | neu, Statik-/Verdrahtungstest auf dem committeten Rohtext (Precedent: `test/phase-a-setup-fee-tenant-html.test.js`) | ~30 Zeilen |

Bindendes Abnahmekriterium: `node --check` auf den drei geänderten JS-Dateien + die drei betroffenen Testdateien isoliert grün + volle Suite grün + Grep-Beweis, dass `logSpeechResult` ausschließlich `callId`/`chars` loggt.

---

## 2. Implementierungs-Zusammenfassung

Diff-Umfang: 7 Dateien, +366/-4 Zeilen (`public/tenant.html`, `src/metrics.js`, `src/routes/voice.js`, `src/self-service-routes.js`, `test/l0-metrics.test.js`, `test/cq-p2a-dashboard-visibility.test.js`, `test/cq-p2a-tenant-html.test.js`).

- **`src/metrics.js`**: neue Funktion `logSpeechResult({ callId, chars })`, gated hinter demselben `enabled`-Flag wie alle anderen Metriken (Default `false` ⇒ byte-identisch bis Env-Flip). Loggt ausschließlich Zeichenzahl, nie den gehörten Text. Modul-Fußnote korrigiert (Konsument `server.js` → `routes/voice.js`, seit dem Server-Slim).
- **`src/routes/voice.js`**: genau eine neue Call-Site direkt nach `parseSpeechResult` in `/voice/turn`. Kein neuer Import (`metrics` war bereits importiert). `.length` auf garantiert String (beide Provider-Adapter geben immer getrimmten String zurück, nie `undefined`).
- **`src/self-service-routes.js`**: additives Response-Feld `notifications: data.notifications` in `GET /api/self-service/state` — dieselbe tenant-gescopte Quelle (`exportTenantData`) wie `calls`/`actionItems`, kein neuer Auth-Pfad.
- **`public/tenant.html`**: neue CSS-Regeln (nur bestehende Farb-Tokens), neue Karte "Meldungen" (`#notifCard`, initial `display:none` — I9-Muster: fehlt das Feld vom Server, bleibt die Karte unsichtbar statt leer), `objectiveChip()` (Lookup-Tabelle `true`/`false`/`unclear`/kein Chip bei `null`), `callBody()` (Summary + Chip, komplett leer wenn beides fehlt ⇒ Karte bleibt byte-identisch zum Bestand), `renderNotifications()` (versteckt Karte bei fehlendem Array), `formatNotificationTime()` (Invalid-Date-Guard). Aufruf `renderNotifications(s.notifications)` in `refresh()` ergänzt. Alle neuen Textknoten laufen durch das bestehende `esc()`.
- **`test/l0-metrics.test.js`**: T-L0-2 ("fünf Funktionen" → "sechs Funktionen") erweitert, zwei neue Tests T-L0-7 (PII-Freiheit per `Object.keys`-Vergleich + String-Suche gegen den geloggten Payload) und T-L0-7b (`chars=0` wird geloggt, kein Nicht-Ereignis).
- **Neue Testdateien** wie im Plan: `test/cq-p2a-dashboard-visibility.test.js` (4 Tests, pglite-Kompositionstest gegen echtes HTTP), `test/cq-p2a-tenant-html.test.js` (2 Tests, Statik-Verdrahtung auf Rohtext).

### Deviations vom Plan

1. **Server-Edit `notifications` in `src/self-service-routes.js`** — vom Plan selbst als notwendige Scope-Korrektur benannt und umgesetzt (siehe Abschnitt 1). Keine unangekündigte Abweichung, aber eine Server-Änderung, die die ursprüngliche Kurzbeschreibung der Phase ("es fehlt nur die Anzeige") nicht vorhergesehen hatte. Vom Safety-Review als "Concern" markiert, nicht als Blocker — vom Lead bewusst abzunicken.
2. Keine weiteren inhaltlichen Abweichungen; Umfang und Dateizahl entsprechen dem Plan.

---

## 3. Safety-Urteil (final)

**Verdict: APPROVED.**

- `approved: true`, `testsPassIndependently: true`, `safetyGatesIntact: true`, `disclosureIntact: true`, `authFailClosedIntact: true`, `noSecretsLeaked: true`, `scopeRespected: true`, `behaviorAsIntended: true`, **keine Blocker**.
- Diff exakt 7 Dateien. `git diff master..branch` auf `src/claude.js`, `src/bridge.js`, `src/locales.js`, `src/outbound-gates.js`, `src/config.js`, `src/auth.js`, `src/web-auth.js`, `src/middleware.js`, `src/telephony/`, `src/billing/` liefert 0 Zeilen — Offenlegungssatz und Safety-Gates nachweislich unberührt.
- Kein neuer Endpunkt: `notifications` ist ein additives Feld auf dem bestehenden, bereits `webAuthMw`-gegateten `GET /api/self-service/state`; Test P2a-4 pinnt 401 ohne Cookie samt Nicht-Leak des Bodys.
- Tenant-Scoping hält: `exportTenantData` filtert auf `callIds` DIESES Tenants, alle `addNotification`-Aufrufer übergeben `call.id`; Test P2a-2 pinnt gegen Fremd-Leak (H3).
- Kein Secret-Leak: neue Metrik loggt ausschließlich `callId` + `chars`, per Unit-Test UND per echtem Server-Lauf bewiesen (siehe Runtime-Smoke unten).
- Kein Audio durch MCP berührt. Keine neue npm-Dependency (`package.json`/`package-lock.json` = 0 Diff). Flag-off byte-identisch.
- Agent hat korrekt NICHT versucht, `METRICS_ENABLED` über `render.yaml` scheinbar zu aktivieren (render.yaml/config.js unverändert) — der Prod-Flip bleibt bewusst Owner-Arbeit.
- XSS-Oberfläche geprüft: `title`/`body`/`summary` laufen durch `esc()`, Chip-Klasse aus fester Lookup-Tabelle, Zeitstempel mit Invalid-Date-Guard.

**independentTestSummary:** Default-(json)-Backend: `npm test` = 2433 Tests, 2433 pass, 0 fail, 73,1 s. pg-Backend über pglite in-process abgedeckt (`test/pg-helpers.js`); die neue Datei fährt `GET /api/self-service/state` per echtem HTTP gegen einen pglite-Postgres-Store. Rot-vor-Fix bewiesen: die drei neuen/geänderten Testdateien auf detached master kopiert ⇒ 15 Tests, 8 pass, 7 fail (genau die neuen/erweiterten Fälle). Zusätzlicher eigener Runtime-Smoke mit `METRICS_ENABLED=true` (echter Server-Spawn, zwei POSTs auf `/voice/turn`): Log zeigt `[metrics] speech_result {"callId":"call_rev_p2a","chars":0}` und `{"chars":59}`; der 59-Zeichen-Satz sowie die Teilzeichenkette "Doktor Mueller" tauchen NIRGENDS im stdout auf, beide Turns HTTP 200 — Hot-Path bleibt intakt und PII-frei.

### Concerns (nicht-blockierend, teils mit Handlungsbedarf)

1. **Spec-Abweichung (berechtigt, meldepflichtig):** Plan-Punkt 3 behauptete fälschlich, es fehle nur die Anzeige — tatsächlich fehlte serverseitig `notifications` in `/api/self-service/state`. Der Fix ist minimal, additiv, tenant-gescopt und durch Test P2a-2 gepinnt, aber eine Server-Änderung, die die Spec nicht vorgesehen hatte. Lead sollte das bewusst abnicken.
2. **Deploy-Auflage nicht im Branch:** `METRICS_ENABLED=true` muss vom Owner im Render-Dashboard gesetzt werden (Live-Services sind Dashboard-managed, `render.yaml:253` ist nicht autoritativ). Ohne diesen Flip ist die gesamte Phase in Prod wirkungslos, und P9 startet ohne `heardChars`-Baseline. Siehe Abschnitt 5.
3. **Vorbestehend, durch P2a erstmals nutzersichtbar:** `MAX_NOTIFICATIONS=50` (`src/store/defaults.js`) ist ein GLOBALER Cap über ALLE Tenants (`src/store/state-ops.js`: `s.notifications = s.notifications.slice(0, MAX_NOTIFICATIONS)`). Im pg-Backend löscht `flushNotifications` (`src/store/pg.js`) via `deleteMissing` alle DB-Zeilen des Tenants, die nicht mehr im In-Memory-Spiegel stehen. Ein aktiver Tenant kann damit Notifications eines anderen aus dem Spiegel verdrängen, und dessen nächster Flush löscht sie hart aus der DB. Nicht von P2a eingeführt, nicht im Scope dieser Phase — aber P2a baut jetzt eine UI auf genau diese Liste. Eigener Task wert.
4. **Kosmetik:** CSS-Klasse `.obj.unclear` ist nicht definiert (`public/tenant.html` hat nur `.obj`, `.obj.yes`, `.obj.no`). `objectiveAchieved="unclear"` rendert als neutraler Basis-Chip "Ziel unklar" — lesbar, aber ohne eigene Farbgebung. Kein Funktionsfehler (siehe auch Clean-Code S3 unten).
5. `prettier --check` meldet die neue Datei `test/cq-p2a-dashboard-visibility.test.js` als unformatiert; `src/routes/voice.js`, `src/self-service-routes.js`, `test/l0-metrics.test.js` driften bereits auf master (gegengeprüft) — kein Regress, `npm test` hat kein Format-Gate.
6. `eslint` ließ sich im Review-Worktree nicht ausführen (`ERR_MODULE_NOT_FOUND` für `@eslint/js` über den `node_modules`-Symlink) — reines Umgebungsartefakt des isolierten Worktrees, nicht am Code verifiziert. `node --check` ist für alle drei geänderten JS-Dateien grün.

---

## 4. Clean-Code-Audit (final)

**Verdict: PASS**, kein Blocker.

- **S1 (Blocker-Klasse):** keine Funde.
- **S2:** keine Funde.
- **S3:**
  - G11 (Inkonsistenz) · `public/tenant.html` · `OBJECTIVE_CHIPS` definiert `"unclear" → cls:"unclear"`, aber im CSS-Block existieren nur `.obj.yes`/`.obj.no`, kein `.obj.unclear`. Der Chip "Ziel unklar" fällt auf die Basis-`.obj`-Farbe zurück statt eine eigene Akzentfarbe zu bekommen (rein visuell, Text bleibt lesbar). Fix: `.obj.unclear{...}`-Regel neben `.obj.yes`/`.obj.no` ergänzen.
- **S4:**
  - G10 (Vertikale Trennung) · `test/l0-metrics.test.js` · Die neuen Tests T-L0-7/T-L0-7b wurden vor dem physisch weiter unten stehenden, vorbestehenden T-L0-5 eingefügt ⇒ Test-IDs nicht mehr in numerischer Reihenfolge (1, 1b, 2, 3, 4, 6, 7, 7b, 5). Rein kosmetisch/Navigierbarkeit, keine funktionale Auswirkung. Bei Gelegenheit T-L0-5 vor T-L0-6 verschieben.

**passNotes:** PII-Diskretion von `logSpeechResult` per Kommentar UND Test bewiesen (T-L0-7 prüft explizit, dass "Termin" nicht im Log-Payload landet; T-L0-2 korrekt von "fünf" auf "sechs" Funktionen aktualisiert, kein C2-Drift). `heard.length` crash-sicher (beide Adapter liefern garantiert getrimmten String). Security dreifach bewiesen: P2a-2 (H3, nie fremde Notification), P2a-4 (fail-closed 401 ohne Body-Leak), P2a-3 (summary/objectiveAchieved überleben publicCall, streamToken bleibt gestrippt) — `exportTenantData` selbst unverändert. Rückwärtskompatibilität im I9-Muster durchgehend: fehlt das Feld, bleibt Verhalten byte-identisch. XSS: `esc()` konsequent vor `innerHTML`. Keine Umlaute in neuen Kommentaren, keine Magic Numbers, kein toter/auskommentierter Code, kein abgeschalteter Check, keine Argumentzahl > 3, keine Verschachtelungstiefe > 2 in geänderten Funktionen. Volle Suite: 2432/2433 grün; der einzige rote Test (`test/telnyx-event-ingest-route.test.js`, außerhalb des Diff-Scopes) ist isoliert grün — bestätigter vorbestehender Flake, keine Regression durch diesen Diff.

**topTodos:**
1. `.obj.unclear` CSS-Regel in `public/tenant.html` ergänzen (S3, kosmetisch, schnell erledigt).
2. Optional: T-L0-5 in `test/l0-metrics.test.js` vor T-L0-6/7 verschieben für numerische Reihenfolge (S4, rein kosmetisch).
3. Kein echter Blocker — merge-fähig.

---

## 5. Fix-Runden

**r1:** Einziger Blocker war "Branch ist leer" — kein Inhaltsproblem. Ursache: fehlendes `node_modules`-Symlink im frischen Worktree. Vorgehen: `node_modules`-Symlink im Worktree gesetzt (auf `../../../node_modules`, wie in vergleichbaren Fix-Worktrees üblich), Branch `phase/cq-p2a-metrics-fix1` von `phase/cq-p2a-metrics` (Basis `b104d9d`, identisch zu master zu dem Zeitpunkt) neu aufgesetzt. Nach dem Fix: Inhalt vollständig vorhanden, Suite grün, Gate PASS. Keine weiteren Fix-Runden nötig.

---

## 6. Offene Owner-/Deploy-Auflagen (NICHT-AGENTEN-ARBEIT, Restrisiken, Bestandsdaten-Auflagen)

Diese Punkte sind bewusst **kein** Teil des Abnahmekriteriums der Phase (Plan Abschnitt 5) und dürfen nicht als "erledigt" fehlinterpretiert werden, nur weil der Branch grün ist.

1. **`METRICS_ENABLED=true` im Render-Dashboard des Live-Service setzen.** `render.yaml:253` ist NICHT autoritativ (Live-Services sind Dashboard-managed) — ein Edit dort ändert am laufenden Dienst nichts. Danach den Boot verifizieren (`[boot]`-Banner + `/healthz`). **Ohne diesen Flip loggt `logSpeechResult` — wie alle anderen Metriken — bewusst gar nichts.**
2. **Echter Testanruf nach dem Flip**, zu prüfen:
   - Dashboard (`sundartha.com` → Self-Service, eingeloggt) zeigt ohne curl und ohne MCP: Summary-Text, Ziel-Chip, Meldung.
   - Render-Log enthält `[metrics] turn …`, `[metrics] stt_gap …` und `[metrics] speech_result {"callId":…,"chars":…}` — und in keiner dieser Zeilen steht Gesprächstext.
3. **Vorbedingung für Schritt 2, leicht übersehen:** Das Tenant-Dashboard steht hinter OIDC-Web-Login und liefert für nicht aktivierte Tenants `403`. Der Verifikations-Account braucht ein aktives Abo, sonst ist die Sicht leer und das Ergebnis nicht aussagekräftig — kein Code-Defekt.
4. **Kein Deploy-Zwang für P2a selbst:** Punkte 2 und 3 des Plans (Dashboard-Anzeige) sind rein additiv und bei ausgeschaltetem `METRICS_ENABLED` verhaltens-neutral; die Dashboard-Änderung wirkt sofort nach dem nächsten Deploy, unabhängig vom Env-Flip.
5. **Bestandsdaten-/Kapazitätsrisiko (aus Safety-Concern #3):** `MAX_NOTIFICATIONS=50` ist ein globaler Cap über ALLE Tenants; `flushNotifications` im pg-Backend kann Notifications eines verdrängten Tenants hart aus der DB löschen, wenn ein anderer Tenant aktiver ist. P2a macht diese vorbestehende Schwachstelle erstmals nutzersichtbar (die UI baut jetzt auf genau dieser Liste auf). Sollte als eigener Task vor signifikantem Nutzerwachstum priorisiert werden — kein Blocker für P2a, aber ein Folgetask.
6. **Kosmetik-Nachzug (kein Blocker):** `.obj.unclear`-CSS-Regel ergänzen, optional T-L0-5-Reihenfolge in `test/l0-metrics.test.js` fixen (siehe Clean-Code topTodos).
7. **P9-Abhängigkeit:** Die Endpointing-Kalibrierung (P9) braucht eine `heardChars`-Baseline aus `logSpeechResult`. Diese Baseline existiert erst, sobald Punkt 1 (Env-Flip) erledigt UND eine ausreichende Menge echter Anrufe geloggt wurde. P9 sollte nicht vor diesem Datensammlungsfenster starten.
