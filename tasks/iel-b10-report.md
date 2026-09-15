# Phase IEL-B10: Geheimnis-Werkzeug (erzeugen, verteilen, belegen)

- **Gate:** PASS
- **finalBranch:** `phase/iel-b10-geheimnisse`
- **Basis:** `phase/iel-b9-cutover-werkzeug` (137fdbf), Head-Commit `308893c`
- **Tests:** 5813 pass / 0 fail (`npm test -- --test-concurrency=4`), davon 20 neue Tests in `test/iel-b10-geheimnisse.test.js`

## Plan (gekuerzt)

Neues CLI `scripts/iel-geheimnisse.mjs` mit sechs Unterbefehlen (`setzen`, `beleg-init`, `allowlist-uebernehmen`, `schalter`, `stimmen-beleg`, `conversation-beleg`), aufgeteilt in Helfer-Module `scripts/iel-geheimnisse-{ausgabe,render,setzen,belege,conversation,schalter}.mjs`. Ziel: die drei Inbound-Geheimnisse (SIP-User, SIP-Passwort, Init-Webhook-Token) per CSPRNG erzeugen, auf Render (Env-Vars), ElevenLabs-Workspace-Secret und Registrierungs-`inbound_trunk_config` verteilen und die Verteilung ausschliesslich lesend belegen — Trockenlauf als Default, ein Ausgabe-Waechter als einzige Ausgabestelle, Fehlerkoerper der Anbieter nie lesen.

**Offene Lead-Entscheidungen mit Default:**
- **L-1** (Quelle `RENDER_API_KEY`): Spec verlangt Prozess-Env, nicht `src/config.js`. Default im Plan war direktes `process.env`-Lesen im Einstieg; Alternative war ein eigener Konfig-Namespace.
- **L-2** (`media_encryption` im Registrierungs-PATCH): Spec-Koerper unveraendert senden, Abweichung nur ueber Lesebeleg sichtbar machen (kein aktives Setzen).

**Abgedeckte Anbieter-Belege (vorab gelesen, im Code zitiert):** Render `PUT/GET env-vars`, ElevenLabs `secrets` (list/create/update), `phone-numbers` PATCH, `conversations` (Liste + Einzel-GET, `direction` kein Filter-Parameter), `agents` GET, TTS-Stream-Fehlerform.

**Neue Datei `src/render-api.js`:** geteilte Render-Zugriffsschicht (vermeidet Duplizierung B9/B10); `envVarPfad` wirft bei leerem Schluessel vor jedem `fetch` (Listen-Endpunkt baulich unerreichbar).

**Sicherheitsarchitektur laut Plan:** Vorab-Riegel (nur GET: Inventar, Zuordnung `--nummer`↔Registrierung, offene Fremdzugaenge, Secret-Eindeutigkeit) vor jedem Schreiben; feste Reihenfolge Render→Secret→Registrierung mit Abbruch beim ersten Fehlschlag; abschliessendes Inventar als letzter Aufruf; `schalter --an` schreibt nur, wenn Inventar+`beleg-init`+`stimmen-beleg`+Laengen-Pruefung im selben Lauf gruen sind, `--aus` bedingungslos.

**Tests (Plan):** 20 Faelle IEL-B10-1 bis -16 inkl. Teilausfall (1a/b/c), halbe Rotation (6a/6b), Ziel-Urteil (8z), Waechter-Kuerzung (13a), Spawn-Test mit Import-Spion + Positiv-Kontrolle (14), Abnahme-Greps (15).

## Impl-Zusammenfassung + Deviations

Gebaut wie geplant auf `phase/iel-b10-geheimnisse`, ein Commit `308893c` auf Basis `137fdbf`. Neue Module: `src/render-api.js`, sieben `scripts/iel-geheimnisse*.mjs`, `test/iel-b10-geheimnisse.test.js`. Edits: `src/elevenlabs/init-webhook-ziel.js` (nutzt jetzt `render-api.js`, Verhalten unveraendert — B9-Tests bleiben gruen), `src/elevenlabs/convai.js` (+6 Funktionen: Secrets list/create/update, `patchPhoneNumber`, `listConversations`, `fetchAgent`), kleine Exports (`csvEnv`, `ELEVENLABS_VOICE_ID_BY_PROFILE`, `INIT_WEBHOOK_SETTINGS_SCHLUESSEL`), `.env.example`, `PLAN-SECURITY.md` (neuer Abschnitt IEL-B10).

**Deviations:**
1. **L-1 abgewichen vom Plan-Default:** Direktes `process.env`-Lesen ausserhalb `config.js` scheitert am Repo-Lint (`no-restricted-properties`, keine Inline-Disables erlaubt). Stattdessen wurde die im Plan vorgesehene *Alternative* gebaut: `RENDER_API_KEY` liegt jetzt in einem neuen Konfig-Namespace `config.werkzeug.renderApiKey` (statt `voice.elevenLabsInbound`). Folge: `test/config-namespaces.test.js` musste in Zaehlern angepasst werden (Namespace `werkzeug`=1, `EXPECTED_TOTAL_KEYS` 189→190, `EXPECTED_PRIMITIVE_LEAVES` 177→178).
2. Ein Befehls-Tabellen-Ansatz (`BEFEHLE`) statt zwei paralleler Switches (vermeidet G23-Verstoss).
3. Fehlende-Schluessel-Pruefung zentral im Einstieg statt verteilt in `vorabRiegel`/Render-Modul — gleiches Ergebnis (Test 6).
4. Top-Level-Catch in `runCli` (konstante Zeile + `providerStatus`), Hauptmodul-Guard setzt `process.exitCode` statt `process.exit`.
5. Zusaetzlicher Export `RENDER_GEHEIMNISSE` (Schluessel→Feld-Mapping) geteilt zwischen `setzen` und `schalter` (G5).
6. `leseRenderEnvVar` liefert nur String-Werte, alles andere wird `null` — B9-Tests bleiben unveraendert gruen, da Render immer Strings liefert.
7. Workspace-Secret-Schritt in der Ziel-Tabelle zaehlt nur als gesetzt, wenn die Antwort eine `secret_id` enthaelt.

`smokePass: false` — Server-Smoke erreichte `/healthz` nicht (Boot brach an bestehendem Boot-Guard ab, "keine aktive Nummer im Store"; unveraendertes Verhalten, diese Phase aendert keinen Servercode). CLI selbst wurde per Kindprozess-Test (IEL-B10-14) smoke-getestet: Exit 0, Trockenlauf, nur GET-Aufrufe, kein Store-Import.

## Safety-Urteil

**APPROVED mit Concerns**, keine Blocker. Kernaussagen: reines Werkzeug, keine Server-/Routen-/Safety-Gate-/Offenlegungs-/Auth-Aenderung. Trockenlauf ist Default; Vorab-Riegel rein lesend; Reihenfolge Render→Secret→Registrierung mit Abbruch beim ersten Fehlschlag; Render-Listen-Endpunkt baulich unerreichbar; nur fuenf benannte Schluessel schreibbar; `schalter --an` nur bei vollstaendig gruenem Vorlauf; Ausgabe-Waechter als einzige Ausgabestelle, Anbieter-Fehlerkoerper nie gelesen. Unabhaengiger Testlauf (frischer Worktree, 17 betroffene Testdateien, 296/296 gruen) bestaetigt.

**Concerns (nicht blockierend):**
- Scope-Ueberhang ueber die B10-Dateiliste hinaus (Konfig-Namespace-Verschiebung, `convai.js`-Erweiterung, `render-api.js` neu) — additiv, dokumentiert in `PLAN-SECURITY.md` §9, Lead sollte bewusst abnehmen.
- `RENDER_API_KEY` liegt trotz E16-Wortlaut ("nicht in src/config.js") jetzt in `config.werkzeug` und kann damit aus der lokalen `.env` kommen (dotenv-Ladepfad) — dokumentierte Abweichung, bleibt eine.
- `schalter --an` im Trockenlauf ist nicht netzfrei: laeuft `beleg-init` (2 POSTs an den Live-Init-Webhook) und `stimmen-beleg` (Probe-Synthesen mit minimalen TTS-Kosten) mit — spec-konform, sollte im Runbook so benannt sein.
- `PLAN-SECURITY.md` §10 zu weit gefasst: Aussage "Schalter bleibt bis zum letzten PUT aus" gilt nur beim Ersteinrichten, nicht bei einer Rotation mit bereits aktivem Schalter (dort waere ein Zwischenzustand denkbar, aber fail-safe durch Digest-Fehlschlag → Rueckfall).
- `leseRenderEnvVar` macht aus Nicht-String-Werten `null` — im Ziel-Urteil dadurch minimal weniger fail-closed als vorher (praktisch wirkungslos, da Render-Werte immer Strings sind).
- Secret-`secret_id`-Konflikt am Workspace-Webhook wird erst NACH dem Schreiben im Lesebeleg erkannt (spec-konform, aber liesse sich guenstig vorziehen).
- Registrierungs-PATCH sendet bewusst kein `media_encryption` — Anbieter-Default koennte das M1-`disabled` ersetzen; dokumentiert, Wirkung auf Dial/Sip-Weg ungemessen.
- Clean-Code-Hinweis fuer den Auditor: `iel-geheimnisse-setzen.mjs` importiert `push-elevenlabs.mjs` nur wegen einer Konstante (Skript-Kopplung); zwei Anweisungen auf einer Zeile in Testdatei Zeile 363.

## Clean-Code-Audit (s1-s4)

**Verdict: PASS**, kein Blocker.

- **s1:** keine Befunde.
- **s2:** keine Befunde.
- **s3:** Kopfkommentar in `src/elevenlabs/convai.js:227-233` verschachtelt zwei unabhaengige Aussagen in einem Fluss-Satz (DIP-Hinweis mitten im Aufzaehlungssatz der neuen sechs IEL-B10-Endpunkte). Fix-Empfehlung: Satz trennen, nicht blockierend.
- **s4:** `RENDER_SCHLUESSEL` in `scripts/iel-geheimnisse-render.mjs` enthaelt 9 Eintraege, `SCHREIBBARE_SCHLUESSEL` nur 5 — bewusst und kommentiert (Allowlist im Code), visuell aber schwer auf den ersten Blick zu trennen. Trivial, kein Fix noetig.

**Positiv hervorgehoben:** Ausgabe-Waechter (Verbotsmenge, Pruefung vor Kuerzung, nie Anbieter-Fehlerkoerper) als vorbildliche Sicherheitsarchitektur; DIP durchgehend (injiziertes `fetchImpl`); G23 vermieden (Befehls-Tabelle statt Switch-Kette); G5 durch geteilte Module statt Duplizierung; G25 durchgehend benannte Konstanten; G30/G34 eingehalten (kleine Einzelzweck-Funktionen). Keine Secrets im Diff, `PLAN-SECURITY.md` fuehrt Restrisiken ehrlich auf.

**Top-Todos:** Kopfkommentar in `convai.js` sprachlich entflechten (optional); vor produktivem `setzen --ausfuehren` pruefen, ob ein Render-PUT einen Deploy ausloest (Betriebsrisiko, kein Code-Befund); sonst mergefaehig.

## Fix-Runden

Keine — die Phase erreichte PASS ohne Fix-Runde (S1/S2 = 0 Befunde bereits in der ersten Audit-Runde, Safety approved ohne Blocker in der ersten Sicherheitsrunde).
