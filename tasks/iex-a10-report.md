# Phase IEX-A10: Inbound-Trunk fuer neue Nummern im Onboarding

- **Gate:** PASS
- **finalBranch:** `phase/iex-a10-onboarding-trunk`
- **headCommit:** `38a1fae902661d4879c6796c2daaa55b2a268920`
- **Tests:** 5977 pass, 0 fail (voll), plus 130/130 in geaenderten Dateien und 65/65 in Nachbardateien (unabhaengig nachgemessen)

## Plan (gekuerzt)

Grundlage: `phase/iex-a9-scope-schalter` (e5527fe), Spec §6 IEX-A10 + E13/E15/E16/E11.

Kernbefunde vor der Umsetzung:
- Der Sweep entsteht in `src/server.js`, nicht `boot.js` — der Hook wird dort verdrahtet, `boot.js` bleibt unveraendert (Abweichung von der Spec-Dateiliste).
- `onboarding.js#provisionNumber` hat KEINEN config-Zugriff, nur `deps`; der Schreiber wird deshalb im Produktionsaufrufer `worker/provisioning-orchestrator.js#runProvisioningDrain` injiziert, analog zum bestehenden `sipRegistrar`.
- Kein zweiter Koerperbau: `scripts/iel-geheimnisse-setzen.mjs#trunkKoerper` wird zum Adapter auf eine gemeinsame `inboundTrunkKoerper`-Funktion (G5/S2).
- Grep-Test IEL-B8-9 (Token `sipPassword`) bekommt genau eine neue Lesestelle in `nummern-registrierung.js`.
- Lint-Pin in `eslint-legacy-exceptions.json` fuer `makeProvisioningOrchestrator` musste von 171 auf 172 Zeilen angehoben werden (eine Injektionszeile mehr), mit Begruendung im Kommentar.
- Ergebniszeile des Sweeps bekommt neues Feld `repariert=` direkt nach `belegt=`, zieht mehrere Bestandstests nach (`iex-a8-beleg.test.js`, `iel-b8-weiche.test.js`).

Geplante Aenderungen (Kurzfassung je Datei):
- `src/elevenlabs/nummern-registrierung.js`: neue Funktionen `inboundTrunkKoerper` (eine Koerperform, wirft bei leeren Werten vor jedem Netzzugriff), `inboundTrunkSchreibenErlaubt` (Dreifach-Gate inkl. Scope `registrierte_dids`), `inboundTrunkSchreiberWennErlaubt`, `makeInboundTrunkSchreiber` (PATCH + IMMER Nach-GET, Log nur Status). `elNummernRegistrierungAktiv` als gemeinsame Gate-Quelle extrahiert.
- `src/elevenlabs/inbound-trunk-beleg.js`: `leseTrunkBeleg` geteilt zwischen Sweep und Schreiber (ersetzt `holeBeleg`); neu `reparaturHindernis`/`REPARATUR_HINDERNIS`; `makeTrunkSweep` nimmt optionalen Hook `reparatur` — hoechstens ein Reparaturversuch je Nummer je Lauf, Beleg wird bei Abweichung vor dem Schreiben geloescht; Ergebniszeile mit `repariert=`.
- `src/onboarding.js`: neue `schreibeInboundTrunkFailSoft` nach der Registrierung, setzt Beleg-Felder nur bei `belegt` im Nach-GET, wirft nie nach aussen.
- `src/worker/provisioning-orchestrator.js`: `deps.inboundTrunkSchreiber = inboundTrunkSchreiberWennErlaubt(config)` neben dem bestehenden `sipRegistrar`.
- `src/server.js`: Sweep bekommt `reparatur: inboundTrunkSchreiberWennErlaubt(config)`.
- `scripts/iel-geheimnisse-setzen.mjs`: `trunkKoerper` delegiert an `inboundTrunkKoerper`.
- `src/elevenlabs/convai.js`: nur JSDoc-Kommentar aktualisiert.
- `eslint-legacy-exceptions.json` + `PLAN-SECURITY.md`: Pin-Anhebung bzw. neuer Abschnitt IEX-A10 mit Gate, Sichtbarkeit, Restrisiken (a)-(f).
- Neuer Test `test/iex-a10-onboarding-trunk.test.js` (IEX-A10-1..13), Anpassungen in `test/iex-a8-beleg.test.js` und `test/iel-b8-weiche.test.js`.

Pre-Mortem-Tabelle deckte u.a. ab: Passwort-Leck in Logs, blockierte DID durch Trunk-Fehler, Schreiben trotz `allowlist`-Scope, Reparatur fremder Registrierungen, Beleg ohne echten Trunk, leerer Koerper (`null`/`[]`), lokale Instanz mit Prod-Env, Kostenexplosion.

## Impl-Zusammenfassung

Umgesetzt wie geplant auf `phase/iex-a10-onboarding-trunk` (38a1fae):
- Alle geplanten Funktionen gebaut; `sipPassword` kommt in `nummern-registrierung.js` genau einmal vor (Grep-Test bestaetigt Gesamtzahl 4 im Repo).
- Schreiber sendet PATCH, liest danach IMMER nach (auch bei PATCH-Fehler), loggt nur `providerStatus`, nie Koerper/`err.message`.
- Sweep: Beleg wird bei Abweichung vor Reparaturversuch geloescht; `UNBEKANNT` loescht nie; hoechstens ein Versuch je Nummer je Boot.
- Onboarding: fail-soft, DID bleibt bei jedem Anbieterfehler `active`.
- Neue Testdatei mit 15 Tests (IEX-A10-9 in zwei Tests gesplittet), Mutationschecks bestanden (Entfernen der Injektionszeile bzw. der `outbound_trunk`-Pruefung liess je einen Test rot werden).
- Volle Suite: `npm test -- --test-concurrency=4` → 5977 pass, 0 fail. Lint 0 Befunde. `check-staged-suppressions` gruen mit angehobenem Pin.
- Smoke-Test: Server lokal gestartet, `/healthz` 200, Boot-Log zeigt `[el-trunk] sweep uebersprungen grund=schalter_aus` bei geschlossenem Gate (kein Anbieteraufruf).

### Deviations vom Plan

1. `test/check-staged-suppressions.test.js` musste zusaetzlich geaendert werden (nicht in Spec-Dateiliste): die "Altlast-Ratsche" haelt einen Fingerprint von `eslint-legacy-exceptions.json`, jede Pin-Aenderung braucht dort Fingerprint+Changelog (Praxis wie im IEX-A8-Commit ee24600).
2. `elNummernRegistrierungAktiv` wurde NICHT wie im Plan skizziert gebaut (direkter Zugriff auf `config.voice`), weil das fuer Aufrufer ohne `voice`-Namespace (`web-login.js` via `sipRegistrarWennAktiv`) einen TypeError ausloeste (4 rote Tests in `test/web-login-wiring.test.js`). Fix: `PROVISIONING_ENABLED` zuerst pruefen und frueh zurueckkehren (altes Verhalten erhalten), Regressionscheck in IEX-A10-1 ergaenzt.
3. `inboundTrunkSchreibenErlaubt` liest den Scope mit optional chaining (`config.voice.elevenLabsInbound?.scope`) — defensiv fuer partielle Test-Configs, Verhalten mit echter Config unveraendert.
4. Test-Config-Varianten nutzen Override-Objekte + Spread statt `structuredClone` + Mutator (Lint-Regel `no-param-reassign` mit `props:true` verbietet mutierende Helfer).
5. IEX-A10-9 in zwei Tests gesplittet (Kein-PATCH-Zeilen / Genau-1-PATCH-Zeilen), um Funktionslaenge/ein Konzept pro Test einzuhalten.

## Safety-Urteil

**PASS (Safety/Verhalten), approved.** Kernpunkte aus dem finalen Safety-Review:
- `testsPassIndependently: true`, `safetyGatesIntact: true`, `disclosureIntact: true`, `authFailClosedIntact: true`, `noSecretsLeaked: true`, `scopeRespected: true`, `behaviorAsIntended: true`, keine Blocker.
- Unabhaengige Nachmessung: frischer Branch `review-iex-a10` von `38a1fae`; `node --check` auf allen 6 geaenderten src-Dateien ok; geaenderte/neue Testdateien 130/130 gruen; Nachbardateien (e5-01, iel-b10, iel-incoming-golden, iex-a9-scope, onboarding-service/-outbound, outbound-e1) 65/65 gruen; Lint 0 Befunde.
- Drei eigene adversariale Proben (Probe-Datei danach geloescht, Worktree sauber): (1) Sweep unter `allowlist` mit reparierbarer Abweichung → `undefined`, 0 PATCH; (2) PATCH wirft TypeError mit Passwort in der Nachricht → Log nennt nur `nummer_id`/`status=unbekannt`, kein Passwort; (3) `json()` wirft SyntaxError mit Koerper-Inhalt → kein Passwort im Log.
- Diff-Pruefung: keine Aenderung an `package.json`/Lock, `src/claude.js`, `src/routes/**`, `src/route-policy.js`, `src/telephony/**`, `src/config.js`, `eslint-suppressions.json`. Kein neuer Endpunkt; Kostendecke, Denylist, Land-Gate, Stundenlimit, Max-Dauer, Permit, `OUTBOUND_FROZEN`, Signaturpruefung, Offenlegung, Inbound-TeXML unberuehrt.

Concerns (keine Blocker):
- Kleine, jeweils begruendete Abweichungen von der Spec-Dateiliste (Hook in `server.js` statt `boot.js`; geteilter Skript-Koerper; Orchestrator-Injektion; JSDoc-only in `convai.js`).
- Lint-Obergrenze +1 Zeile in `provisioning-orchestrator.js`, dokumentiert — dem Clean-Code-Auditor zur Bewertung vorgelegt.
- Restrisiko (b): Onboarding prueft eine per Schloss #2 uebernommene Registrierung vor dem PATCH nicht auf eigenen Agenten/`outbound_trunk` (der Sweep tut das). Barriere bleibt der Nach-GET-Beleg: fremder Agent → kein Beleg → Fehlersatz. Keine Eskalation gegenueber heute, aber schwaecher als die Sweep-Pruefung.
- Restrisiko (f): eine lokale Instanz mit kopierter Prod-Umgebung und abweichendem `ELEVENLABS_INBOUND_SIP_USER` wuerde beim Boot Prod-Registrierungen umschreiben. Mitigation nur ueber Betriebsregel „Prod-Env nie lokal"; naechster Prod-Boot stellt den Stand wieder her.
- Die Sweep-Ergebniszeile traegt jetzt in JEDER Konfiguration `repariert=<n>` — externe Log-Parser (falls vorhanden) muessen das neue Feld kennen.

Zusaetzlich unabhaengig gepruefter Security-Review (separat, ebenfalls PASS/approved): keine neue oeffentliche Route, Gate fail-closed und vollstaendig, Passwort-Lesestelle exakt eine (per Grep-Test belegt), keine Tenant-Verwechslung (Nummernabgleich ueber exakte e164), kein Kosten-Missbrauch-Pfad, Offenlegung/Budget/Outbound/Kill-Switch unangetastet. Gleiche Restrisiken (b), (f) sowie zusaetzlich (c) — Fingerabdruck deckt nur `sipUser`, eine reine Passwort-Rotation beim Anbieter wird als „belegt" nicht erkannt und still (aber fail-closed) nicht repariert — und ein Hinweis, dass die Sweep-Verdrahtung in `server.js` nur per Quelltext-Regex (IEX-A8-18) belegt ist, nicht per Spawn-E2E mit echtem Reparatur-PATCH.

## Clean-Code-Audit (s1-s4)

- **s1 (Blocker):** keine.
- **s2 (Blocker):** keine.
- **s3 (kosmetisch, kein Fix noetig):** N11 Naming — `inboundTrunkSchreibenErlaubt`/`inboundTrunkSchreiberWennErlaubt` folgen einem leicht anderen Benennungsmuster als das bestehende Vorbild `sipRegistrarWennAktiv` fuer dasselbe Konzept (Gate-Praedikat + Konstruktions-Wrapper) im selben Modul. Beide Namen sind klar und selbstdokumentierend, nur nicht wortgleich.
- **s4:** keine.

**Verdict: PASS.** Eng gescopter Diff mit einem Konstruktions-/Lese-Ort fuer den neuen Anbieter-Schreibzugriff, wiederverwendetem Dreifach-Gate inkl. Scope (kein Inline-Nachbau), durchgaengig fail-closed (leere Zugangswerte werfen vor Netzzugriff, PATCH-Fehler fail-soft ohne DID-Blockade, Reparatur nur bei eindeutig identifizierter eigener Registrierung). Duplizierung aktiv abgebaut (`iel-geheimnisse-setzen.mjs` nutzt jetzt `inboundTrunkKoerper` statt einer zweiten Kopie). Keine Geheimnis-Lecks in Logs, per Test geprueft. Neues Verhalten vollstaendig durch die 13 neuen Tests plus angepasste Bestandstests abgedeckt. `eslint-legacy-exceptions.json`/`check-staged-suppressions.test.js` sauber mit Owner-Begruendung fortgeschrieben. `PLAN-SECURITY.md` dokumentiert Gate, Sichtbarkeit und Restrisiken (a)-(f) ehrlich.

Offene TODOs aus dem Audit (kein Blocker):
- Volle Testsuite auf dem Phasen-Branch selbst laufen lassen, sobald ein freier Worktree/Checkout verfuegbar ist (aus dem Audit-Worktree wegen Git-Isolationsschutz nicht moeglich — reine Umgebungs-Einschraenkung der Session, kein Codebefund; unabhaengig vom Safety-Review aber bereits nachgeholt: 5977/0).
- Restrisiko (b) im Blick behalten (bereits dokumentiert, kein Blocker).

## Fix-Runden

Keine — Gate wurde ohne Fix-Runde mit PASS erreicht (Safety, Security und Clean-Code jeweils im ersten Durchlauf approved/PASS, `=== FIXES ===` blieb leer).
