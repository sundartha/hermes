# Phase IEL-B9: Cutover-Werkzeug

**Gate: PASS**
**finalBranch:** `phase/iel-b9-cutover-werkzeug`
**Basis:** master `195b27b`
**Head-Commit:** `137fdbf`

## Plan (gekuerzt)

Ziel: Werkzeuge fuer den Anbieter-Cutover (ElevenLabs Inbound), reine Skript-/Tooling-Phase, kein Server-/Routen-Verhalten.

**Befunde am Code / bindende Entscheidungen:**
- Pfad-Konstanten aus B6 (`ELEVENLABS_INIT_PATH`, `INIT_TOKEN_HEADER`) existieren bereits, storefrei belegt per Import-Spion.
- Render-API-Verhalten aus api-docs.render.com belegt: Service-Details, Env-Var-GET, Custom-Domains (Paginierung, `verificationStatus`).
- **P1** — Vorlage ohne `ausgenommen` (verschoebe die Frist-Logik der Drift-Rotprobe); Schutz stattdessen per Code-Riegel.
- **P2** — Schalter (`init_webhook_schalter`) wird nur geschrieben, wenn `--felder` ihn ausdruecklich nennt (Freigaben-Wache).
- **P3** — Pfade kommen aus der Vorlage via neuem Export `livePfadeVon(vorlage, feld)`, kein zweiter Ort kennt den Aufbau der Besitz-Erklaerung.
- **P4** — `--entfernen` laeuft ohne Ziel-Urteil und ohne Render-Zugriff.
- **P5** — Gegenprobe: alle Workspace-Settings ausser dem Init-Webhook-Schluessel werden vor/nach dem PATCH tief verglichen; jede Abweichung ist ROT ohne automatischen Rueckbau.
- **P6** — Eine Quelle fuer das Endungsformat (`e164Endung`), verhaltensgleiche Extraktion.
- Offen fuer den Lead: Runbook-Schritt 6 ("Schalter false pushen") braucht eine lokale Vorlagenaenderung plus `--felder=init_webhook_schalter --ausfuehren`.

**Neue Dateien:**
- `src/elevenlabs/init-webhook-ziel.js` — einzige Quelle des Init-Ziels; Render-Basis ist Konstante, nie aus Env; `renderDienstZiel` (nur GET, seriell, wirft nie außer bei Netzfehler -> Grund), `zielUrteil` (rein) mit Gruenden `API_KEY_FEHLT`, `RENDER_NICHT_ERREICHBAR`, `RENDER_STATUS`, `DOMAINS_UNVOLLSTAENDIG`, `ORIGIN_LEER/UNGUELTIG/NICHT_HTTPS/NICHT_ERLAUBT`, `HOST_NICHT_ZUGEORDNET`.
- `test/iel-b9-cutover-skripte.test.js` — 24 geplante Faelle (A: Ziel-Urteil, B: Workspace-Init-Webhook, C: Freigaben-Wache, D: el-nummern-registrierung), plus Quelltext-Pins mit Positiv-Kontrollen.
- `test/_import-spion-store.mjs` — Preload per `node:module` `registerHooks`, meldet Import von `src/store.js`.
- `test/_iel-b9-push-harness.mjs` — Kindprozess-Harness fuer PUBLIC_URL-Unabhaengigkeit.

**Edits:**
- `elevenlabs/agent_configs/outbound-agent.template.json`: neuer Schalter `platform_settings.overrides.enable_conversation_initiation_client_data_from_webhook` + Besitz-Eintrag `init_webhook_schalter` (ohne `ausgenommen`, mit Rueckweg-Hinweis).
- `scripts/lib/elevenlabs-besitz.mjs`: neuer Export `livePfadeVon`.
- `src/elevenlabs/convai.js`: `fetchConvaiSettings` (lesend), `patchConvaiSettings` (schreibend, einziger Aufrufer `push-elevenlabs.mjs`).
- `src/elevenlabs/inbound-path-decision.js`: `e164Endung` extrahiert, verhaltensgleich.
- `src/elevenlabs/nummern-registrierung.js`: Lese-Helfer `registrierungsKlasse`, `holeRegistrierungen`, `registrierungenMitNummer`, `inventarUrteil`, `inventarSchnappschuss` (PII-arme Projektion, nie username/volle Nummer/allowed_addresses).
- `scripts/el-nummern-registrierung.mjs`: neue Modi `--trunk-inventar` (nur lesend) und `--registrierung-loeschen --id=<phnum_…> [--ja-wirklich]`, beide ohne Store-Import (E13); fail-closed bei unbekannten Argumenten/Modus-Konflikt; Bestandsmodi unveraendert in `laufeStoreModus`.
- `scripts/push-elevenlabs.mjs`: neuer Modus `--workspace-init-webhook` (`--secret-id` | `--entfernen`, Default Trockenlauf) + Freigaben-Wache (Riegel 8).
- `test/helpers/elevenlabs-push-attrappe.mjs`: neuer Export `laufeMitRouter`, `laufeMitAttrappe` delegiert (verhaltensgleich fuer Bestandstests).
- `PLAN-SECURITY.md`: neuer Abschnitt `## IEL-B9 — Anbieter-Konfiguration fuer Inbound (2026-09-15)` mit UNBELEGT-Eintrag (Registrierung ohne `inbound_trunk` lehnt INVITE ab) und M8-Kostenrisiko.

**Deterministisch pruefbares Ergebnis (Plan Abschnitt 4):** `node --check` auf allen geaenderten Dateien, gezielter Testlauf, Positiv-/Negativ-Greps (`credentials`, `IEL-B9`, `publicUrl`/`PUBLIC_URL`), manueller Trockenlauf-Smoke gegen Fake-Basis, volle `npm test`, `git diff --stat` gegen master.

## Impl-Zusammenfassung

Branch `phase/iel-b9-cutover-werkzeug`, Commit `137fdbf`. `nodeCheckPass=true`, `testsPass=true`, 5793 Tests / 0 Fehler (volle Bank, `--test-concurrency=4`).

Neu: `src/elevenlabs/init-webhook-ziel.js` (initWebhookUrl als Repo-Konstante, renderDienstZiel nur GET/seriell/wirft nie, reines zielUrteil mit ZIEL_GRUND). `push-elevenlabs.mjs`: Modus `--workspace-init-webhook` (`--secret-id` | `--entfernen`, Trockenlauf Default; Ziel-Urteil vor jedem EL-Aufruf, Header nur `{secret_id}`, Lesebeleg + P5-Gegenprobe der uebrigen Settings nur mit Schluesselnamen, `--entfernen` ohne Render) sowie Freigaben-Wache (Riegel 8: Schalter nur ausdruecklich, Minimal-Body unter `overrides`, Karte lesbar, keine offene `agent.prompt`-Freigabe, Nachher-Tiefvergleich mit Rueckweg). Vorlage: `overrides.enable_conversation_initiation_client_data_from_webhook=true` + Besitz-Eintrag `init_webhook_schalter` ohne `ausgenommen`. `besitz.mjs#livePfadeVon`, `convai.js` fetch/patchConvaiSettings, `inbound-path-decision.js#e164Endung` (verhaltensgleich), `nummern-registrierung.js` Lese-Helfer (Klasse, holeRegistrierungen, registrierungenMitNummer, inventarUrteil, inventarSchnappschuss). `el-nummern-registrierung.mjs`: `--trunk-inventar` und `--registrierung-loeschen --id` `[--ja-wirklich]` vor dem Store-Import, Erfolg per Lesebeleg; unbekannte Argumente/Modus-Konflikt fail-closed; Bestandsmodi unveraendert in `laufeStoreModus`. `PLAN-SECURITY.md` Abschnitt IEL-B9.

Tests: `test/iel-b9-cutover-skripte.test.js` (26 Faelle inkl. Harness-Spawn fuer PUBLIC_URL-Unabhaengigkeit, Import-Spion mit Positiv-Kontrolle, CLI-Stub, Quelltext-Pins), neue Test-Helfer `test/_import-spion-store.mjs` und `test/_iel-b9-push-harness.mjs`. Gezielte Datei 26/26 gruen, volle Bank `npm test --test-concurrency=4`: 5793 pass / 0 fail. Manueller CLI-Smoke gegen Fake-Basis: `--registrierung-loeschen` zeigt TROCKENLAUF und endet mit exit 0, `--trunk-inventar` zeigt INVENTAR GRUEN und endet mit exit 0.

Server-Smoke ist entfallen (`smokePass=false`): Boot lokal verweigert (fehlendes `PUBLIC_URL`, dann "Keine aktive Nummer im Store" ohne Seed); keine Serverroute in dieser Phase geaendert, Ersatz-Smoke laut Plan manuell gefahren.

### Deviations

1. `RENDER_API_KEY` wird NICHT direkt aus `process.env` im Skript gelesen, sondern ueber `src/config.js` (`config.voice.elevenLabsInbound.renderApiKey`). Grund: Pre-Commit-Lint (`no-restricted-properties`, G35) lehnt `process.env` ausserhalb von `config.js` hart ab, CLAUDE.md verlangt Zentralisierung. Folge: Schluessel steht in `.env.example` (Plan hatte das B10 zugeordnet) und in `BASE_ENV` (`test/helpers.js`), nicht in `render.yaml`. Lokal kann dotenv ihn aus `.env` lesen (Plan sagte "nur Prozess-Env"). Render-Basis bleibt Konstante.
2. Test 5 (ohne `RENDER_API_KEY`) laeuft als Kindprozess ueber den Harness, nicht in-process: `config.js` liest den Schluessel nur einmal beim Import.
3. Geteilte Test-Fixture `LIVE_MIT_DATENSCHUTZ` (`test/helpers/elevenlabs-push-attrappe.mjs`) traegt jetzt `overrides.enable_conversation_initiation_client_data_from_webhook=true`. Ohne das wuerde der bestehende Test "Trockenlauf ohne Feldauswahl" (`elevenlabs-push-feldauswahl`) rot: der neue Vorlagen-Schalter wich ab, die Freigaben-Wache (P2) greift wie geplant und liefert Exit 1. Die Plan-Annahme "Bestandssuiten bleiben ohne Aenderung gruen" stimmte hier nicht; die Testdateien selbst sind unveraendert, der ROT-Fall ohne `--felder` wird eigens in IEL-B9-17 geprueft.
4. Folge fuer den Betrieb: ein `npm run elevenlabs:push` ohne `--felder` (auch als Trockenlauf) endet jetzt mit ROT und Exit 1, solange der Live-Schalter vom SOLL (`true`) abweicht. Das ist von P2/Test 17 vorgesehen, sollte aber im Runbook stehen.
5. Test 19 (Liste 500 / Einzel-GET 500): `trunkInventar` wirft auf Funktionsebene mit `providerStatus 500`. Exit 1 entsteht erst im Haupt-catch des Skripts, belegt per Spawn in Test 22.
6. Test 24 prueft die Pin-Regex aus Plan Abschnitt 4 (`config(.server)?.publicUrl|process.env.PUBLIC_URL`), nicht das nackte Wort `publicUrl` — Grund: der Plan schreibt fuer `init-webhook-ziel.js` selbst das Feld `publicUrlEnv` vor.
7. Zusaetzliche kleine Faelle IEL-B9-1b (unverifizierte Domain) und IEL-B9-2b (fetch-Wurf) sowie Aufteilung der Describe-Bloecke (max-lines-per-function des Lints).
8. Offen fuer den Lead (aus dem Plan uebernommen): Runbook 6 "Schalter false pushen" braucht eine lokale Vorlagenaenderung auf `false` plus `--felder=init_webhook_schalter --ausfuehren`.

## Safety-Urteil

**approved: true** — alle Kern-Flags true (`testsPassIndependently`, `safetyGatesIntact`, `disclosureIntact`, `authFailClosedIntact`, `noSecretsLeaked`, `behaviorAsIntended`, `scopeRespected`), 0 Blocker, 7 Concerns.

Unabhaengige Verifikation: Review-Branch `review-iel-b9` von `phase/iel-b9-cutover-werkzeug` (`137fdbf`, merge-base `master 195b27b`).
1. Neue Testdatei allein: 26/26 gruen.
2. 41 betroffene Testdateien mit `npm test`-Filter (`--test-concurrency=4`): 583/583 gruen. Ohne Filter: 584 Tests, 1 Fail = `ABNAHME-AS10` (Abnahmekriterium, darf rot sein, ausserhalb `npm test`, betrifft eine tasks-Doku, die dieses Diff nicht anfasst; die Datei ist 8/8 gruen mit Filter).
3. Spec-Greps: `credentials` ohne Treffer in `el-nummern-registrierung.mjs`/`push-elevenlabs.mjs`; `publicUrl`/`PUBLIC_URL` ohne Treffer in `init-webhook-ziel.js`/`push-elevenlabs.mjs`; Positiv-Kontrollen treffen (`renderDienstZiel`, `init-webhook-ziel`, `IEL-B9` in `PLAN-SECURITY.md`).
4. Store-Modi `--pruefen`/`--anlegen`: Koerper von `laufeStoreModus` textlich identisch mit dem alten `runCli` nach dem Key/Argv-Vorlauf.
5. Diff-Review: keine Aenderung an Routen, `route-policy`, `voice.js`, `claude.js`, `outbound-gates`, Billing oder Budget-Code. Vorlage aendert nur das neue Feld plus den Schalter; `first_message` und Freigaben-Karte unveraendert. Keine neue Dependency.

**Concerns (7, keine oeffnet ein Gate — alle fail-closed):**
1. Riegel 8 aendert das Verhalten des bestehenden Push-Modus ohne `--felder`: bis Runbook-Schritt 6 endet ein Plain-Lauf mit "SCHALTER NUR AUSDRUECKLICH", Exit 1, auch als Trockenlauf. Noetig (verhindert Nebenwirkungs-Schreiben), aber nicht wortwoertlich byte-identisch; Test-Fixture `LIVE_MIT_DATENSCHUTZ` musste angepasst werden.
2. Rueckbau ist asymmetrisch: Riegel 8 blockiert auch das Zurueckschreiben des Schalters auf `false`, solange eine `agent.prompt`-Freigabe offen ist — genau der Zustand nach einem fehlgeschlagenen Schreiben. Karte muss zuerst repariert werden. Andere Rueckwege (`--entfernen`, `ELEVENLABS_INBOUND_ENABLED`) unberuehrt.
3. `test/_import-spion-store.mjs` nutzt `module.registerHooks`, das Node >=22.15 (oder >=23.5) braucht; `package.json` engines `>=22 <23`, `.nvmrc` 22 — auf Node 22.0-22.14 faellt Test IEL-B9-23 laut statt still. Eigener Lauf war Node v26.7.0.
4. `uebrigeSettingsVeraendert` (P5) vergleicht alle uebrigen Workspace-Settings vor/nach; liefert der Anbieter sich selbst aendernde Felder (z.B. Timestamps), endet ein erfolgreiches Schreiben trotzdem ROT ohne automatischen Rueckbau — fail-closed, ungemessen.
5. Der gruene PATCH-Fall ueber die CLI ist nur mit `PUBLIC_URL=https://app.sundartha.com` end-to-end getestet; die Spec-Varianten (`vodafone-agent.onrender.com`, oder unset + erlaubte Service-URL) sind nur ueber die reine `zielUrteil`-Tabelle (Test 1) abgedeckt, nicht end-to-end mit PATCH.
6. `RENDER_API_KEY` sitzt in `config.voice.elevenLabsInbound.renderApiKey` — ein Werkzeug-Schluessel in einem Server-Config-Namespace. Waere er je auf dem Render-Dienst gesetzt, haette der Serverprozess ihn im Speicher. Nichts in `src` liest ihn, nicht in `render.yaml`, nicht im Config-Fingerprint.
7. Die zitierten Render-API-Antwortformen (`serviceDetails.url`, 404 beim Env-GET fuer unset, `verificationStatus === "verified"`) sind aus der Doku im Code-Kommentar belegt, aber nicht erneut nachgeprueft. Jede Abweichung fuehrt zu ROT (fail-closed), keine zu Gruen.

**Verdict:** APPROVED (0 Blocker, 7 Concerns). Reine Werkzeug-Phase, keine Route/Auth/Offenlegung/Budget-Engine angefasst; mit dem Schalter aus ist der Server unveraendert bis auf einen ungenutzten Config-Key und eine verhaltensgleiche Extraktion.

## Clean-Code-Audit (S1-S4)

- **s1: []** — keine Blocker.
- **s2: []** — keine Blocker.
- **s3 (2 Befunde, unkritisch):**
  1. `scripts/el-nummern-registrierung.mjs` deckt jetzt vier CLI-Modi ab (pruefen/anlegen/trunk-inventar/registrierung-loeschen) — fachlich verwandt, naehert sich aber der Grenze eines einzigen klaren Zwecks. Kein Fix noetig, nur beobachten falls ein fuenfter Modus dazukommt (dann Split erwaegen).
  2. `src/elevenlabs/init-webhook-ziel.js` traegt grosse, dichte Kopf-Kommentare mit eingebetteter API-Doku (Render-Endpunkte) — bewusst so gewaehlt (Beleg-Pflicht laut Repo-Konvention), nur Randnotiz.
- **s4 (1 Befund):** `scripts/push-elevenlabs.mjs` bekommt einen achten Riegel (Freigaben-Wache) zum bestehenden Sieben-Riegel-Muster; setzt die bisherige Architektur konsistent fort, keine neue Indirektion ohne Mehrwert — nur Wachstumshinweis.

**verdict: PASS (keine Blocker).** Reines Werkzeug/Skript-Update, kein Server-/Routen-/Gate-Verhalten geaendert, durchgaengig fail-closed (DIP via `fetchImpl`-Injektion, PII-arme Projektion, Zweit-Bestaetigung fuer jeden Schreibweg), grosse gezielt positiv-kontrollierte Testsuite (24 Faelle inkl. Kindprozess-Haertetests fuer PUBLIC_URL-Isolation und Store-Nichtladen).

**passNotes (Auszug):** jeder neue Schreibweg Default-Trockenlauf mit expliziter Zweitbestaetigung; `RENDER_API_KEY` sauber zentralisiert, dokumentiert, nie geloggt (aktiv per Test belegt); Ziel-URL ist Code-Konstante, eigens per Kindprozess-Test gegen `PUBLIC_URL`-Beeinflussung abgesichert; Secret nur als `{secret_id}`-Verweis; PII-arme Projektion schliesst username/volle Nummer/allowed_addresses aus (Positiv-Kontrolle im Test); Store nachweislich nie geladen in den neuen Modi (Import-Spion + Positiv-Kontrolle); Gegenprobe nach jedem PATCH verhindert stille Nebenwirkungen; `PLAN-SECURITY.md` dokumentiert bewusst akzeptierte Restrisiken statt sie zu verschweigen.

**topTodos:** keine Blocker zu beheben; beobachten (fuenfter CLI-Modus -> SRP-Split pruefen); operativ (kein Code-Befund): "Registrierung ohne `inbound_trunk` lehnt INVITE ab" bleibt UNBELEGT bis zum N2-Messlauf, relevant vor dem Runbook-Cutover.

## Ergaenzende Security-Review (final)

**approved: true, blockers: []**. Bestaetigt unabhaengig: keine neue/geaenderte Route, `route-policy.js`/`server.js` unberuehrt, kein Eintrag in `route-auth-inventory` noetig; die sieben Sicherungen in `/voice/incoming`, Offenlegung, Tenant-Kostendecke, `OUTBOUND_FROZEN` und Budget-Engine unangetastet; keine neue Dependency. Testlaeufe: `iel-b9-cutover-skripte.test.js` 26/26, dazu elevenlabs-*, iel-*, `route-auth-inventory`, `boot-prod-footguns` zusammen 563/563 gruen (`--test-concurrency=4`).

**Concerns (5, additiv zu den Safety-Concerns):**
1. `push-elevenlabs.mjs#mitSecretId`/`meldeInitWebhookPlan`: `--secret-id`-Wert wird nicht formatgeprueft und im Klartext ausgegeben — fuegt ein Operator versehentlich den Token-WERT statt der secret_id ein, landet das Geheimnis im Terminal/Transkript und geht per PATCH an den Anbieter. Kein Spec-Verstoss, aber Empfehlung: Plausibilitaets-Format/Laengenwarnung fuer `secret_id`.
2. `config.voice.elevenLabsInbound.renderApiKey`: wuerde `RENDER_API_KEY` versehentlich im Render-Dienst selbst gesetzt, haelt der oeffentliche Server einen Render-Schluessel mit vollem Workspace-Zugriff. Kein Leak-Pfad gefunden, aber keine Boot-Warnung/-Riegel dagegen — waere billige Haertung.
3. Ein ROT nach dem PATCH (Freigaben-Karte oder Gegenprobe veraendert) baut nicht automatisch zurueck, nur der Rueckweg wird ausgegeben — bewusst akzeptiert laut Spec/`PLAN-SECURITY.md` §7; Runbook-Schritt 6 muss den sofortigen Rueckweg verbindlich machen.
4. `registrierungLoeschen`: beachtet `outbound_trunk` nicht vor dem DELETE einer OFFEN-Registrierung — traegt sie zugleich die Outbound-Absender-Konfiguration einer Tenant-DID, bricht das Loeschen still den Outbound dieses Tenants (Verfuegbarkeitsrisiko, kein Sicherheitsdefekt). Empfehlung: Warnzeile im Trockenlauf bei `outbound_trunk=ja`.
5. `uebrigeSettingsVeraendert` und Lesebeleg haengen an der ungemessenen GET-Form des Anbieters (z.B. ob `request_headers` als `{secret_id}` zurueckkommt) — Formabweichung fuehrt erst nach dem PATCH zu ROT; fail-closed, aber Betriebsrisiko beim Cutover.

## Fix-Runden

Keine — der Lauf war in Runde 1 gruen (0 S1/S2-Befunde, Safety approved ohne Blocker). Keine Nachbesserungen erforderlich.
