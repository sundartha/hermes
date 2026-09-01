# Phase KV2-9 — Reifung des EL-Belegs, nachgeholte O3-Messung

**Gate: PASS** (Safety: approved, Clean-Code: PASS, keinem Blocker)
**finalBranch:** `phase/kv2-9-impl`
**headCommit:** `bb37db228c729b106863aa75a443abf8c851f807`
**Basis:** `master` @ `db63fa4` (KV2-8 gemergt)

---

## 1. Ziel der Phase

Der zweite, reifende ElevenLabs-Kostenabruf für `el_convai_sip`-Anrufe (Belegzeile
`vorlaeufig` -> `belegt`), die nachgeholte O3-Messung als laufender Abweichungszähler
in der Sweep-Zeile, die Freigabe der gemessenen Pflicht-Typmenge für `EL_CONVAI_SIP`
(Zusatzauftrag 2) und die Behebung von Befund F-2 (fail-soft verschluckte
Belegschreibung im Fixture-Test).

## 2. Drei Vorab-Befunde, die den Zuschnitt bestimmt haben

- **B-A**: `sweepDarfKorrigieren` in `src/billing/cost-truing.js` schließt
  `el_convai_sip` **unbedingt** vom Geldweg aus (unabhängig von Belegreife/Pflicht-
  Typmenge). Folge: auch nach KV2-9 bewegt sich für EL-Anrufe **kein Cent** —
  Abnahmekriterium (h) ist nur als "nie zweimal, weil strukturell nie einmal"
  erfüllbar, nicht wörtlich. Gemeldet als **OR-1**.
- **B-B**: Die Auftragsprämisse "mit `PFLICHTTYPEN_UNGEMESSEN` gilt jeder Pool als
  vollständig" trifft am gemergten Code nicht mehr zu — `classifyRecords` hat bereits
  einen Allquantor-Riegel (`requiredRecordTypes.length > 0 && ... .every(...)`), die
  leere Menge liefert also `incomplete`, nicht `complete`. Die neue Pflicht-Typmenge
  ist damit heute **verhaltensneutral auf dem Geldweg** (gewaschen durch
  `ohneBeweiskraft` aus KV2-8B). Gemeldet als **OR-2**.
- **B-C**: `scripts/check-staged-suppressions.js` (pre-commit) verlangt für
  `src/billing/cost-truing.js` eine **exakt unveränderte** Lint-Befundmenge
  (`makeCostTruing` 292 Zeilen, `trueOneCall` Komplexität 12). Jede Änderung musste
  zeilen-neutral gegenfinanziert werden.

## 3. Plan (gekürzt)

### Neue Dateien
- `src/billing/el-reifung.js` — reines Regelwerk (`reifungsKandidat`,
  `reifeErgebnis`) + Orchestrierung `reifeElBelege` (Drossel
  `EL_REIFUNG_MAX_ANFRAGEN_JE_SWEEP = 25`, drei Schreibformen
  belegt/unbeschaffbar/fehlversuch). Wiederverwendet `elBelegBetrag` aus
  `elevenlabs/kosten-beleg.js` statt einer zweiten Geldregel.
- `scripts/kv2-9-nachlauf-zwangssettlement.js` — zweiter einmaliger Nachlauf, Muster
  wörtlich nach `kv2-7-nachlauf-phasenschnitt.js` (Dry-Run per Default, `--apply`).
- `test/kv2-9-el-reifung.test.js`, `test/kv2-9-nachlauf-zwangssettlement.test.js`.

### Kernregeln (`el-reifung.js`)
- `reifungsKandidat`: 7 fail-closed-Bedingungen in fester Reihenfolge (Profil,
  Conversation-Id, EL-Zeile vorhanden, Zeile nicht fertig, `nachreifbar`,
  Mindestalter `elEvidenceMinAgeMinutes`, Versuchsbudget `costTruingMaxAttempts`).
- `reifeErgebnis`: gleich -> `bestaetigt`; höher -> `hoeher` (übernommen); niedriger ->
  `niedriger` (der HÖHERE bleibt) — die Max-Regel, weil eine nie belegte Zeile bei
  Fristablauf ganz verloren geht.
- 404 vom Anbieter -> `vorlaeufig` bleibt **mit** Betrag, nur `nachreifbar:false`
  (Einbahnstraße, kein Alarm, kein Wurf).
- jeder andere Fehler -> `FEHLVERSUCH`, nur Versuchszähler +1.
- Drossel 25 Abrufe/Sweep (gemessene untere Schranke, `befund-elevenlabs.md`),
  bewusst **ohne** Env-Override; Rückstau sichtbar als `el_uebrig=` in der Sweep-Zeile.

### Integration `cost-truing.js` (zeilen-neutral)
- Reifungs-Zweig läuft **vor** dem Pool-Abruf, über dieselbe Kandidatenmenge wie der
  Telnyx-Pfad (PM-5-Zusage bleibt wörtlich: kein `await` mehr ab dem Pool-Abruf).
- Sweep-Zeile erhält `el_reifung=`/`el_abweichung=`/`el_uebrig=` hinten angehängt
  (Bestandsfelder unverändert).
- Gegenfinanzierung des Lint-Budgets: `isRetrievable`/`nonNegativeCount` aus dem
  `makeCostTruing`-Closure auf Modul-Ebene gezogen (−2 gezählte Zeilen gegen +2 neue).

### Zusatzauftrag 2 (`kostenarten.js`)
- `pflichttypen` für `EL_CONVAI_SIP`: `PFLICHTTYPEN_UNGEMESSEN` ->
  `Object.freeze(["sip-trunking"])`, belegt mit einer echten Positiv-Kontrolle
  (GET `/v2/detail_records`: 7/7 `sip-trunking`-Treffer = die 7 jüngsten
  Prod-DB-Anrufe, 0/0 für alle anderen Typen).

### `nachlauf-phasenschnitt.js`
- Gemeinsamer Rumpf `laufUeberAnrufe` per Refactor aus dem KV2-7-Nachlauf gezogen.
- Neues Prädikat `istZwangsGesetteltImKv2_8Fenster` (5 Bedingungen: Profil,
  `costTruedAt` gesetzt, Endzustand `unvollstaendig_final`, genau eine `vorlaeufig`-
  EL-Zeile, Belegsumme **echt unter** Schätzung via
  `convertProviderMicroToBucketCents` mit `remMicro:0` — beweisbar konservativ).
- KV2-7- und KV2-9-Kandidatenmengen sind disjunkt (an einem Fixture in beide
  Richtungen geprüft).

### Konfiguration
- `EL_EVIDENCE_MIN_AGE_MINUTES` (Default 15, **vermutet**, nicht gemessen) in
  `config.js`, `CONFIG_NAMESPACES.billing`, `.env.example`, `test/helpers.js#BASE_ENV`.
  Bewusst **nicht** in `render.yaml` (Präzedenz KV2-6/7).
- `server.js`: `elKostenRead`-Port (`fetchConversation` gegen die echte ElevenLabs-API)
  als schmales DIP-Objekt verdrahtet, in `makeCostTruing` injiziert.

### F-2
- `test/el-fixtures-echte-antworten.test.js`: Fake-Store bekam
  `recordCallCostEvidence`/`callCostEvidence`, delegiert an die echten
  `state-ops.js`-Funktionen statt in KV2-4s fail-soft-`catch` zu verschwinden. Zwei
  neue Fälle F-2a/F-2b belegen den Belegweg erstmals auf dem echten Poll-Pfad.

## 4. Impl-Zusammenfassung

- **Dateien neu**: `src/billing/el-reifung.js`,
  `scripts/kv2-9-nachlauf-zwangssettlement.js`, `test/kv2-9-el-reifung.test.js`
  (27 Fälle), `test/kv2-9-nachlauf-zwangssettlement.test.js` (10 Fälle).
- **Dateien editiert**: `.env.example`, `src/billing/cost-truing.js`,
  `src/billing/kostenarten.js`, `src/billing/nachlauf-phasenschnitt.js`,
  `src/config.js`, `src/db/schema.sql` (nur Kommentar), `src/server.js`,
  `src/store/state-ops.js` (nur Kommentar), `test/config-namespaces.test.js`,
  `test/cost-truing-harness.js`, `test/cost-truing-retrievable.test.js`,
  `test/cost-truing-sweep-log.test.js`, `test/el-fixtures-echte-antworten.test.js`,
  `test/helpers.js`.
- `npx eslint src/billing/cost-truing.js --suppressions-location
  eslint-suppressions.empty.json` liefert **exakt** die 20 Meldungen von vorher
  (inkl. `(292)`/`complexity of 12`) — Bau-Gate B-C erfüllt, echtes CLI-Ergebnis,
  nicht nur die API.
- `npm run lint`: 0 Fehler beim Commit (Pre-Commit-Hook real gelaufen).
- Tests: 5639 pass / 1 fail im ersten Vollauf (`AL-P10-1`, Circuit-Breaker/Precall-
  Research — isoliert zuverlässig grün, kein Bezug zu Billing).

### Deviations
1. Server-Smoke nur best-effort: lokaler Boot bricht am bestehenden Boot-Guard
   ("Keine aktive Nummer im Store") ab, unabhängig von KV2-9 — `node --check` auf
   allen betroffenen Dateien ist grün, aber kein End-to-End-Beleg des
   `elKostenRead`-Pfads am laufenden Server.
2. `AL-P10-1` flackt im Vollauf (1x von zwei Läufen), isoliert zuverlässig grün, ohne
   Bezug zu Billing/Cost-Truing — vermutlich bestehender Timer-/Load-Flake.
3. OR-1 bestätigt: `sweepDarfKorrigieren` schließt `el_convai_sip` weiterhin
   bedingungslos vom Geldweg aus — Phasenziel "Erstattung für EL-Anrufe" ohne
   gesonderte Owner-Entscheidung nicht erreichbar; Riegel bewusst nicht angefasst.
4. `elKostenRead`-Wiring in `server.js` ist nicht durch
   `ELEVENLABS_OUTBOUND_ENABLED` gegated — harmlos (ohne EL-Anrufe keine
   Kandidaten), aber im Plan nicht explizit genannt; als Beobachtung markiert.

## 5. Safety-Urteil

**approved = true**, alle Einzelkriterien (`testsPassIndependently`,
`safetyGatesIntact`, `disclosureIntact`, `authFailClosedIntact`, `noSecretsLeaked`,
`scopeRespected`, `behaviorAsIntended`) = true.

Unabhängige Verifikation in frischem Worktree:
- `npm test` Lauf 1: 5640/5639 pass/1 fail (`onboarding-outbound.test.js`, 401 statt
  200); isoliert 2/2 grün; Lauf 2 vollständig: 5640/5640 grün — Flake nach Repo-Regel
  ("rot zählt nur, wenn isoliert rot"), berührt keine Datei dieses Diffs.
- Beide Store-Backends (json/pg via pglite) grün für die relevanten
  Paritätsfälle (`callCostEvidence`, `costProfile`).
- 37 neue Testfälle (kein Katalog-ID-Präfix, landen korrekt im Regressionslauf) alle
  grün.
- `npx eslint .`: 0 errors, 66 warnings (alle Bestand, keine in neuen Dateien);
  `eslint-suppressions.json` unverändert.
- `node --check` auf allen Kern-/neuen Dateien sauber.
- `npm run test:gates`: 125/129 grün, 4 rot — GAP-05, GAP-15, E2E-03 plus ein
  laufinstabiler vierter, alle Bestandsbefunde ohne Bezug zu dieser Phase.

Geprüft gegen die absoluten Regeln:
- **SAFETY-GATES**: keine Gate-Datei berührt; `applyCostCorrectionCents` hat im
  ganzen Baum genau einen Aufrufer (`setteleAnruf`), dessen Riegel `el_convai_sip`
  weiterhin ausschließt; der Nachlauf bucht nichts, setzt nur `costTruedAt` zurück;
  nicht in den Boot verdrahtet, Dry-Run per Default.
- **OFFENLEGUNG**: `claude.js`/`bridge.js` nicht im Diff, `disclosureSentence` kommt
  nicht vor.
- **AUTH FAIL-CLOSED**: kein neuer Endpunkt, `route-policy.js` unberührt; einzige
  neue Außenkante ist ein ausgehender, rein lesender GET an ElevenLabs.
- **SECRETS**: EL-Schlüssel bleibt in `config.voice.elevenLabsOutbound`; Logs zeigen
  nur Call-Ids, Enum-Gründe, Store-Fehlermeldungen — nie Antwort-Rumpf oder
  Anbieter-Fehlermeldung.
- **SCOPE**: keine neue Dependency; zwei über die Spec hinausgehende Refactors
  (Modul-Ebene-Helfer, `laufUeberAnrufe`), beide begründet und verhaltenserhaltend.

### Concerns (keine Blocker)
1. Abnahmekriterium (h) nicht wörtlich erfüllbar (OR-1) — sauber als Owner-Rückfrage
   gemeldet, keine Implementierungslücke.
2. Zusatzauftrag-2-Test Z2 deckt die Verhaltensneutralität, nicht die eine echte
   Verhaltensänderung (Pool MIT `sip-trunking`-Beleg kann jetzt `complete=true`
   liefern) positiv ab — dünn, aber ohne Geldwirkung.
3. Kein benannter Notaus für den neuen Anbieter-Abruf; der 404-Zweig ist eine
   Einbahnstraße — ein systemischer 404 (API-Umbau, Konto-Wechsel) markiert Zeilen
   unwiderruflich als `beleg_strukturell_unbeschaffbar`. `EL_EVIDENCE_MIN_AGE_MINUTES`
   sehr hoch wäre ein De-facto-Hebel, ist aber nirgends als Notbremse benannt.
4. `EL_REIFUNG_MAX_ANFRAGEN_JE_SWEEP=25` hart verdrahtet (bewusst, OR-3); ein
   dauerhafter Rückstau ist nur an `el_uebrig=` sichtbar, keine Warnschwelle.
5. Theoretische Lücke in `reifeErgebnis`: `altMikroCents === null` + Anbieter liefert 0
   würde in den NIEDRIGER-Zweig fallen und eine nicht-summierbare `belegt`-Zeile mit
   `betragMikroCents: null` erzeugen — heute unerreichbar, da kein Schreiber eine
   Zeile ohne Betrag anlegt; ein `isProviderMicroCents`-Guard wäre billig.
6. Drossel nutzt `treffer.slice(0, maxAnfragen)` ohne eigene Sortierung — der
   "älteste zuerst"-Test hält nur, solange die Kandidatenmenge in Alters-Reihenfolge
   ankommt.

## 6. Clean-Code-Audit (S1–S4)

**Verdict: PASS**, `blocker: false`.

- **S1 (Blocker)**: keine.
- **S2 (Blocker)**: keine.
- **S3 (Bagatellen)**:
  - `src/server.js`: `elKostenRead` ist ein Objekt-Literal statt einer Fabrik wie
    andere Ports — bewusst begründet (genau ein Aufrufer), keine Änderung nötig.
  - `el-reifung.js`/`nachlauf-phasenschnitt.js`: sehr dichte
    Herleitungskommentare — entspricht Repo-Konvention, unverändert lassen.
- **S4**: keine Verstöße; Funktionen klein, Argumentzahl per Objekt-Parameter niedrig
  gehalten (F1 eingehalten trotz vieler logischer Parameter).

Passnotes: Import-Richtung strikt einseitig (kein Zyklus), Geldpfad bleibt Ganzzahl
(Mikro-Cents), Doppelbuchungs-Riegel nutzt eine geteilte Umrechnungsfunktion statt
einer zweiten Formel, Drossel bewusst ohne Env-Var (Präzedenz
`SWEEP_REQUESTS_WARN_THRESHOLD`), Pflichttypen-Freigabe mit konkreter
Positiv-Kontrolle belegt, alle neuen Env-Variablen dokumentiert und im
billing-Namespace gezählt.

Top-Todos (keine Code-Änderung nötig):
1. Vor Merge `npm test` vollständig grün bestätigen (war zum Audit-Zeitpunkt noch
   nicht vollständig durch — im Safety-Review dann nachgewiesen, s. o.).
2. Betrieblich beobachten: `EL_EVIDENCE_MIN_AGE_MINUTES=15` ist vermutet; der
   `el_abweichung`-Zähler ist die nachgeholte Messung, Anpassung erst nach echten
   Produktionsdaten.

## 7. Fix-Runden

Keine — der Impl-Durchlauf lief ohne Nachbesserungsrunde durch Safety und
Clean-Code (`=== FIXES ===` leer). Alle Concerns/Bagatellen sind Beobachtungs- bzw.
Owner-Themen, kein Blocker, daher kein Fix-Zyklus ausgelöst.

## 8. Offene Owner-Rückfragen (aus dem Plan, unverändert offen nach Impl)

- **OR-1**: `sweepDarfKorrigieren` weiterhin unbedingter Ausschluss von
  `el_convai_sip` vom Geldweg — Phasenziel "Erstattung für EL-Anrufe" damit ohne
  weitere Owner-Entscheidung nicht erreicht.
- **OR-2**: Pflicht-Typmenge ist auf dem Geldweg heute verhaltensneutral (durch
  `ohneBeweiskraft`/`classifyRecords`-Allquantor); Auftragsprämisse "leere Menge =
  vollständig" gilt für `classifyRecords` nicht mehr.
- **OR-3**: Drossel `EL_REIFUNG_MAX_ANFRAGEN_JE_SWEEP=25` bewusst ohne Env-Knopf;
  Alternative wäre ein vierter Kosten-Env-Wert, falls der Owner sie steuern will.
- **OR-4**: Terminfrage — KV2-9 sollte vor Ablauf der ersten
  `COST_SETTLE_DEADLINE_HOURS` (48h) nach KV2-8-Deploy live sein.
- **OR-5**: `EL_EVIDENCE_MIN_AGE_MINUTES=15` ist vermutet, nicht gemessen; Senkung
  erst nach `el_abweichung=0` über N Anrufen, als Owner-Entscheidung.
