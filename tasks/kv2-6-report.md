# Phase KV2-6 — Deckung je Traeger und der Herzschlag

- **Gate:** PASS
- **finalBranch:** `phase/kv2-6-impl`
- **headCommit:** `38e7cb534db54587c8330dd38da23c128b67fb5d`

## Plan (gekuerzt)

### Bindende Vorbedingungen

- **Harte Klemme:** `src/billing/cost-truing.js` steht unter einem gepinnten Lint-Budget (`eslint-suppressions.json`, ungefiltert gemessen: `complexity`(trueOneCall=12), 7x `id-length`, `max-lines-per-function`(makeCostTruing=292), 2x `no-magic-numbers`, 9x `no-param-reassign`). Der pre-commit-Hook lehnt jede Bewegung der Fund-Multimenge ab, in beide Richtungen. Diese Phase hebt kein Budget an. Konsequenz: das gesamte Fachliche wandert in ein neues Modul; in `makeCostTruing` werden genau 2 Zeilen hinzugefuegt und 2 entfernt (netto 0, Zeilenzahl bleibt exakt 292). Dieselbe Klemme gilt fuer `src/routes/api-billing.js`, `test/helpers.js`, `test/cost-truing-harness.js`, `test/cost-truing-sweep-log.test.js`.
- **Owner-Entscheidungen als Default (nicht neu entschieden):** Punkt 11 (a) — `telnyx_call_records` hat einen Einsammler, Kriterium (f) wird als "Belegzeile vorhanden -> Herzschlag still" gebaut, nicht als Ausnahme. Punkt 12 (a) — Traegername bleibt `telnyx_call_records`. Punkt 14 (a) — `legacyKostenprofil` lenkt profillose EL-Altzeilen auf `el_convai_sip`, nur gelesen, nicht geaendert.
- **Nicht Teil der Phase:** keine Buchung, kein Settlement, keine Schliessregel, kein Safety-Gate, kein Offenlegungssatz, keine neue Dependency.
- **Drei aus den Abnahmekriterien hergeleitete Auslegungen:**
  - A1: der bestehende globale Deckungs-Befund (`coverage_below_threshold`) bleibt unangetastet; die neue Traeger-Achse ist additiv, kein Zusammenlegen zweier Sachverhalte.
  - A2: feuert der Herzschlag fuer einen Traeger, schweigt die Deckungsquote fuer denselben Traeger (erzwungen durch "genau ein Befund" in Kriterium b/f).
  - A3: "kein Alarm" in (f)/(g) ist traeger-scoped — Gegenproben pruefen den Code des jeweiligen Traegers, nicht Alarmfreiheit insgesamt.

### Neues Modul `src/billing/kosten-deckung.js`

Reines Regelwerk (keine Store-Mutation, kein Netz-IO, kein `console`, kein `await`), Import-Richtung strikt einseitig (kennt `cost-truing.js` nicht — Zeitfenster wird als Parameter hereingereicht). Liefert `kostenBuchBericht({state, billing, nowMs, deckungFensterMs})` mit `deckung[]` (kandidaten/belegt/offen/unbeschaffbar/prozent je Traeger), `herzschlag[]` (beendet/angelegt je Traeger), `nieBeendet`, `profillos`, `herzschlagAktiv`, `zeile` (Sweep-Log-Render), `befunde[]`.

Kernregeln: zwei getrennte Fragen (Deckung = ist es vollstaendig; Herzschlag = sammelt ueberhaupt jemand) duerfen nie auf dieselbe Bedingung fallen; `unbeschaffbar` faellt aus Zaehler UND Nenner der Deckung; `vorlaeufig` zaehlt fuer den Herzschlag als angelegt, fuer die Deckung nicht als belegt; eine abgeleitete Karenz (`COST_TRUING_DELAY_MINUTES + COST_TRUING_SWEEP_INTERVAL_MS`) verhindert den Dauer-Alarm auf frisch beendete Anrufe; `openai_realtime` (nicht_belegpflichtig) faellt aus beiden Messungen heraus, sonst waere `telnyx_inbound_realtime` per Konstruktion dauer-alarmierend.

### Verdrahtung

- `src/billing/kostenarten.js`: neue Funktion `pflichtTraegerFuerProfil(profil)`.
- `src/billing/cost-truing.js`: Import von `kostenBuchBericht`/`istBuchBefundCode`; `PROVIDER_COST_RECORD_WINDOW_MS` exportiert; `emitFinding` erkennt die drei neuen Befundklassen ueber ihre Klasse (Praefix vor `:`); Pass-Through-Wrapper `sendDriftAlertSms` entfernt und 1:1 in `alertDrift` inlined (Zeilen-Gegenbuchung); `sweepAllCandidates` misst `buch` und meldet die neuen Befunde nach der Bilanz.
- `src/config.js` + `.env.example`: neuer Schluessel `KOSTEN_HEARTBEAT_FENSTER_H` (Default 6h, min 0, 0=aus als sichtbarer Rollback-Hebel `herzschlag=aus`), in `CONFIG_NAMESPACES.billing` eingetragen.
- `test/helpers.js` (`BASE_ENV`) und `test/cost-truing-harness.js` (`fakeConfig`) ziehen den neuen Schluessel nach (Lehre `test-base-env-drift`).
- `src/routes/api-billing.js`: neue Betreiber-Route `GET /api/billing/kosten-deckung`, hinter `webAuthMw+adminMw`, reine Anzeige derselben Kennzahl wie der Sweep (kein zweiter Rechenweg), PII-frei (nur Traegernamen, Zahlen, Prozente, Befund-Codes).

### Tests (Plan)

Zwei neue Dateien: `test/kv2-6-deckung-herzschlag.test.js` (Kriterien a-g inkl. Gegenproben, Zaehlweisen-Trennung, A2, Karenz, Fenster-aus, profil-fehlt, `openai_realtime`-Ausschluss, PII) und `test/kv2-6-kosten-deckung-route.test.js` (401/403/200, PII-Scan). Bestandsanpassungen: `test/cost-truing-sweep-log.test.js`, `test/route-auth-inventory.test.js` (Fingerprint + Operator-Routen sechs->sieben), `test/config-namespaces.test.js` (Counts +1).

### Pre-Mortem (Kernrisiken, akzeptiert)

R1 Deckungs-Alarm feuert einmalig fuer EL-Altanrufe ohne Beleg (real, entprellt, heilt in 7 Tagen). R2 Karenz verhindert Falsch-Alarm auf frische Anrufe. R3 Herzschlag-Stille (Fenster=0 oder < Karenz) ist immer sichtbar als `herzschlag=aus`, nie still. R4 `profil-fehlt` meldet einmalig direkt nach Cutover, heilt binnen 6h. R5 Lint-Budget darf nicht angehoben werden — Kommando 2 (Fund-Multimengen-Vergleich) ist der Beleg, nicht die Absicht. R6 Anzeige-Route ist PII-frei, gepinnt durch String-Scan-Tests.

## Impl-Zusammenfassung

- **headCommit:** `38e7cb534db54587c8330dd38da23c128b67fb5d`, `node --check` sauber, `npm test`: 5540/5540 gruen, committed.
- Neues reines Regelwerk `src/billing/kosten-deckung.js` (Deckung je Traeger + faelligkeits-unabhaengiger Herzschlag), verdrahtet in `cost-truing.js` — `makeCostTruing` exakt bei 292 Zeilen gehalten, Fund-Multimenge des gepinnten Lint-Budgets vor/nach identisch gemessen.
- Neue Funktion `pflichtTraegerFuerProfil` in `kostenarten.js`.
- Neuer Config-Schluessel `KOSTEN_HEARTBEAT_FENSTER_H` (Default 6, 0=aus).
- Neue Betreiber-Route `GET /api/billing/kosten-deckung` (webAuthMw+adminMw, PII-frei).
- Zwei neue Testdateien: 14 Faelle (`kv2-6-deckung-herzschlag.test.js`) + 4 Faelle (`kv2-6-kosten-deckung-route.test.js`), alle gruen; decken beide Auslegungen A1/A2, Karenz, Rollback-Hebel, `profil-fehlt`, PII-Freiheit, Auth-Sicherung.
- Vier Bestandstests nachgezogen (Sweep-Zeilenformat waechst, Betreiber-Routen-/Config-Zaehlungen verschieben sich): `route-auth-inventory` sechs->sieben, `config-namespaces` 176->177, zwei Sweep-Log-Zeilen-Pins.
- `npm test`: 5540/5540 gruen (ein isolierter Rerun bestaetigte einen bestehenden, unabhaengigen Suite-Flake in `test/auth-p3-bootstrap-fallback.test.js`, nicht KV2-6-verursacht).
- `npm run test:gates`: unveraendert 3 vorbestehende rote Befunde (GAP-05, GAP-15, E2E-03), keine neuen.
- `npm run lint`: 0 Fehler, 66 Baseline-Warnungen unveraendert.
- Pre-commit-Hook (Suppression-Gate) lief sauber durch.

### Deviations (vs. Plan)

1. Zwei zusaetzliche Bestandstests (`test/cost-truing-retrievable.test.js`, `test/kv2-1-kosten-alarm-naht.test.js`) mussten angepasst werden — pinnten exakte Sweep-Log-Zeilen, im Plan nur `cost-truing-sweep-log.test.js` genannt. Gleiches Muster (Felder wachsen HINTEN an).
2. In `kosten-deckung.js` mussten vier Ein-Buchstaben-Parameter (`e, a, b, w`) in Callback-/Sort-Funktionen umbenannt werden (id-length min:2) — erst beim `npm run lint`-Endcheck aufgefallen.
3. `pflichtTraegerFuerProfil` von einer verketteten `Object.entries().filter().map()`-Pipeline auf drei separate Anweisungen umgestellt (G36-Demeter-Regel, >4 verkettete Zugriffe verletzt) — Verhalten identisch.
4. `test/config-namespaces.test.js`: zusaetzlich zu den geplanten Countern musste ein unabhaengig gepflegter Zaehler `EXPECTED_PRIMITIVE_LEAVES` (165->166) sowie eine Test-Namens-Zeichenkette (176->177) nachgezogen werden — im Plan nicht erwaehnt.

### Dateien

- **Neu:** `src/billing/kosten-deckung.js`, `test/kv2-6-deckung-herzschlag.test.js`, `test/kv2-6-kosten-deckung-route.test.js`
- **Editiert:** `.env.example`, `src/billing/cost-truing.js`, `src/billing/kostenarten.js`, `src/config.js`, `src/routes/api-billing.js`, `test/config-namespaces.test.js`, `test/cost-truing-harness.js`, `test/cost-truing-retrievable.test.js`, `test/cost-truing-sweep-log.test.js`, `test/helpers.js`, `test/kv2-1-kosten-alarm-naht.test.js`, `test/route-auth-inventory.test.js`

### Smoke

Kein separater manueller Server-Smoke-Test (Zeitbudget); der echte HTTP-Spawn-Test `test/kv2-6-kosten-deckung-route.test.js` zaehlt als Beleg — startet einen echten Express-Server mit der echten `webAuthMw+adminMw`-Kette (pglite), ruft `GET /api/billing/kosten-deckung` per echtem HTTP auf (401 ohne Sitzung, 403 ohne Admin-Rolle, 200 mit Admin-Session, PII-Scan auf realer JSON-Antwort) — alle vier Faelle gruen.

## Safety-Urteil

**approved: true — PASS.** KV2-6 ist eine reine Beobachtungs-Phase und verhaelt sich auch so: kein Byte an Geld-, Gate-, Offenlegungs- oder Auth-Pfad.

- **safetyGatesIntact:** `git diff --stat` gegen `src/claude.js`, `src/bridge.js`, `src/telephony`, `src/routes/voice.js`, `src/auth.js`, `src/web-auth.js`, `src/middleware.js`, `src/route-policy.js`, `src/billing/outbound-gates.js`, `src/store/state-ops.js`, `package.json`, `package-lock.json`, `eslint-suppressions.json` ist LEER. Denylist/Land/Stundenlimit/Kostendecke/Max-Dauer/Ed25519 unberuehrt. Kriterium (e) am Test gepinnt (`usage.costCents` unveraendert, `store.writes == []`). Neues Modul ist rein (keine Store-Mutation, kein Netz, kein `await`).
- **disclosureIntact:** `claude.js`/`bridge.js` nicht im Diff.
- **authFailClosedIntact:** die einzige neue Route haengt am selben `operator`-Wrapper (`webAuthMw+adminMw`) wie `cost-drift`/`platform-costs`; beide AUTH-P6-Tests von sechs auf sieben Routen erweitert; neuer HTTP-Test belegt 401/403/200.
- **noSecretsLeaked:** Antwort und Sweep-Zeile tragen nur Katalog-Traegernamen, Zaehler, Prozente, Fensterlaengen; zwei Tests scannen gegen Call-ID/Tenant-ID/E.164. SMS-Empfaenger nie geloggt.
- **scopeRespected:** 15 Dateien, alle im Auftragsblatt benannt plus zwei belegte Notwendigkeiten (`pflichtTraegerFuerProfil`, eigenes Regelwerk-Modul). Keine neue Dependency. Env-Var dreifach verdrahtet.
- **behaviorAsIntended:** alle sieben Kriterien (a)-(g) je mit einem Test gepinnt, inkl. beider Gegenproben und der Trennung "vorlaeufig = angelegt fuer Herzschlag, nicht belegt fuer Deckung". Rollback-Hebel nachweislich wirksam (`herzschlag=aus`).
- **independentTestSummary:** Worktree-Symlink-Problem (`node_modules -> ./node_modules` selbstbezueglich) auf den echten Repo-`node_modules`-Pfad korrigiert, danach lief alles. `npm test` (Branch `review-kv2-6` = `phase/kv2-6-impl` @38e7cb5, Basis `master` `f428ef1`): EXIT=0, 5540/5540/0. Beide Backends in einem Lauf (json + pg via pglite), `skipped=0`. Neue Tests isoliert: 18/18 pass. `npm run test:gates`: 129/126/3, Gegenprobe auf master detached (`f428ef1`) identisch (Bestandsrot, nicht KV2-6-verursacht). `npx eslint .`: 0 Fehler, 66 Warnungen, keine in geaenderten Dateien, kein neues `eslint-disable`.
- **blockers:** keine.
- **concerns:**
  1. `render.yaml` fehlt `KOSTEN_HEARTBEAT_FENSTER_H`, obwohl Geschwister-Keys dort stehen — Wirkung gering (Code-Fallback 6, Dashboard-managed, Rollback im Dashboard setzbar), kein Paritaets-Test erzwingt es.
  2. Einmaliges Deploy-Rauschen: Altanrufe vor dem KV2-5-Einsammler zaehlen als "offen" -> `deckung-unter-schwelle:telnyx_call_records` kann einmalig feuern, entprellt, kein Geldweg beruehrt.
  3. Keine `closeCoverageBefunde`-Gegenpart fuer die drei neuen Befundklassen — heilt der Sachverhalt, bleibt der Outage-Marker offen, faellt bei Wiederholung auf Notiz-Stufe. In KV2-7 mitziehen.
  4. Fail-silent bei unvollstaendigem `billing`-Objekt: fehlt `kostenHeartbeatFensterH`, ergibt `fenster()` ein NaN-Intervall — misst nichts, meldet aber `herzschlag=keine` statt sichtbares `herzschlag=aus`. Prod ist durch Config-Fallback gedeckt.
  5. Mini-Scope-Kante (nicht blockierend): `sendDriftAlertSms`-Wrapper entfernt, Aufruf in `alertDrift` inlined — verhaltenserhaltend, aber von KV2-6 nicht explizit verlangt.

## Clean-Code-Audit (s1-s4)

- **s1:** keine
- **s2:** keine
- **s3:** KV2-6-S3-1 — `src/billing/kostenarten.js:pflichtTraegerFuerProfil`: minimale Konzept-Naehe zu `hatEinsammler` (beide filtern ueber `EINSAMMLER.NICHT_BELEGPFLICHTIG`), aber unterschiedliche Frage (profil-lokal vs. global) und unterschiedlicher Rueckgabetyp — kein Flag, nur Randnotiz.
- **s4:** keine
- **blocker:** false

**Verdict: PASS.** Reines Regelwerk ohne Store-Mutation/Netz-IO/console/await, strikt einseitige Import-Richtung (kein Zyklus, Zeitfenster als Parameter statt Import). Alle Funktionen kurz (max. 31 Zeilen), niedrige Verschachtelung, keine Magic Numbers (G25 durchgehend, benannte Konstanten). Neue Route korrekt hinter `webAuthMw+adminMw`, in Route-Inventar konsistent nachgezogen. `config-namespaces.test.js` korrekt auf 49/177/166 nachgezogen. `.env.example` dokumentiert den Schluessel inkl. Karenz-Herleitung. Tests decken Kernverhalten mit realistischen Fixturen und benannten Konstanten statt Zahlen-Literalen ab. Bestandstests korrekt auf das neue Sweep-Zeilenformat nachgezogen. `node --check` und ESLint sauber auf allen 5 Kern-Dateien. Vollstaendiger Regressionslauf zeigt 5 Fehlschlaege, alle ausserhalb des Diffs und thematisch unverbunden (Aufraeum-Gate-CLI, i18n-Praezedenz#8 FR/EN) — keiner beruehrt billing/kosten-deckung/cost-truing/config/route-auth. Keine S1/S2-Befunde.

**passNotes:** Zyklus-Freiheit explizit dokumentiert und eingehalten; Konstanten-Disziplin durchgehend; Deckung vs. Herzschlag sauber als zwei orthogonale, unabhaengig testbare Fragen getrennt; A2 korrekt und getestet; Rollback-Hebel vorhanden und getestet; PII-Freiheit durch expliziten Test mit markanten PII-Fixturen belegt; Auth-Inventar vollstaendig nachgezogen statt nur die Route hinzugefuegt; Bestandsformat der Sweep-Zeile byte-kompatibel erweitert (HINTEN angehaengt, wie `kanaele=` es vormacht), alle Konsumenten-Tests entsprechend aktualisiert.

**topTodos (optional, kein Blocker):**
1. Den S3-Naehe-Hinweis zwischen `hatEinsammler` und `pflichtTraegerFuerProfil` im Kommentar noch praeziser abgrenzen.
2. Die 5 unabhaengigen Bestandsfehlschlaege (Aufraeum-Gate-CLI, i18n-Praezedenz#8) separat triagieren, bevor sie sich anhaeufen.

## Fix-Runden

Keine — beide Reviews (Safety + Clean-Code) kamen im ersten Durchlauf zu PASS ohne Blocker. Keine Fix-Runde noetig.

## Rueckfragen fuer den Owner (aus dem Plan, nicht selbst entschieden)

1. Owner-Entscheidungen 11/12/14 laufen weiterhin auf Default (a). Faellt Punkt 11 spaeter auf (b), kehrt sich Kriterium (f) um: `telnyx_call_records` muesste dann aus dem Herzschlag ausgenommen werden (eine Stelle: `pflichtTraegerFuerProfil`-Traegerliste).
2. Auslegung A1 (globale `coverage_below_threshold`-Achse bleibt additiv neben der neuen bestehen) — zwei vertretbare Ausgaenge, hier bewusst additiv gewaehlt.
3. Auslegung A2 (Herzschlag verdraengt Deckungsmeldung desselben Traegers) — zur Bestaetigung vorlegen.
4. Die Karenz ist eine neue, abgeleitete Betriebsgroesse ohne eigenen Env-Knopf. Sollte sie ein Knopf werden, gehoert sie nach `config.js`.
