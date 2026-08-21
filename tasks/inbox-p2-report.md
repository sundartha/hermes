# Phase INBOX-P2 — Konsum-Endpunkt POST /api/inbox/poll

Basis: `master` @ `08fea2a` (INBOX-P1 gemergt). Autoritativ: `PLAN-ANRUF-INBOX.md`, Etappe INBOX-P2.

Gate: **PASS** (mit Auflagen, kein Blocker)
finalBranch: `phase/inbox-p2-poll-fix3`
headCommit: `c472098f9330fdcad7d2baae4fceebd49925b9a7`

## Kern der Etappe

- Eigene Factory `makeInboxRoutes` (src/routes/api-inbox.js) fuer den neuen Endpunkt `POST /api/inbox/poll` — analog `makeCallRoutes`/`makeBillingRoutes`, NICHT in `api-read.js` (das ist eine reine Read-/Export-Gruppe; der neue Endpunkt VERBRAUCHT Zustand).
- `takeInboxEntries` als EINE pure, synchrone Store-Operation in `src/store/state-ops.js`: Auswahl + Projektion + Als-gesehen-Markierung ohne `await` dazwischen (E-3b) — strukturell race-frei, nicht nur per Konvention.
- `resultCardView` zog von `src/mcp-tools.js` nach `src/call-result.js` (S2-1): die Ergebnis-Karten-Whitelist lebt jetzt dort, wo die Karte definiert wird — EINE Quelle fuer `get_transcript` UND die Inbox-Projektion, statt einer zweiten Feldliste.

## Verdrahtungsstellen (einzeln)

1. `src/call-result.js` — `resultCardView` aufgenommen und exportiert.
2. `src/mcp-tools.js` — lokale Definition entfernt, Import aus `./call-result.js`; die drei Aufrufstellen (`:201`, `:247`, `:910`) unveraendert, sehen den importierten Namen.
3. `eslint-suppressions.json` — `src/call-result.js` complexity 1→2, `src/mcp-tools.js` complexity-Schluessel entfernt.
4. `eslint-legacy-exceptions.json` — Pin `complexity :: resultCardView` in `src/mcp-tools.js` entfernt; **kein** Umhaengen (siehe Deviation D1/S1-A) — der Rumpf wurde umgebaut (`const card = result ?? {}`), Komplexitaet faellt unter 10, der Pin entfaellt ersatzlos. Zusaetzlich vom Pre-Commit-Hook selbst erzwungener Nachzug: `src/store/pg.js` (makePgStore 557→562 Zeilen durch den neuen Wrapper).
5. `test/check-staged-suppressions.test.js` — `LEGACY_FINGERPRINT` 1:1 nachgezogen (inkl. pg.js-Nachzug).
6. `src/store/state-ops.js` — Import `stripResultEvidence, resultCardView`; neue Funktionen `inboxEntryView`, `openActionItemTexts` (modul-privat), `takeInboxEntries(state, tenantId, { limit, includeSeen })` — Optionsobjekt statt 4. Positionsargument (F1, Deviation D4).
7. `src/store/json.js` — Wrapper `takeInboxEntries`: `save()` NUR wenn `result.marked`.
8. `src/store/pg.js` — Wrapper `takeInboxEntries`: identischer Save-Guard.
9. `src/store.js` — Re-Export `takeInboxEntries`.
10. `src/routes/api-inbox.js` (NEU) — `makeInboxRoutes({ store, audit, tenant })`: `router.post("/api/inbox/poll", internalOnly, handler)`, `requireTenant(req,res)` im Handler (REJECT→403), `include_seen` fail-closed (nur strikt `=== true`), Deckel `INBOX_MAX_ENTRIES = 20`, Audit nur Zaehler (`neu=N rest=M`), **kein `save()`-Aufruf im Handler**.
11. `src/app.js` — Mount nach `makeReadRoutes`, vor Billing-Routen; `tenant: { requireTenant }`.
12. `test/route-auth-inventory.test.js` — `ROUTE_FINGERPRINT` um `"POST /api/inbox/poll"` ergaenzt (Klasse AUTH, kein `PUBLIC_ROUTES`-Eintrag).
13. `scripts/probe-auth.sh` — Probe-Zeile in der `internal`-Gruppe (Owner-Auflage 2026-08-02, nicht test-erzwungen).
14–17. Vier neue Testdateien: `test/inbox-poll-route.test.js`, `test/inbox-poll-flush.test.js`, `test/inbox-poll-flush-disk.test.js` (Deviation ggue. Plan: eigene Datei, Grund unten), `test/inbox-poll-race.test.js`; plus `test/inbox-poll-projection.test.js` (Fix-Runde 3) und `test/inbox-store-parity.test.js`-Ergaenzung (Fix-Runde 1).

## Abnahmepunkte (einzeln, Urteil + Kommando)

1. **Syntax** — `node --check` auf allen 8 geaenderten .js-Dateien → **PASS**, Exit 0, keine Ausgabe.
2. **Neue Tests** — `LLM_PROVIDER=anthropic NODE_ENV=test node --test test/inbox-poll-route.test.js test/inbox-poll-flush.test.js test/inbox-poll-flush-disk.test.js test/inbox-poll-race.test.js` → **PASS**, `tests 20 / pass 20 / fail 0` (Konsum R1, Persistenz R2, XFF-403 R3, Cross-Tenant R4, include_seen R5, Whitelist R6, Audit-Form R7, Ebene-A A1-A5, Ebene-B-Disk B0-B4, Race C1-C3).
3. **Auth-Inventar** — `node --test test/route-auth-inventory.test.js test/probe-auth-table.test.js` → **PASS**, `tests 18 / pass 18 / fail 0`.
4. **Umzugs-Unschaedlichkeit** — `node --test test/al-p11-result-card.test.js test/mcp-tools.test.js test/mcp-tools-language.test.js test/mcp-ui.test.js test/mcp-audio-text-only.test.js test/store-pg-json-parity.test.js test/api-read-parity.test.js` → **PASS**, `tests 123 / pass 123 / fail 0` (Ersatz fuer nicht existierende `test/mcp-transcript-tool.test.js`, Deviation D3).
5. **Suppressions-Spiegel** — `node --test test/check-staged-suppressions.test.js` → **PASS**, `tests 41 / pass 41 / fail 0`.
6. **Strict-Tally** — `npx eslint --suppressions-location eslint-suppressions.empty.json -f json src/call-result.js src/mcp-tools.js` → **PASS**, Tally identisch mit den Pins in `eslint-legacy-exceptions.json`.
7. **Voll-Lint** — `npm run lint` → **PASS**, `0 errors` (64 Warnungen, Bestandsniveau 65→64).
8. **Regressionsbank** — `LLM_PROVIDER=anthropic npm test` → **PASS** (mit Vorbehalt, s. Fix-Runden/CC-1): `tests 5075 / pass 5075 / fail 0` im Bau-Lauf; im unabhaengigen Review auf derselben Maschine 3/3 Laeufe mit je 1 wechselndem Fremdtest-Flake (isoliert gruen), master 2/2 gruen — Wurzel liegt in einer Null-Toleranz-Assertion in `test/el-geldpfad-s1.test.js`, ausserhalb des Diffs.
9. **Smoke 200** — korrigiertes Rezept (Deviation D2, Plan-Rezept bootet nicht ohne aktive Nummer / `COST_TRUING_REQUIRED_RECORD_TYPES`): `curl -X POST http://127.0.0.1:3999/api/inbox/poll` → **PASS**, `200`.
10. **Smoke 403** — derselbe Aufruf mit `-H 'X-Forwarded-For: 1.2.3.4'` → **PASS**, `403`.

## Gegenproben (woertlich)

**Poll-Beleg (C3, Struktur):**
> "✔ INBOX-P2 C3: Struktur-Beleg - takeInboxEntries ist kein Thenable und markiert im selben synchronen Durchlauf" - typeof result.then===\"undefined\", result.marked===3===result.entries.length, und JEDER ausgelieferte Call traegt unmittelbar nach der Rueckgabe inboxSeenAt!==null (Race genau-einmal, synchron).

**Poll-Beleg (R1):**
> "✔ INBOX-P2 R1: erster Poll liefert den qualifizierten Eintrag, zweiter Poll ist leer" - erste Antwort: entries.length===1, entries[0].call_id===\"call_inbox_ok\", remaining===0; zweite Antwort: entries.length===0.

**Kein-Save-Beleg (json, B1/B3):**
> "✔ B1: Leer-Poll (kein qualifizierter Call) -> 0 save(), marked=0" (count===0 der gepatchten fs.renameSync-Aufrufe) und "✔ B3: zweiter Poll danach -> 0 save(), leer" (count===0); B2 (ein neuer Eintrag) zeigt count===1 zum Vergleich (Positiv-Kontrolle B0: jsonStore.save() alleine zaehlt genau 1).

**Kein-Save-Beleg (pg, Werkzeug-Kontrolle vor dem Commit, danach geloescht):**
> "B1 leer-poll queryCount= 0 marked= 0 entries= 0" / "B2 ein-eintrag queryCount= 21 marked= 1 entries= 1" / "B3 zweiter-poll queryCount= 0 marked= 0 entries= 0"

**Fail-closed-Sabotage (ausgefuehrt, nicht nur behauptet):**
> Sabotage: `const { calls } = tenantCallScope(state, tenantId);` ersetzt durch `const calls = state.calls;`.
> Gegenprobe (rot): "✖ INBOX-P2 R4: Cross-Tenant ... AssertionError: The expression evaluated to a falsy value: assert.ok(!ownerIds.includes(\"call_b\"))" - Owner-Poll sah den fremden Tenant-Call, Cross-Tenant-Leak bestaetigt.
> Wiederherstellung + Bestaetigung (gruen): "✔ INBOX-P2 R4: Cross-Tenant - jede Identitaet bekommt und markiert NUR ihre eigene Inbox" - tests 1 / pass 1 / fail 0. `grep "SABOTAGE" src/store/state-ops.js` -> leer.

**Audit-Beleg (R7 echter stdout + A3 Attrappe):**
> R7: "✔ INBOX-P2 R7: die Audit-Zeile traegt NUR Zaehler, keine Rufnummer/Inhalte/Call-ID" — `assert.match(srv.stdout, /\[audit\] inbox_poll ip=\S+ neu=\d+ rest=\d+/)` UND Negativ-Assertionen gegen `+4915112345678`, `"Testanliegen"`, `call_inbox_ok`.
> A3: "✔ INBOX-P2 A3: Audit-Form ist ausschliesslich Zaehler" — `detail` matcht exakt `/^neu=\d+ rest=\d+$/`, kein `\d{6,}`.

**Unabhaengiger Review-Smoke (echter Server, MULTI_TENANT=true):**
> Audit-Zeilen woertlich: "[audit] inbox_poll ip=::ffff:127.0.0.1 neu=3 rest=0" / "neu=0 rest=0" (2x) / "neu=1 rest=0"; alle Details erfuellen `/^neu=\d+ rest=\d+$/`. Zwei 403-Requests erzeugen KEINE inbox_poll-Zeile.

**Read-Parity (unabhaengiger Review):**
> separates detached-Worktree auf master (08fea2a), IDENTISCHER Seed, je ein Dump fuer MULTI_TENANT=false UND true. diff leer, sha256 beider Dumps `f17542b7d9ae03ec116b0d8a158f2af3850226def96db98c0764399671e1fae4`, je 6271 Bytes. Byte-identisch.

## Impl-Zusammenfassung

INBOX-P2 vollstaendig gemaess Plan umgesetzt und committet (`c472098`). Neuer Endpunkt `POST /api/inbox/poll` (`src/routes/api-inbox.js`, `makeInboxRoutes`-Factory) hinter `internalOnly`+`requireTenant`, Deckel 20 Eintraege, fail-closed `include_seen`, PII-freies Audit. Store-Seite: `takeInboxEntries` als EINE pure, synchrone Store-Operation (E-3b) in `src/store/state-ops.js`, mit `inboxEntryView` als Whitelist-Projektion; json- und pg-Wrapper fluschen NUR bei `marked > 0` (R-3). `resultCardView` zog von `src/mcp-tools.js` nach `src/call-result.js` (S2-1). Auth-Kette lueckenlos nachgezogen (route-auth-inventory, probe-auth.sh). Vier neue Testdateien mit 20 Faellen, alle gruen; Sabotage-Gegenprobe fuer Tenant-Scoping ausgefuehrt (rot → wiederhergestellt → gruen). `npm test`: 5075 pass / 0 fail im Bau-Lauf. `npm run lint`: 0 Fehler. Scope eingehalten: kein neues MCP-Werkzeug, keine neue Env-Variable, `/api/state` unangetastet, keine Safety-Gates beruehrt.

### Deviations

- **D1** (Plan-Blocker, Weg A gewaehlt): der Pin `complexity resultCardView 11` wurde wie im Kickoff angewiesen behandelt, ABER tatsaechlich nicht umgehaengt, sondern der Rumpf umgebaut (`const card = result ?? {}` statt fuenf `?.`/`??`-Zugriffe) — der Pin entfaellt ersatzlos statt zu wandern (S1-A der Fix-Runden). Verhaltensgleichheit alt/neu ueber 10 Randfaelle geprueft.
- **D2**: Plan-Smoke-Rezept bootet nicht (fehlende aktive Nummer / `COST_TRUING_REQUIRED_RECORD_TYPES`) — korrigiertes Rezept verwendet, gemessen lauffaehig.
- **D3**: `test/mcp-transcript-tool.test.js` existiert nicht — Ersatz durch `test/al-p11-result-card.test.js` + Bestandstests mit derselben Beweislast.
- **D4**: Signatur `takeInboxEntries(state, tenantId, { limit, includeSeen })` statt positional (Plan) — 3 statt 4 Parameter, F1, Bestandspraezedenz `recordCallEstimatedCostCents`.
- **D5**: Filter auf `Boolean(call.inboxEntryAt)` statt `!= null` — fail-closed gegen `undefined`-Faelle (fehlendes Feld waere mit `!== null` faelschlich qualifiziert).
- **D6**: Fixtures tragen den Outbound-Call OHNE `inboxEntryAt` (Store filtert nur auf dieses Feld, Richtung entscheidet P1).
- **D7**: Audit-Pruefung per Attrappe UND echtem Spawn-stdout (positiv + negativ), nicht nur Negativ-`grep`.
- Zusaetzliche Testdatei `test/inbox-poll-flush-disk.test.js` (nicht im Plan-Dateizaehner): Ebene A (Attrappe) und Ebene B (echtes json-Backend) muessen getrennt sein, weil `config.js` `DATA_DIR` nur beim ALLERERSTEN Modul-Import bindet — sonst haette Ebene B gegen das echte, ungeseedete `data/store.json` geschrieben. Empirisch bestaetigt (Duplikate in `data/store.json` beobachtet) und vor Commit bereinigt.
- Zusaetzlicher, vom Pre-Commit-Hook selbst erzwungener Pin-Nachzug in `src/store/pg.js` (makePgStore 557→562 Zeilen).

## Safety-Urteil

**FREIGABE** (approved: true, blockers: []).

Kernversprechen belegt, nicht nur behauptet:
- Konsum genau einmal (Wettlauf zweier gleichzeitiger Polls selbst gesehen: 3/0-Split, Schnittmenge leer).
- Leer-Poll schreibt nichts, in BEIDEN Backends mit funktionierender Positiv-Kontrolle gemessen (pg 21→0→0 DB-Ops, json store.json-mtime unveraendert).
- Cross-Tenant dicht — Tenant A sah B nie, B's Marker blieb null; Sabotage-Gegenprobe machte genau diese Assertion rot.
- Audit ausschliesslich Zaehler, kein PII im stdout.
- `/api/state` byte-identisch zu master (gleicher sha256, beide MULTI_TENANT-Stellungen).
- Auth-Kette fail-closed, selbst ausgeloest: 403 bei X-Forwarded-For, auch mit gefaelschtem Tenant-Header.
- Scope eingehalten: `bridge.js` unberuehrt, kein neues Werkzeug, keine neue Env-Variable, kein Safety-Gate angefasst.

**Concerns (kein Blocker, aber Owner-relevant):**
1. **OWNER-FREIGABE NOETIG**: `src/call-result.js` ist NEU auf der Altlast-Liste (`eslint-legacy-exceptions.json` + `LEGACY_FINGERPRINT`). Der Testkopf reserviert das explizit dem Eigentuemer ("Ein Bau-Agent setzt keinen Eintrag"). Entschaerft: nur vorbestehende Befunde, keine Regel abgeschaltet, `npm run lint` = 0 Fehler.
2. Plan verlangte "byte-identischer Rumpf" fuer `resultCardView`, tatsaechlich wurde der Rumpf umgebaut (Pin entfaellt statt umzuziehen) — strikt besser, aber Abweichung von der Plan-Formulierung.
3. `scripts/probe-auth.sh` hat fuer AUTH-Klassen-Routen keine Ratsche — testweise Zeile entfernt, beide Tests blieben gruen (Bestandsluecke, nicht von dieser Etappe eingefuehrt).
4. Signatur-Abweichung `takeInboxEntries(state, tenantId, { limit, includeSeen })` statt positional (F1-begruendet, sachlich besser).
5. `inboxEntryView` exportiert, aber nur ein dateiinterner Aufrufer (Vorgriff auf INBOX-P3).
6. Akzeptiertes Restrisiko B-1: bei Deploy-Ueberlappung hat jede Instanz ihren eigenen pg-Spiegel — Garantie gilt PRO PROZESS, Folge waeren Duplikate, nie Verlust.
7. Ein pg-Parity-Test behauptete "save() unterbleibt" im Namen, mass aber keinen Zaehler — im Review selbst nachgeholt.
8. Suite-Flake (Bestand): `test/am6-oauth-tenant.test.js` fiel im Vollauf mit `TypeError: fetch failed`, isoliert 5/5 gruen.

## Clean-Code-Audit

**Verdict: PASS mit Auflagen** — keine S1-, keine S2-Befunde. blocker: false.

**S3 (Auflagen, kein Blocker):**
- **CC-1**: `npm test` war auf der Review-Maschine 3/3 Laeufe rot (je 1 wechselnder Fremdtest, Maschine unter Fremdlast), isoliert und in Kombination mit den Inbox-Dateien durchgehend gruen (42/42). Wurzel liegt in einer Null-Toleranz-Zeitassertion in `test/el-geldpfad-s1.test.js`, ausserhalb des Diffs. Fix: Merge-Gate auf unbelasteter Maschine wiederholen; bleibt es rot, Toleranz in der Fremddatei als eigener Vorgang anpassen.
- **CC-2**: Neuer Altlast-Eintrag `src/call-result.js` — Owner-Sache laut Ratschen-Kopf. Entlastend: nur vorbestehende Befunde, keine neue Unterdrueckung, `resultCardView`-Befund ist ECHT weg (gemessen). Fix: Owner-Freigabe einholen oder `resultCardView` in ein suppressions-freies Modul legen.
- **CC-3**: `inboxEntryView` exportiert ohne externen Aufrufer (Nachbar `openActionItemTexts` konsequent modul-privat). Fix: `export` streichen oder per Unit-Test rechtfertigen.

**S4 (Hinweise):** nackte `limit: 20`/`10` in zwei Testdateien statt lokaler Konstante; `takeInboxEntries` destrukturiert Optionsobjekt ohne `= {}`-Default (kein Live-Pfad betroffen); `poll()`-Testhelfer leicht dupliziert in zwei Dateien; `undefined`-Fall des Filters nur indirekt getestet.

**Ausgefuehrte Gegenproben (Audit):** `npx eslint .` → 0 Fehler/64 Warnungen; strict-Lint der neuen Dateien → 0 Befunde (`call-result.js` nur die 2 vorbestehenden); 36/36 neue Tests gruen; Isolationsproben fuer den Flake bestaetigt; `data/store.json` nachweislich unberuehrt von `inbox-poll-flush-disk.test.js`; keine Umlaute in neuen Zeilen; kein toter/auskommentierter Code; keine neuen Magic Numbers.

## Fix-Runden

**r1**: Blocker aus Runde 1 behoben — drei neue Regressionstests fuer den pg-seitigen `takeInboxEntries`-Wrapper (INBOX-P2-S9/S10/S11) in `test/inbox-store-parity.test.js`, nach etabliertem PGlite-Harness-Muster. Kein Produktionscode geaendert.

**r2**: Zwei Review-Blocker behoben, minimal ohne Scope-Drift.
- S1-A (kein neuer Altlast-Eintrag): `resultCardView` liest jetzt `const card = result ?? {}` statt fuenf einzelner `?.`/`??`-Zugriffe — Komplexitaet faellt unter 10, Pin entfaellt ersatzlos. Verifiziert per `npx eslint --suppressions-location eslint-suppressions.empty.json`.

**r3**: Blocker S1-1 behoben — die Whitelist `inboxEntryView` war nur per Substring-Blacklist/`in`-Praesenz getestet, nicht als exakte Form gepinnt, `caller`/`started_at` hatten keine Wert-Assertion. Fix: neuer Test "INBOX-P2 S1-1" in `test/inbox-poll-projection.test.js`, seedet einen Call mit allen Feldern und pinnt die exakte Form.
