# Phase SEC-P4 — ElevenLabs-Werkzeug-Token je Mandant

- **Gate:** PASS
- **finalBranch:** `sec/p4`
- **headCommit:** `98220d9b9321c09bbc89d14c4ad6c80b5fbed3e3`
- **Basis:** `master` @ `bb48989`

## Plan (gekuerzt)

**Anbieter-Fakt:** ElevenLabs kennt EINEN geteilten Workspace-Secret-Header (`x-hermes-tool-token`) fuer beide Werkzeuge (`get_consult`, `look_up`), identisch fuer alle Mandanten. Ein per-Mandant unterschiedlicher Header ist am Anbieter nicht konfigurierbar. Die Mandanten-Dimension kann nur ueber `dynamic_variables` am Anrufstart transportiert und ueber eine `dynamic_variable`-Property im Werkzeug-Anfragekoerper zurueckgeholt werden (dieselbe Mechanik wie `conversation_id`/`system__conversation_id`).

**Entwurf:** Anrufstart gibt `tenant_token = HMAC-SHA256(ELEVENLABS_TOOL_TOKEN, "v1:<tenantId>")` mit. Der Webhook bindet ueber `conversation_id`, rechnet den Sollwert aus dem gebundenen Anruf neu und vergleicht timing-sicher (`safeEqual`). Bewusst ABGELEITET statt zweites Geheimnis (kein Backfill, keine neue Spalte, kein zweiter Rotationsfall) — akzeptierter Preis: schuetzt nicht gegen einen Angreifer, der Plattform-Token UND Mandanten-Kennung besitzt.

**Zwei Haelften:**
1. Vereinheitlichte Ablehnung — alle bindungsabhaengigen Ablehnungen (Bindung, Mandanten-Riegel, Faehigkeit) antworten einheitlich `404 {error:"kein_laufender_anruf"}`; das Log unterscheidet weiter ueber `logGrund`. `402` (Budget), `400` (Nutzlast) und `404 kein_freier_platz` bleiben bewusst unveraendert — wer sie erreicht, hat einen faehigen Anruf schon passiert.
2. Mandanten-Token — additiv, scharf erst mit Schalter `ELEVENLABS_TENANT_TOKEN_REQUIRED` (Default `false`) UND Owner-Push der Werkzeug-Definition am Anbieter (`PATCH /v1/convai/tools/{id}`, ausserhalb der Kette).

**Neue Datei:** `src/elevenlabs/tenant-tool-token.js` — rein, netzfrei, `node:crypto` (kein neues Dependency): `tenantToolToken({secret, tenantId})`, `tenantTokenVerdict({secret, tenantId, presented})` mit Urteilen `PASSEND|FEHLT|FREMD`, fail-closed (nicht ableitbarer Sollwert → `FREMD`, nie `PASSEND`).

**Edits:** `src/config.js` (neuer Schluessel + Namespace), `src/elevenlabs/outbound.js` (Ableitung + Durchreichen als `tenant_token` dynamic variable, NIE im Prompt), `src/routes/webhooks-elevenlabs.js` (Duplizierung `lookupDenied`+`denied` → `toolDenied`+`denyBoundCall`+`boundCallFor`, tote Closure `activeCallByConversationId` entfernt), `src/route-policy.js` (Reason-Texte), `elevenlabs/agent_configs/outbound-agent.template.json` (neue Property, NICHT in `required`, `_live_gemessene_form` unangetastet), `.env.example`, `render.yaml` (Default `false`, Kommentar zur Owner-Abhaengigkeit).

**Tests:** neue Datei `test/sec-p4-mandanten-token.test.js` (P4-1 bis P4-8: einheitliche Ablehnung, Bestandsform, Riegel scharf, Rotprobe P4-3b, zwei Positiv-Kontrollen, fail-closed, Consult-Seite, Ableitungs-Einheitstest) plus Anpassung von 9 Bestandstestdateien auf den neuen einheitlichen Grund/die neue Variable/den neuen Config-Namespace-Zaehler.

## Impl-Zusammenfassung

Testbestand nach Merge: 216 Tests, 0 Fehler, `node --check` gruen fuer alle 4 Kern-Dateien. Umgesetzt exakt wie geplant: `toolDenied`/`denyBoundCall`/`boundCallFor` als geteilter Ablehnungsweg beider Werkzeug-Webhooks, `tenantToolToken`/`tenantTokenVerdict` als reine Ableitungs-/Urteilsfunktionen, Schalter `ELEVENLABS_TENANT_TOKEN_REQUIRED` (Default `false`) in `config.js`, `.env.example`, `render.yaml`, `BASE_ENV`. `PLAN-SECURITY.md` zusaetzlich um SEC-P4-Abschnitt ergaenzt (CLAUDE.md-Pflicht bei Security-Aenderungen). Nicht gepusht, nicht deployt, kein Live-Wert geaendert — Owner-Blocker bleibt: `PATCH /v1/convai/tools/{id}` fuer beide Werkzeuge muss von Hand erfolgen, danach GET-Neumessung, `_live_gemessene_form` nachziehen, Testanruf, dann erst `ELEVENLABS_TENANT_TOKEN_REQUIRED=true`.

### Deviations (4 fachlich, 1 Werkzeug-Setup)

1. `test/config-namespaces.test.js` pinnt zusaetzlich `EXPECTED_PRIMITIVE_LEAVES` (172→173) — im Plan nicht genannt, ohne Anpassung waere der Test rot gewesen.
2. Plan-Fall P4-1 korrigiert: der geplante Aufbau (faehiger fremder Mandant, Schalter AUS, kein Token) antwortet `200`, nicht `404` — Test nutzt stattdessen einen zweiten fremden Mandanten OHNE Profil, damit der einheitliche Grund tatsaechlich an der Faehigkeits-Ablehnung gemessen wird.
3. Plan-Fall P4-3b korrigiert: "derselbe Request mit Schalter AUS → 200" war unmoeglich, weil ein vorgelegter FALSCHER Wert auch bei ausgeschaltetem Schalter abgelehnt wird (das ist die additive Haelfte, P4-6). Die Rotprobe faehrt stattdessen den heutigen Zustand (Schalter AUS, GAR kein `tenant_token`) gegen den faehigen fremden Anruf → `200` + Suchdienst 1x.
4. Zusaetzlich zum Plan: `PLAN-SECURITY.md`-Abschnitt ergaenzt (CLAUDE.md-Pflicht).
5. Werkzeug-Setup: der vorgegebene `ln -s ./node_modules node_modules`-Befehl erzeugte einen selbstbezueglichen Symlink (eslint Exit 194, leere Ausgabe); ersetzt durch Symlink auf den echten Hauptbaum-Pfad, nicht committet (gitignored).

Zusaetzlich (nicht sicherheitsrelevant): Hilfsfunktion `verbrauchteVariableVon` in `test/el-vorlage-variablen-abgleich.test.js` ausgelagert, weil `toolVariableNamesIn` sonst die eslint-complexity-Grenze (10) mit 11 gerissen haette.

## Safety-Urteil

**PASS**, `approved: true`. Tests unabhaengig nachgefahren (frischer Worktree, Branch `review-sec-p4` von `sec/p4`): 216/216 gruen, 0 fail. HMAC-Ableitung von Hand nachgerechnet und bestaetigt (`HMAC("s","v1:t") = 86e46dc5...1629a`). Alle Kernpunkte bestaetigt: Safety-Gates unangetastet (Reihenfolge Geheimnis→Bindung(+Mandant)→Faehigkeit→Geld→Nutzlast→Wirkung unveraendert, keine der bestehenden Gates entfernt/aufgeweicht), Offenlegung unberuehrt (`disclosure` kommt im Diff 0x vor), Auth fail-closed unveraendert (neue Stufe ist rein additiv und selbst fail-closed), keine Secrets geleakt (Wert steht in keinem Prompt, keinem Log, keinem Store-Schreibweg), Scope respektiert (1 Commit, 20 Dateien, keine neue Dependency), Verhalten wie in der Spec (Rotprobe P4-3b zeigt den Defekt VOR dem Riegel, P4-3 danach geschlossen).

**Concerns (keine Blocker):**
- Flag AUS ist bewusst NICHT byte-identisch (vorgelegter falscher Token wird schon jetzt abgelehnt; Faehigkeits-Ablehnung antwortet jetzt einheitlich) — von der Spec so verlangt, kein Konsument im Repo liest den alten Rumpf.
- Restliches Auskunfts-Orakel bei Flag AUS bleibt: 402/400/404-kein_freier_platz unterscheiden weiterhin gebundenen fremden Anruf von erfundener `conversation_id` — geschlossen erst mit scharfem Schalter.
- `tenant_token` wird ab sofort bei jedem EL-Outbound mitgeschickt, auch mit Flag AUS — nur gegen Test-Attrappe gemessen, nie gegen Live-Anbieter; erster echter Anruf nach Deploy ist die eigentliche Messung.
- Abgeleiteter Wert liegt danach im Gespraechsdatensatz des Anbieters (dynamic_variables dort einsehbar) — HMAC-abgeleitet, gibt Plattform-Token nicht preis, aber verlaesst unser System.
- Doku-Drift ausserhalb des Diffs: `.fortschritt.md` und `PLAN-ANRUFDEFEKTE.md` nennen noch den alten Aussen-Grund `kanal_nicht_freigegeben` (stimmt fuer die Antwort nach SEC-P4 nicht mehr, nur noch fuers Log).
- Scharfschalten braucht zwingend Owner-Handlung (Anbieter-Push); ohne sie fuehrt `true` zu 404 im laufenden Gespraech (Lehre `in-call-research-is-mandatory`) — Default korrekt `false` an allen vier Stellen.

## Clean-Code-Audit (s1-s4)

- **s1 (Blocker):** keine Funde.
- **s2 (Blocker):** keine Funde.
- **s3 (Info):** 1 Fund — `test/elevenlabs-agent-werkzeuge.test.js`: zwei separate Konstanten `TENANT_TOKEN_KEY` und `TENANT_TOKEN_VARIABLE` tragen denselben Wert `"tenant_token"` ohne unterscheidbaren Fall; Vorschlag: zusammenfassen oder kommentieren, warum zwei Namen noetig sind. Rein kosmetisch, kein Blocker.
- **s4 (Blocker):** keine Funde.
- **verdict:** PASS. Bindung sauber (HMAC-Ableitung fail-closed, timing-sicher via `safeEqual`), vereinheitlichte Ablehnung nach aussen, Log unterscheidet weiter, Feature-Flag mit dokumentierter Owner-Blocker-Abhaengigkeit, keine Duplizierung, alle Absoluten Regeln eingehalten.

**topTodos aus dem Audit:**
1. Owner-Blocker abarbeiten: `PATCH /v1/convai/tools/{tool_id}` fuer beide Werkzeuge, danach GET-Neumessung + `_live_gemessene_form` nachziehen, Testanruf, dann `ELEVENLABS_TENANT_TOKEN_REQUIRED=true`.
2. S3-Nachschau (`TENANT_TOKEN_KEY`/`TENANT_TOKEN_VARIABLE`) bei naechster Beruehrung der Datei aufraeumen.
3. Nach Merge: Prozessmuell der Kette (Kickoff-Prompts, per-run-Skripte unter `.claude/workflows/runs/`) gemaess CLAUDE.md-Pflicht entfernen.

## Fix-Runden

Keine — Plan, Safety-Review und Clean-Code-Audit erreichten PASS im ersten Durchlauf, ohne Fix-Runden.
