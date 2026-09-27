# Phase E3 — Anruf-Pfad: Idempotenz (180 s) + Hop-Frist

- **Gate:** PASS
- **finalBranch:** `phase/openai-e3-idempotenz`
- **Basis:** `master` @ `1d928bf`
- **headCommit (Impl):** `ce497b046b78a8be3c66c5543449d23f6985aeff`

## Plan (gekürzt)

Ziel: ein Tenant, der `place_call` zweimal auf dieselbe Zielnummer auslöst waehrend der erste Anruf noch laeuft, bekommt keinen zweiten Anruf, sondern den laufenden zurueck (`deduplicated:true`). Dazu ein serverseitiges, striktes Praedikat auf Tenant + normalisiertes Ziel + Status "active" + 180 s-Fenster (`src/telephony/call-dedup.js#findDuplicateOutboundCall`, rein, ohne IO/State). Kein client-gelieferter Idempotenz-Schluessel.

Zwei zuvor offene Punkte wurden am Code belegt statt geraten:
- **Attrappen-Naht fuer einen Wurf vor `createCall`:** existiert bereits als In-Process-Mount der echten Gate-Kette (`test/sec-p6-gate-fehlerpfad.test.js`, `zaehlenderStore`).
- **Hoehe der Hop-Frist:** aus dem LLM-Seam hergeleitet, nicht geschätzt — `REQUEST_TIMEOUT_MS` (120000, Klingelphase) + 2×`config.llm.briefingTimeoutMs` (je 6000, Briefing + Eröffnungszeile, beide mit `MAX_RETRIES=0` also ohne Backoff) = 132000. `PLACE_CALL_HOP_TIMEOUT_MS = 180000` → 48 s Kopf. `DEDUP_WINDOW_MS` (180000) ist strukturell `>= PLACE_CALL_HOP_TIMEOUT_MS`, damit ein Host-Retry nach Fristablauf noch im Fenster landet.

Bausteine:
- **Neu:** `src/telephony/call-dedup.js` — `findDuplicateOutboundCall(activeCalls, {to, nowMs})`, strikte String-Gleichheit, kein Praefix-/Fuzzy-Match, keine Normalisierung im Praedikat (die ist vorgelagert am `normalize_target`-Gate).
- **`state-ops.js`:** zweiter Freigabeweg `releaseOutboundReserveCents(s, tenantId, cents)` fuer Reserven OHNE Call-Datensatz (Dedup-Fall, Fehlerklammer vor `createCall`) — getrennt von `releaseOutboundReserve`, Clamp ≥ 0, `isBookableCents`-Pruefung. Wrapper in `json.js`/`pg.js`/`store.js`.
- **`api-calls.js`:** Claim-Abschnitt (Dedup-Entscheidung + `createCall` in EINEM synchronen `withStoreLock`-Abschnitt, kein `await` im Body), Fehlerklammer nach dem Gate-Denial-Return mit Reserve-Ruecklauf bei Wurf, `deduplicated`-Feld in der Antwort, 503 (`HTTP_SERVICE_UNAVAILABLE`) statt unhandledRejection.
- **`mcp-tools.js`:** `PLACE_CALL_HOP_TIMEOUT_MS`, eigener Zugang `placeCallHop` (Timeout → `CALL_START_UNCONFIRMED`), `deduplicated` additiv in `CALL_OUTPUT` (NICHT in `CALL_STATUS_OUTPUT`), Beschreibungssatz ergaenzt.
- **`i18n/mcp-texts.js`:** Fehlercode `CALL_START_UNCONFIRMED` + Hinweis `callAlreadyRunningHint`, je de/en/fr.

Tests laut Plan: `test/openai-s3-hop-frist.test.js` (strukturelle Fristen-Invariante, Abbruch-Zweig 3 Sprachen, Praedikat-Tabelle), `test/openai-s3-place-call-idempotenz.test.js` (Teil A: echter Spawn-Server, echte Nebenlaeufigkeit; Teil B: In-Process mit echter Gate-Kette + echtem Reserve-Ledger), Anpassung `sec-p6-gate-fehlerpfad.test.js` (neue Store-Methoden in `NICHT_KETTEN_QUELLEN`) und `mcp-tools-language.test.js` (T9-Schluesselliste).

Blast Radius: Altlast-Ratschen (`eslint-legacy-exceptions.json` + Spiegel in `check-staged-suppressions.test.js`) muessen exakt nachgezogen werden, keine neue Env-Variable, kein neuer Endpunkt, keine Provider-API-Aenderung. G30-Split von `api-calls.js` bleibt bewusst ausserhalb dieses Schnitts.

## Impl-Zusammenfassung

E3 exakt nach Plan umgesetzt. Neu: `src/telephony/call-dedup.js` (rein), `state-ops.js#releaseOutboundReserveCents` (+ Wrapper `json.js`/`pg.js`/`store.js`), `mcp-tools.js#PLACE_CALL_HOP_TIMEOUT_MS` (180000, mit Herleitungs-Kommentar) + `placeCallHop` + Fehlercode `CALL_START_UNCONFIRMED` (DE/EN/FR) + `callAlreadyRunningHint`. `api-calls.js`: Claim-Abschnitt (Dedup-Entscheidung + `createCall` in EINEM `withStoreLock`), Fehlerklammer mit Reserve-Ruecklauf, `deduplicated`-Antwortfeld.

Zwei neue Testdateien (Teil A Spawn-Server echte Nebenlaeufigkeit, Teil B In-Process mit echter Gate-Kette + echtem Reserve-Ledger) plus Hop-Frist-Tests. Drei Bestandstests zusaetzlich angepasst (`audit.test.js`, `number-gate.test.js`, `ie6-s1-katalog-umzug.test.js`) — ein Seed-Call auf dasselbe Ziel kollidierte, jeweils per anderer Zielnummer bzw. ergaenzter Fake-Store-Methoden geloest, nie das Dedup-Fenster geschwaecht.

`eslint-legacy-exceptions.json` + Spiegel in `test/check-staged-suppressions.test.js` fuer `state-ops.js`/`pg.js`/`api-calls.js`/`mcp-tools.js` exakt nachgezogen; die native `eslint-suppressions.json` fuer `state-ops.js` (einzige Datei mit echter Zaehler-Bewegung: `id-length` 248→249, `no-param-reassign` 32→33) ebenfalls. `PLAN-SECURITY.md` um einen Abschnitt zu E3 ergaenzt.

Ergebnis: `npm test` 6136/6136, 0 fail. `npm run test:gates`: nur 3 vorbestehende, unabhaengige Katalog-Luecken rot (GAP-05/GAP-15, E2E-03), keine E3-Regression. `npm run lint`: 0 Fehler.

### Deviations

1. `PLACE_CALL_DESCRIPTION`-Zusatz musste kuerzer formuliert werden als im Plan-Wortlaut, sonst reisst der gepinnte 6300-Zeichen-Deckel (GQ-B1-04). Inhalt/Wirkung identisch, nur Wortlaut gekuerzt.
2. Drei Bestandstests (`audit.test.js`, `number-gate.test.js`, `ie6-s1-katalog-umzug.test.js`) mussten zusaetzlich zu den im Plan genannten Dateien angepasst werden — der Plan hatte diese Kollisionen (Seed-Call mit Status `active` auf dasselbe Ziel wie der frische `place_call`) nicht erkannt. Fix jeweils per anderer Zielnummer bzw. ergaenzter Fake-Store-Methoden.
3. Zusaetzlich zur im Plan genannten `eslint-legacy-exceptions.json` musste die native `eslint-suppressions.json` fuer `state-ops.js` nachgezogen werden (ESLint 10 konsumiert sie automatisch ohne Flag) — sonst haette der Pre-Commit-Hook den Commit blockiert.

## Safety-Urteil

**PASS — merge-faehig.** Alle drei Absolutregeln halten: Gate-Kette (`outbound-gates.js`) byte-unberuehrt, unveraendert 18 Glieder, Dedup-Praedikat liegt strikt HINTER der vollstaendigen Kette und ist rein einschraenkend; zweiter Reserve-Schreibpfad ist eng eingehegt (`isBookableCents`, Clamp ≥ 0, nur zwei Aufrufer ohne Datensatz, in beiden Backends nachgemessen); pro-Tenant-Kostendecke sperrt unveraendert beide Richtungen. `claude.js`/`src/elevenlabs/**` unberuehrt, Offenlegungssatz unveraendert. Kein neuer Endpunkt, `/api/calls` bleibt hinter `internalOnly`. Keine neue Dependency, keine neue Env-Variable, kein `eslint-disable`, kein Secret-Leak (Wurf-Marker steht NICHT in der 503-Antwort).

Concerns (keine Blocker):
- Theoretische Doppel-Freigabe-Naht im `catch` (`gibReserveZurueckUndMelde`), praktisch unerreichbar belegt (im fraglichen Fenster steht nur `audit()`/`res.json()`).
- `context_received` in der Dedup-Antwort meldet den Kontext des zweiten (verworfenen) Requests — spec-konform, aber I10-Vertrag leicht widersprechend.
- `CLAIM_ERROR_MESSAGE` (503-Text) ist deutsch-only, erreicht EN/FR-Tenants woertlich — Praezedenz `GATE_ERROR_MESSAGE`, aber Spec-Konvention "i18n fuer neue Texte" hier nicht erfuellt.
- Technische Schuld an der ohnehin gepinnten Riesenroute waechst ehrlich nachgezogen (kein neuer Pin-Typ).
- `activeCallsFor`/`releaseOutboundReserveCents` stehen jetzt in `NICHT_KETTEN_QUELLEN` — sachlich korrekt, aber Ausnahmeliste an einem Safety-Waechter verdient Dauerbeobachtung.
- Akzeptierter Produktpreis (Owner-Entscheidung E-3): ein absichtlicher Zweitanruf an dieselbe Nummer ist 180 s lang unmoeglich; ein haengengebliebener `active`-Datensatz sperrt das Ziel bis Fensterende.

## Clean-Code-Audit (S1-S4)

- **S1:** keine Befunde.
- **S2:** keine Befunde.
- **S3:**
  1. `src/routes/api-calls.js` (G26/N7): schmales theoretisches Waisen-Call-Fenster, falls `audit()` selbst nach erfolgreichem `createCall` (Nicht-Dedup-Zweig) wirft — der catch-Kommentar deckt nur Dedup- und Vor-`createCall`-Faelle ab. Sehr unwahrscheinlich, kein Blocker.
  2. `src/routes/api-calls.js` (G30, bekannt/gepinnt): Riesenfunktion bleibt (234/138 Zeilen, Komplexitaet 25) — Split seit 2026-08-15 bewusst ausgesetzt, E3 hebt den Pin nur ehrlich nach.
- **S4:** keine Befunde.
- **Verdict:** PASS.

## Fix-Runden

Keine Fix-Runde noetig — beide Reviews (Safety, Clean-Code) kamen im ersten Durchlauf auf PASS ohne Blocker.
