# Phase AL-P11 — Ergebnis-Karte statt Prosa

## Ergebnis-Karte

| Feld | Wert |
|---|---|
| Gate | **PASS** |
| finalBranch | `phase/al-p11-ergebnis-karte` |
| Basis | `master` = `c84a160` |
| Head-Commit | `59f9983a60e4a837557530f04764fcbbf52e640e` |
| Tests | 3457/3457 gruen (Impl), unabhaengig 3462/3462 (Safety-Review, +5 durch Backend-Doppelung json+pg) |
| test:gates | 126/129, 3 rot = bekannte Baseline (GAP-05, GAP-15 x2), phasenfremd |
| Fix-Runden | 0 (kein FIXES-Block, direkt PASS) |
| Push/Deploy | keiner (kein `upstream`-Push, keine Render-Env-Aenderung) |

---

## Plan (gekuerzt)

**Ziel:** `summarizeCall` erzeugt zusaetzlich zur Prosa-Summary eine strukturierte Ergebnis-Karte
(`outcome`, `commitments`, `counterparty_commitments`, `open_points`, `next_step`, `facts`),
persistiert als neues nullable Call-Feld `result`.

**Scope:**
- `evidence` (max. 2 woertliche Zitate) gebaut, aber standardmaessig AUS — gesteuert von
  `EVIDENCE_RETENTION_DAYS` (Default 0), die zugleich Schalter UND Frist ist.
- Evidence-Purge laeuft im selben Sweep-Durchgang wie `purgeExpiredDiagnosticTranscripts`,
  eigene kurze Frist, **nie** ueber `RETENTION_DAYS`.
- MCP additiv (nur die 5 handlungsrelevanten Felder, ohne `evidence`/`facts`), Widget additiv,
  SMS-Body nutzt `outcome` mit Summary-Fallback.
- Bench: `expectedResult` + Check `result_slots_present` (kostet Geld -> Checkliste, nicht Teil
  des automatisierten Gates).

**Explizit NICHT:** kein Beziehungsgedaechtnis (Lesen von `facts` ist AL-P12), keine neue Route,
keine neue Dependency, kein Anfassen von `agentTurn`/Offenlegung/Gates/Auth/Signaturpruefung,
keine Aenderung an `RETENTION_DAYS`/`DIAGNOSTIC_RETENTION_DAYS`.

**Zwei begruendete Design-Entscheidungen:**
- **E1** — `EVIDENCE_RETENTION_DAYS` eigene Variable statt Wiederverwendung von
  `DIAGNOSTIC_RETENTION_DAYS` (Vermeidung von "2 Sachverhalte auf 1 Label", LCT-Lehre; sonst
  wuerde eine hochgedrehte Diagnose-Frist stillschweigend Drittzitate laenger halten).
- **E2** — `evidence` und `facts` gehen NICHT durch MCP (`pickTranscript` ist eine Whitelist,
  DSGVO-Minimierung aus P2b bleibt gewahrt; `facts` ist reine AL-P12-Eingabe ohne Konsument).

**Neue Datei:** `src/call-result.js` (rein, kein Store/IO/config-Import) mit
`normalizeCallResult`, `evidenceRetentionEnabled`, `stripResultEvidence`, Konstanten
`RESULT_LIST_MAX_ITEMS=3`, `RESULT_TEXT_MAX_CHARS=200`, `RESULT_EVIDENCE_MAX_ITEMS=2`,
`RESULT_EVIDENCE_MAX_CHARS=160`.

**Edits (Kurzfassung):** `config.js` (neuer Privacy-Key + Namespace), `.env.example`/`render.yaml`/
`test/helpers.js` (Vier-Stellen-Pflicht), `locales.js` (DE/FR/EN Prompt-Erweiterung +
`summaryEvidenceClause`), `claude.js` (`summarizeCall` haengt Klausel bedingt an, setzt
`call.result`, `SUMMARY_MAX_TOKENS` 500->800), `state-ops.js` (dritter Retention-Durchgang
`purgeExpiredResultEvidence`, `pruneOldData` komponiert 3 Durchgaenge), `json.js` (Migrations-
Zusammenfuehrung `CALL_FIELD_DEFAULTS`, reiner Refactor), `pg.js` (`rowToCall` hydriert `result`,
`flushCalls` traegt `result` als `$37` IM `ON CONFLICT DO UPDATE SET` — i8-Lehre), `schema.sql`
(neue Spalte + Forward-Compat-ALTER), `views.js` (Kommentar, keine Code-Aenderung — `result`
bleibt in der Blacklist-Sicht sichtbar), `mcp-tools.js` (`resultCardView`-Whitelist, 5 Felder,
kein `facts`/`evidence`), `call.html`+`widget-i18n.js` (zwei neue Zeilen `outcome`/`next_step`),
`call-finish.js` (SMS nutzt `call.result.outcome` mit Fallback), `boot.js` (Retention-Log-Zeile),
Bench-Skripte (4 Szenarien + `result_slots_present`-Check).

**Tests laut Plan:** 13 neue Tests in `test/al-p11-result-card.test.js` (Rueckfall auf `null`,
Kappung, O5-Riegel/-Obergrenze, Schalter-Semantik, Additivitaet, Prompt-Kopplung, Sweep-Asymmetrie,
`pruneOldData`-Komposition, json/pg-Durchstich inkl. ON-CONFLICT-Falle, MCP-Whitelist-Leak-Test,
SMS-Fallback) plus Nachziehen von 7 Bestandstestdateien.

---

## Implementierungs-Zusammenfassung

Exakt gemaess Plan auf `phase/al-p11-ergebnis-karte` (von `master` `c84a160`) umgesetzt:

- Neu: `src/call-result.js`, `test/al-p11-result-card.test.js` (15 Tests statt geplanter 13,
  als 13a/13b aufgespalten).
- 28 weitere Dateien editiert (Code, Config, Doku, Bench, Tests) — deckungsgleich mit Plan-§3.
- Voller Regressionslauf: **3457/3457** gruen (3442 Bestand + 15 neu).
- Smoke: Server lokal gebootet (`SKIP_TWILIO_SIGNATURE_CHECK=true`), `/healthz` -> `ok:true`.
- Kein Push, kein Deploy, keine Render-Env-Aenderung, `node_modules`-Symlink nicht committet.

### Deviations (vom Plan abweichend, aber notwendig)

1. `test/config-namespaces.test.js` und `test/diagnostic-retention.test.js` waren im Plan NICHT
   als anzupassende Dateien gelistet, mussten aber nach dem Signatur-Update von
   `state-ops.pruneOldData` (dritter Parameter `evidenceRetentionDays`) nachgezogen werden —
   sonst blieben 4 Bestandstests rot (gepinnte Namespace-Zahlen bzw. Invalid-time-value-Crash).
2. Plan-Test 13 (SMS-Fallback) wurde als zwei separate Tests (13a/13b) mit dem bestehenden
   `makeCallFinish`-Testharness umgesetzt statt einer einzelnen Ausdrucks-Assertion, um echte
   `finishCall`-Ausfuehrung zu testen.
3. Test 10 (json-Durchstich) nutzt denselben `DATA_DIR`/Store wie Block 2 statt eines zweiten
   unabhaengigen `DATA_DIR` — ein zweiter dynamischer `json.js`-Import in derselben Testdatei
   haette wegen des gecachten `config.js`-Singletons (dataDir wird nur beim ERSTEN Import
   gelesen) denselben, bereits fixierten Pfad benutzt und waere fehlgeschlagen.

---

## Safety-Urteil

**PASS — mergefaehig.**

- **Tests unabhaengig nachgefahren** in frischem Worktree: `npm test` 3462/3462 gruen (json UND
  pglite-pg in einem Lauf), `npm run test:gates` 126/129 mit exakt den 3 bekannten, phasenfremden
  Roten (GAP-05 Stripe, GAP-15 x2 Legal-Text).
- **Scope respektiert:** 34 Dateien, alle im Spec-Umriss, keine `package.json`/`package-lock.json`-
  Aenderung (keine neue Dependency). Einzige Grenzbewegung: `json.js`-Migrationszusammenfuehrung —
  verhaltensaequivalent, begruendet als G5/S2-Vermeidung.
- **Safety-Gates unberuehrt:** kein Diff in `src/routes/`, Outbound-/Budget-/Nummern-Gate,
  Signaturpruefung, `OUTBOUND_FROZEN`. Einzige Geld-Beruehrung (`max_tokens` 500->800) laeuft
  weiter durch `bookTokenUsage` mit IST-Verbrauch.
- **Offenlegung intakt:** `disclosureSentence` in `claude.js:207` unveraendert, `bridge.js` nicht
  im Diffstat.
- **Auth fail-closed:** kein neuer Endpunkt, keine Middleware-/`safeEqual`-/Signatur-Zeile
  angefasst.
- **Keine Secrets geleakt.** MCP-Weg gibt exakt 5 Felder heraus, `facts`/`evidence` ausgeschlossen
  und per Fixture (AL-P11-12, String-Scan) gepinnt.
- **Verhalten wie spezifiziert:** O5-Riegel fail-closed an der richtigen Stelle (Default 0 in
  `.env.example`, `render.yaml`, `test/helpers.js`); i8-Falle gestellt und bestanden (`result` im
  `ON CONFLICT DO UPDATE SET`, zweiter Flush ueberlebt per Test AL-P11-11).

### Concerns (keine Blocker)

1. Kein Code-Guard gegen `EVIDENCE_RETENTION_DAYS` > `DIAGNOSTIC_RETENTION_DAYS`/`RETENTION_DAYS`
   — dieselbe Musterluecke wie bei `DIAGNOSTIC_RETENTION_DAYS` (keine neue Klasse), "kurze Frist"
   ist damit Betriebsdisziplin, nicht Code.
2. `publicCall` (`views.js`) strippt `result` bewusst nicht — `/api/state`, `GET /api/calls/:id`
   tragen bei `EVIDENCE_RETENTION_DAYS>0` auch `evidence`/`facts` nach aussen (authentifiziert,
   eigener Tenant, kein Leak, aber PLAN-SECURITY dokumentiert nur den MCP-Pfad).
3. `get_transcript` ruft `resultCardView(c.result)` zweimal auf (pickTranscript + Textblock) statt
   aus dem bereits gefilterten `data` zu lesen — reiner Konsistenz-Nit.
4. Nutzenbeweis (Bench, >=80% `result_slots_present`) noch nicht gelaufen (kostet Geld, als offen
   in `tasks/al-testcall-checklist.md` vermerkt) — nur der Code-Teil ist abgenommen.
5. `max_tokens` 500->800 = realer, kleiner Kostenanstieg (~+250 Output-Token/Anruf).

---

## Clean-Code-Audit

**Verdict: PASS.**

- **s1 (Blocker):** keine.
- **s2 (muss vor Merge):** keine.
- **s3 (Kleinigkeiten, nicht blockierend):**
  1. `normalizeCallResult` — Rueckgabe kollabiert bei leerem Inhalt auf `null`, aber der Name
     traegt das nicht; durch Kommentar direkt darueber ausreichend lesbar.
  2. `SUMMARY_MAX_TOKENS = 800` — plausibel begruendete, aber geschaetzte Konstante ohne
     empirische Fussnote im Code.
- **s4 (vorsorglich, keine akute Groesse):** `checkResultSlotsPresent` — Karte traegt inzwischen
  6+ Freitextfelder; bei weiterem Wachstum eigene kleine Modulgrenze erwaegen.

Positiv hervorgehoben: G5-Reduktion in `json.js` (drei strukturgleiche Migrations-Schleifen zu
EINER `CALL_FIELD_DEFAULTS`-Tabelle zusammengefuehrt statt einer dritten Kopie), konsequente
DSGVO-Minimierung (eigene kuerzere Frist, eigener Purge, eigener MCP-Ausschluss, Prompt-Klausel
nur bei aktivierter Frist), additive Rueckwaertskompatibilitaet ueberall, breite Testabdeckung
inkl. Leak-Beweis per String-Scan, konsistente i18n ueber DE/FR/EN.

---

## Fix-Runden

Keine. Der Workflow lief Plan -> Impl -> Safety-Review -> Clean-Code-Audit direkt zu PASS,
ohne FIXES-Block/Nacharbeit.
