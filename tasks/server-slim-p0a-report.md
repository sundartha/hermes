# Phase P0a — Charakterisierungs-Test `POST /api/billing/flush-meters`

**Gate:** PASS
**finalBranch:** `phase/slim-p0a-flush-meters-test`
**headCommit:** `cc97ae8a42035229752f5a1f9e0203a55c571a61`

---

## Plan (gekuerzt)

### Grounding (verifiziert gegen `master`)

| Fakt | Fundstelle |
|---|---|
| Route-Handler (unveraendert zu pinnen) | `src/server.js:1520-1527` |
| 404-Body (fail-closed) | `{ error: "metering disabled (PAYMENT_ENABLED)" }`, Status 404 |
| 200-Pfad | `flushMeters(store.load(), { billing: stripeBilling })` -> `store.save()` -> `audit()` -> `res.json(result)` |
| `flushMeters` bei leerem Ledger -> `{sent:0,failed:0}` ohne `reportMeter`-Aufruf | `src/billing/meter.js:53-73` |
| `stripeBilling` ist Modul-`const`, macht I/O nur beim Methodenaufruf | `src/billing/stripe.js:118-364` |
| `pendingMeterEvents(s)` liest `s.usageEvents.filter(...)` | `src/store/state-ops.js:1468-1470` |
| json-Backend hydriert fehlendes `usageEvents` beim Load zu `[]` | `src/store/json.js:55` |
| `makeDefaultState()` enthaelt `usageEvents: []` | `src/store/state-ops.js:78` |
| Boot-Pflicht bei `PAYMENT_ENABLED=true`: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NUMBER_SETUP_FEE_CENTS` (Int>0) | `src/config.js:784-800` |
| `PAYMENT_ENABLED` ohne `PROVISIONING_ENABLED` = nur Warnung; `MULTI_TENANT` nicht noetig | `src/config.js:847-850` |
| Auth-Gate offen, wenn `DASHBOARD_PASSWORD` leer (BASE_ENV-Default) | `src/server.js:495` |
| `USAGE_EVENT_KIND.VOICE_MINUTE = "voice_minute"` -> Stripe-Meter `voice_minutes` | `src/store/defaults.js:118` + `src/billing/stripe.js:62-66` |
| Retention (`pruneOldData`) beruehrt `usageEvents` nicht | `src/store/json.js:623-626` |
| Boot-Log-Zeile (INV-6), genau 1 Treffer unter `src/` | `src/server.js:2181` |
| `grep -c "^export" src/server.js` = 0 | verifiziert |
| Kein bestehender HTTP-Test fuer die Route | verifiziert (nur Unit-Test von `meter.js` in `usage-event-meter.test.js`) |

### Kern-Einsicht

`stripeBilling` ist ein Modul-`const`, direkt in `server.js` importiert, und laesst sich in einem Spawn-Test nicht injizieren/stubben. Der SPEC-Begriff "stub billing" wird daher per **Ledger-Aushungern** erreicht: bei leerem `usageEvents` ruft `flushMeters` `billing.reportMeter` nie auf -> garantiert null Stripe-Kontakt, `{sent:0,failed:0}`. Das ist staerker als ein Stub (keinerlei Billing-Interaktion) und deckt die SPEC-Zusage "KEIN Secret/Event-Inhalt" byte-genau ab. Ein dritter Fall (ein geseedetes Event + lokale Fake-Stripe) pinnt zusaetzlich, dass die Antwort auch bei tatsaechlicher Meldung nur `{sent,failed}` traegt.

### Neue Datei

`test/api-flush-meters.test.js` — Spawn-Test (node:test), offline, 3 Faelle:

- **(A)** ohne `PAYMENT_ENABLED` -> 404 fail-closed, exakter Body `{"error":"metering disabled (PAYMENT_ENABLED)"}`
- **(B)** mit `PAYMENT_ENABLED`, leerer Ledger -> 200 `{sent:0,failed:0}`, kein Stripe-Kontakt moeglich
- **(C)** mit `PAYMENT_ENABLED`, EIN pending `voice_minute`-Event + lokale Fake-Stripe -> 200 `{sent:1,failed:0}`, genau ein Meter-POST, Event als `stripeMeterSent` markiert, Antwort ohne Event-Inhalt/Secret

Bausteine: `flushMeters(srv)`-Helfer (POST-Aufruf), `PAY_ENV`-Konstante (die drei assertConfig-Pflichtfelder), `startFakeStripe()` lokal definiert nach bewaehrtem Sibling-Muster (`billing-setup-checkout-route.test.js`) — `helpers.js` bewusst unangetastet (harte Phasenabgrenzung).

### Edits an bestehenden Dateien

KEINE. Reine Test-Phase. `src/server.js` bleibt byte-identisch, `test/helpers.js` unangetastet, keine `.env.example`/`render.yaml`/`config.js`-Aenderung.

### Deterministisch pruefbares Ergebnis (Plan-Vorgabe)

```
node --check test/api-flush-meters.test.js   -> Exit 0
node --check src/server.js                   -> Exit 0
node --test test/api-flush-meters.test.js    -> "# pass 3", "# fail 0"
grep -c "^export" src/server.js              -> 0
git diff --stat -- src/server.js             -> leer
npm test                                     -> vollstaendig gruen
```

### Pre-Mortem / Risiken (niedrig)

- Test haette bei falschem Verhalten den spaeteren P7-Move nicht byte-beweisbar gemacht -> Gegenmassnahme: Test laeuft vor jeder `server.js`-Aenderung gruen.
- 500 durch `usageEvents` undefined: ausgeschlossen (Default-Store + json.js-Hydrierung).
- Ungewollter echter Stripe-Call: ausgeschlossen (Fall B beruehrt Stripe nie, Fall C zeigt auf lokalen Fake).
- Boot-Refusal: vermieden durch die drei verifizierten assertConfig-Pflichtfelder in `PAY_ENV`.
- Abweichung vom SPEC-Wortlaut: keine im beobachteten Verhalten; einzige Nuance ist die Ledger-Aushungern-Realisierung von "stub billing" (dokumentiert, keine Verhaltensabweichung).

Blast-Radius: genau eine neue Datei, kein Produktionscode beruehrt, kein neuer Dep, keine neue Env-Var.

---

## Impl-Zusammenfassung

P0a exakt nach Plan umgesetzt: EINE neue Datei `test/api-flush-meters.test.js` (114 Zeilen, 3 Faelle) als Charakterisierungstest fuer `POST /api/billing/flush-meters`. `src/server.js` ist byte-identisch zu `master` geblieben (`git diff --stat` leer), keine andere Datei angefasst.

- Fall A pinnt 404 fail-closed ohne `PAYMENT_ENABLED` mit exaktem Body `{"error":"metering disabled (PAYMENT_ENABLED)"}`.
- Fall B pinnt 200 `{sent:0,failed:0}` bei leerem `usageEvents`-Ledger (kein Stripe-Kontakt moeglich, da `flushMeters` bei leerem Ledger `reportMeter` nie aufruft).
- Fall C (staerkste Absicherung) seedet ein pending `voice_minute`-Event, laesst eine lokale Fake-Stripe (Muster `billing-setup-checkout-route.test.js`) den Meter-POST quittieren, und pinnt 200 `{sent:1,failed:0}` sowie dass die Store-Persistenz (`stripeMeterSent`) den Flip vornimmt — ohne dass die HTTP-Antwort je Event-Inhalt/Secret traegt.

Alle 3 Faelle liefen isoliert gruen (`node --test`) UND als Teil der vollen Suite (`npm test`: 2272 pass / 0 fail, beide Backends inkl. pglite).

**Globale Verifikation bestanden:**
- `node --check` fuer neue Datei + `server.js` sauber
- `grep -c "^export" src/server.js` = 0
- Boot-Log-Zeile `"Hermes Gateway laeuft auf http://localhost"` genau 1 Treffer unter `src/`
- `git diff --stat master -- src/server.js` leer (byte-identisch)

**Smoke-Test (best effort):** Server lokal gestartet (Port 3998, `SKIP_TWILIO_SIGNATURE_CHECK=true`, `ANTHROPIC_API_KEY`/`TWILIO_*`=dummy, ueber `scripts/bootstrap-tenant.js` eine aktive Owner-Nummer im Store geseedet). `/healthz` -> `{"ok":true}`. `curl -X POST /api/billing/flush-meters` -> HTTP 404 `{"error":"metering disabled (PAYMENT_ENABLED)"}`, exakt wie Fall A im Test und wie der Route-Handler in `server.js`. Sauber beendet (SIGTERM, Store-Flush im Log sichtbar), temporaeres Datenverzeichnis danach entfernt.

**Commit:** `cc97ae8` auf Branch `phase/slim-p0a-flush-meters-test` (von `master`), nur `test/api-flush-meters.test.js` gestaged/committed (kein `git add -A`), `node_modules`-Symlink nicht committed (gitignored, bestaetigt via `git status --ignored`).

### Testdateien / Faelle

- `test/api-flush-meters.test.js`: "ohne PAYMENT_ENABLED: POST /api/billing/flush-meters -> 404 (fail-closed)"
- `test/api-flush-meters.test.js`: "mit PAYMENT_ENABLED, leerer Ledger: -> 200 {sent:0,failed:0} (kein Stripe-Kontakt)"
- `test/api-flush-meters.test.js`: "mit PAYMENT_ENABLED, EIN pending usage_event: -> 200 {sent:1,failed:0}, Event markiert, Antwort ohne Event-Inhalt"

### Deviations

Keine Verhaltensabweichung vom SPEC-Wortlaut. Einzige Umsetzungs-Nuance (bereits im Plan als bewusst dokumentiert): "stub billing" wird per Ledger-Aushungern (Fall B, leeres `usageEvents` -> `reportMeter` wird nie aufgerufen) statt per Dependency-Injection realisiert, weil `stripeBilling` ein Modul-`const` in `server.js` ist und in einem Spawn-Test nicht injizierbar. Das ist eine staerkere Garantie (kein Stripe-Kontakt ueberhaupt) und deckt die SPEC-Zusage "KEIN Secret/Event-Inhalt" byte-genau ab, veraendert aber nicht das beobachtete HTTP-Verhalten.

### Clean-Code-Selfcheck (Impl)

Konform: F.I.R.S.T./P12 (jeder Testfall eigener Server + eigenes tempDataDir + eigene Fake-Stripe, unabhaengig/wiederholbar/offline, `try/finally` raeumt auf); P14/T1 (ein Konzept je `test()`: 404-Gate / Leer-Flush / Real-Flush-ohne-Leak); G5/S2 (`flushMeters()`-Helfer + `PAY_ENV`-Konstante statt Wiederholung, `startFakeStripe()` gekapselt nach bewaehrtem Sibling-Muster); G25 (keine unbenannten Magic-Numbers ausser 0/1 — `"500"`/`"2"` sind selbsterklaerende Testdaten/Config-Werte); N7/P6 (Namen ohne versteckte Nebeneffekte); keine ungenutzten Imports; kein toter/auskommentierter Code; ESM, kein Build-Step, Kommentare deutsch ohne Umlaute; `helpers.js` bewusst nicht angefasst (harte Phasenabgrenzung).

---

## Safety-Urteil (final)

**Verdict: APPROVED**

- testsPassIndependently: true
- safetyGatesIntact: true
- disclosureIntact: true
- authFailClosedIntact: true
- noSecretsLeaked: true
- behaviorAsIntended: true
- scopeRespected: true
- blockers: keine

**Concerns:**
1. Voll-Last-Suite zeigte 1 roten Test (`test/kyc-gate-outbound.test.js`: 404!==403), aber die Datei ist von P0a unberuehrt und laeuft isoliert 5/5 gruen -> der dokumentierte ~12% Seed-vor-Boot-Spawn-Race, kein echtes Rot (Gate-Protokoll: rot nur echt, wenn isoliert rot). Das Hinzufuegen eines weiteren Spawn-Tests erhoeht marginal die Prozess-Parallellast; Wurzel ist vorbestehend, nicht durch P0a verursacht.
2. Test C pinnt bewusst auch den `store.save()`-Seiteneffekt (`stripeMeterSent`-Flip) — das ist korrekte Charakterisierung des IST-Verhaltens und im Kommentar offengelegt, kein Scope-Ueberschritt.

**Independent Test Summary:** Frischer Worktree, `node_modules`-Symlink, Review-Branch von `phase/slim-p0a-flush-meters-test`. Neuer Test isoliert: 3/3 gruen. Volle Suite (`NODE_ENV=test node --test test/*.test.js`): 2272 Tests, 2271 pass, 1 fail = `kyc-gate-outbound.test.js` (unberuehrt von P0a), isoliert 5/5 gruen -> dokumentierter Spawn-Race-Flake, kein echtes Rot. `node --check` auf neue Testdatei + `src/server.js` OK. `grep -c '^export' src/server.js` = 0. Boot-Log-Zeile genau 1 Treffer unter `src/`. `git diff master..branch` = nur `test/api-flush-meters.test.js` (+114), `src/server.js` byte-identisch (0 Diff-Zeilen), `helpers.js`/`claude.js`/`bridge.js` unberuehrt, keine `package.json`/lock-Aenderung (keine neue Dep). Verifiziert gegen `server.js:1520` (Handler), `meter.js` (`flushMeters` `{sent,failed}`, kein Leak), `stripe.js` `reportMeter` -> `/v1/billing/meter_events` (Fake-Stripe faengt genau diesen Pfad), `config.stripeApiBase` liest `STRIPE_API_BASE`, `BASE_ENV` traegt `PAYMENT_ENABLED`+`STRIPE_API_BASE` bereits (kein Drift).

**Fazit:** P0a fuegt genau eine Charakterisierungs-Testdatei hinzu und laeuft gruen gegen den byte-identisch unveraenderten `src/server.js` — sie pinnt das IST-Verhalten von `POST /api/billing/flush-meters` (fail-closed 404 ohne `PAYMENT_ENABLED`; 200 `{sent,failed}` mit stub-Billing; kein Secret/Event-Inhalt in der Antwort), exakt wie in der Spec, ohne Abweichung. Harte Phasenabgrenzung eingehalten: keine `src/`-Aenderung, keine Aenderung an bestehenden Tests oder `helpers.js`, keine neue npm-Dependency. Alle absoluten Regeln intakt (Safety-Gates, Disclosure `claude.js`+`bridge.js`, Auth fail-closed, keine Secret-Leaks). Alle Invarianten INV-1..INV-11 unberuehrt (reine Test-Phase). Der einzige rote Suite-Test ist der vorbestehende, von P0a unberuehrte Spawn-Race-Flake (isoliert gruen).

---

## Clean-Code-Audit (final)

**Verdict: PASS** (kein Blocker)

### S1 (Blocker)
Keine.

### S2 (Blocker)
Keine.

### S3
Keine.

### S4 (nicht blockierend)

- **G5 (schwach, n.z. als Blocker)** · `test/api-flush-meters.test.js:19-36` · `startFakeStripe()` dupliziert die Boilerplate-Struktur (`http.createServer`, `req.on('data'/'end')`, Port-0-Listen, `{url,close}`) aus `test/billing-setup-checkout-route.test.js` fast identisch, nur die Routen-Dispatch-Zweige unterscheiden sich. Bewusste, im Kommentar begruendete Entscheidung (Phasenabgrenzung P0a: "helpers.js bleibt unangetastet"); Struktur ist bereits Repo-Konvention (21 Testdateien nutzen dasselbe Muster) — kein neues Duplizierungsproblem, aber ein guter Kandidat fuer eine spaetere gemeinsame `test/helpers.js`-Fabrik (z. B. `makeFakeHttpApi(routes)`), falls eine kuenftige Phase weitere Stripe-Mocks braucht.

### Pass-Notes

Reine Testdatei (114 Zeilen, 1 neue Datei, `server.js` unangetastet — Phase haelt ihr eigenes Versprechen "byte-identisch"). Alle 3 Tests laufen gruen (lokal verifiziert per `node --test`), pruefen den echten `/api/billing/flush-meters`-Endpunkt (`src/server.js:1955-1962`) korrekt gegen: (A) Fail-closed 404 ohne `PAYMENT_ENABLED`, (B) leerer Ledger -> `{sent:0,failed:0}` ohne Stripe-Kontakt, (C) ein pending `usage_event` -> genau ein Meter-POST, Event als `stripeMeterSent` markiert, Response ohne Leak. Fixture-Form (`usageEvents`-Eintrag), `STRIPE_API_BASE`-Override und `BASE_ENV` sind bestandskonform (keine neue Env-Var, kein `BASE_ENV`-Drift). Aussage im Kopf-Kommentar "kein HTTP-Test bisher" verifiziert (`grep` bestaetigt: kein bestehender Test referenzierte `/api/billing/flush-meters`; nur der reine Funktions-Test in `usage-event-meter.test.js` existierte).

`server.js` unveraendert (`git diff` zeigt nur die neue Testdatei) — die Phase haelt exakt ihr Scope-Versprechen. Build-Operate-Check klar getrennt in allen 3 Tests (P13). Fail-closed-Pfad zuerst getestet (S1-Sicherheitsverhalten des Endpunkts ist jetzt gepinnt, nicht nur implizit). Response-Shape-Check (`Object.keys` sort) in B und C stellt explizit sicher, dass KEIN Event-Inhalt/Secret in der API-Antwort leakt — passt zur Absoluten Regel 4 (Secrets). Fake-Stripe minimal und zielgenau (nur die eine Route, die der Test braucht). Env-Variablen (`STRIPE_API_BASE`, `PAY_ENV`) sind bereits etablierte Config-Keys, keine `BASE_ENV`-Drift. Kommentare praezise, ohne Umlaute, Deutsch, mit klarer Fach-Begruendung je Testfall. Datei ist isoliert (kein Cross-File-Duplizierung, die eine eigene Abstraktion rechtfertigt) und laeuft schnell (~1.2s fuer 3 Tests, F.I.R.S.T erfuellt).

### Top-Todos

- Keine Blocker — Phase ist mergefaehig wie sie ist.
- Optional/spaeter: falls weitere Phasen mehr Fake-Stripe-Mocks brauchen, `startFakeStripe()`-Boilerplate (aktuell in 2+ Testdateien fast identisch) in eine gemeinsame `test/helpers.js`-Fabrik ziehen — kein Muss fuer P0a, da Phase bewusst `helpers.js` nicht anfasst.

---

## Fix-Runden

Keine. Beide Reviews (Safety + Clean-Code) kamen im ersten Durchlauf zu PASS/APPROVED ohne Blocker; es waren keine Fix-Runden noetig.
