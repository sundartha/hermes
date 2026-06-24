# Strategie T-P0-2 — Deploy-Gate haerten

> Schliesst Audit-Finding **F2 (CRITICAL)** + Teil **H7** (CI-Luecken). Quelle:
> `docs/strategy/project-audit-2026-06-19.md`.
> **Reine Strategie-Phase — kein Code geaendert.** Methode: Agent-Team (2 parallele
> Opus/Sonnet-Subagenten: Slice Migration/preDeploy + Slice CI/DEPLOY) plus eigene
> Verifikation der zwei externen Schluesselfakten (Render-preDeploy-Verfuegbarkeit,
> Node-Coverage-Exit-Code).
> Stand: 2026-06-19.

---

## 0. Ausgangslage (gegen Code verifiziert)

| Befund | Beleg im Code |
|---|---|
| Migration laeuft im **Web-Prozess-Boot** (nicht erst beim ersten Request): ESM top-level-await in `store.js` → `createPgBackend()` → `store.init()` → `migrate()` (`applySchema` + `seedDefaults`). | `src/store.js:13-44,53-66`; `src/store/pg.js:50-57`; `src/db/migrate.js:85-88` |
| **Kein Versioning/Ledger/Rollback.** `schema.sql` ist EIN grosses idempotentes DDL (`CREATE TABLE IF NOT EXISTS`, `ALTER ... IF NOT EXISTS`, `DROP POLICY/CREATE POLICY`). Spaetere Aenderungen wurden bisher idempotent in dasselbe File gepatcht. | `src/db/schema.sql` (gesamt) |
| **Default-Backend ist `json`** (Datei). Der pg-Pfad zieht nur bei `STORE_BACKEND=pg` + gesetztem `DATABASE_URL`. `render.yaml` setzt heute `STORE_BACKEND=json`. | `render.yaml:108-113`; `src/store.js:54` |
| **`render.yaml`**: `plan: free`, `buildCommand: npm install`, `startCommand: npm start`, `autoDeploy: true`, **kein** `preDeployCommand`, **kein** `databases:`-Block (DATABASE_URL extern, `sync:false`). | `render.yaml:11-17,112-113` |
| **`DEPLOY.command`** macht `git add -A` → commit → push **ohne Test-Lauf**; `set -u` (kein `set -e`). | `DEPLOY.command:12-23` |
| **CI** (`on: push`): `node --check` + `npm test` + `npm audit --audit-level=high`. Kein Coverage-Gate, kein Secret-Scan, kein PR-/Branch-Protection-Gate. Job-Name `test`. | `.github/workflows/ci.yml` |
| **Tests fahren `pglite`** (in-memory, offline), nicht echtes Postgres. Schema-Idempotenz wird bereits getestet. Jede Migrations-Tooling-Loesung muss gegen pglite gruen bleiben. | `test/pg-helpers.js`; `test/rls-with-check.test.js:131-136`; `test/schema-foundation.test.js` |

**Zwei Tracks, unterschiedlich „scharf":**
- **Track A (Migration/preDeploy)** ist real erst **scharf, sobald Produktion auf `pg` laeuft**. Heute (`STORE_BACKEND=json`) ist der Migrations-Teil von F2 **latent**. Track A koppelt zudem an **T-P0-1** (siehe 0a).
- **Track B (CI + `DEPLOY.command`)** ist **heute scharf** und **plan-unabhaengig** — sofort lieferbar.

---

## 0a. Feasibility-Blocker (verifiziert): `preDeployCommand` ist paid-only

Akzeptanzkriterium 1 verlangt Migrationen als `preDeployCommand` mit Exit-Gate. **Auf
`plan: free` ist das technisch nicht moeglich.** Aus den Render-Docs (doppelt geprueft —
eigener Web-Check + Subagent):

- *„The pre-deploy command is available for **paid** web services, private services, and
  background workers."* → Auf Free existiert `preDeployCommand` nicht. (Render nennt als
  Free-Ersatz: Migration im `buildCommand` — das aber ist **kein** echtes Gate vor dem
  Start und laeuft VOR dem Build-Artefakt-Wechsel, nicht transaktional gegen Live-DB.)
- **Exit-Gate-Semantik (genau das gewuenschte Verhalten):** *„If any command fails or
  times out, the entire deploy fails ... Your service continues running its most recent
  successful deploy."* → `npm run migrate` exit ≠ 0 ⇒ kein neuer Deploy, alter Web-Prozess
  laeuft weiter.

**Konsequenz:** AC1 ist **vollstaendig nur auf einem bezahlten Web-Service-Plan** erreichbar
und erzeugt eine **harte Abhaengigkeit zu T-P0-1** (bezahlter Plan + Managed Postgres). Die
Strategie trennt deshalb sauber:
1. **plan-unabhaengig, jetzt baubar** (Versioning, Runner, Boot-Verify, Tests, gesamte
   Track-B-CI-Haertung) — voll mit `pglite`/`node:test` verifizierbar, ohne auf den Plan
   zu warten;
2. **plan-gated** (die eigentliche `preDeployCommand`-Verdrahtung in `render.yaml`).

Bis der Plan steht, ueberbrueckt ein bewusst-dokumentiertes `MIGRATE_ON_BOOT`-Flag (siehe
2.4) — Migration laeuft dann weiter ueber den **gated Runner** im Boot, aber strukturell
gegen den Ledger (kein Double-Run). F2 ist damit auf Free **teilweise** behoben, auf bezahltem
Plan **vollstaendig**.

---

## 1. Zielbild & Akzeptanzkriterien (Mapping)

| AC | Ziel | Erfuellt durch Phase(n) | Plan-Status |
|---|---|---|---|
| **AC1** | `preDeployCommand` fuehrt Migrationen ausserhalb des Laufzeit-Boots aus, Exit-Gate (≠0 → kein Deploy) | A5 (Boot → verify-only ⇒ Migration raus aus Laufzeitpfad) + **A6** (preDeploy-Verdrahtung) | A5 jetzt; **A6 paid-only** |
| **AC2** | `DEPLOY.command` fuehrt VOR Push `npm test` aus, Abbruch bei Fehler | **B1** | jetzt |
| **AC3** | CI um Coverage-Threshold + gitleaks erweitert | **B2** (gitleaks) + **B3** (Coverage) | jetzt |
| **AC4** | Migrationen versioniert (`002_*.sql`, Forward + Rueckwaerts) | A1 (Baseline+Ledger) + A2 (Runner) + A4 (002-Beispiel) | jetzt |
| **AC5** | Bestehende Tests + `npm run check` bleiben gruen | Querschnitt: jede Phase verifiziert `npm test` + `npm run check` | jetzt |

Uebergeordnetes Ziel **Branch-Protection + required checks + kein Deploy bei rotem Test**:
Track-B-Phasen B4 (PR-Trigger) + B5 (Branch-Protection-Runbook).

---

## 2. Track A — Migration/Deploy-Gate

### 2.1 Versioniertes Migrations-Schema (AC4)

**Layout** (neues `migrations/` auf Repo-Root, parallel zu `scripts/`):

```
migrations/
  001_baseline.up.sql     # = heutiges src/db/schema.sql, eingefroren (bleibt idempotent)
  001_baseline.down.sql   # NUR Marker-Kommentar: "Baseline-Rollback nur via DB-Restore"
  002_<name>.up.sql       # erste echte versionierte Migration
  002_<name>.down.sql     # Forward-Operations-Material (Runbook), kein Auto-Rollback
```

`.up`/`.down` **getrennte Files** (nicht ein File mit Marker) — eindeutig zu laden und zu
testen; der Runner kann `.down` nie versehentlich mit anwenden.

**Ledger-Tabelle** (im Runner idempotent VOR allem angelegt — nicht als Migration, sonst
Henne-Ei):

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
  version    TEXT PRIMARY KEY,              -- "001","002": Datei-Praefix
  name       TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  checksum   TEXT NOT NULL                  -- sha256(.up.sql): Drift-Detection
);
```

- `version PRIMARY KEY` ⇒ zweiter Apply derselben Version per PK ausgeschlossen
  (**Double-Run strukturell verhindert**, nicht nur per Konvention).
- `checksum` ⇒ wird eine bereits angewendete Migration nachtraeglich editiert, stirbt der
  Runner **fail-closed** mit klarer Meldung statt still zu divergieren.
- **Keine RLS** auf `schema_migrations` (Muster wie `tenant`/`audit_log`); der Runner laeuft
  als privilegierte Migrations-Rolle.

**Baseline-Strategie — `001` einfrieren, aber idempotent lassen:**
- Die Baseline ist potenziell **bereits live** (falls eine pg-DB existiert) oder noch nicht
  (wenn Prod auf json laeuft). Beide Faelle muessen funktionieren ⇒ `001` bleibt idempotent
  (`CREATE IF NOT EXISTS` etc., 1:1 aus `src/db/schema.sql`). Auf Live = No-op, auf frisch =
  Vollaufbau.
- **Ledger-Backfill:** Runner wendet `001` an (No-op auf Live) und schreibt
  `INSERT INTO schema_migrations VALUES ('001',...) ON CONFLICT DO NOTHING`. So bekommt eine
  bereits migrierte Live-DB rueckwirkend ihren Ledger-Eintrag, ohne dass `002` uebersprungen
  wird.
- **Ab `002`** uebernimmt der Ledger den Wiederholungsschutz; scharfes DDL ist erlaubt
  (Idempotenz bleibt empfohlen als zweite Linie, ist aber nicht mehr die einzige Absicherung).
- **Eine Quelle:** `src/db/schema.sql` nach `migrations/001_baseline.up.sql` verschieben und
  `SCHEMA_FILE` in `src/db/migrate.js` auf den neuen Pfad zeigen. Test-Imports von
  `applySchema` bleiben gruen, nur der Pfad aendert sich.

### 2.2 Standalone-Runner (`scripts/migrate.js`, `npm run migrate`)

Vertrag exakt wie der Bestand (`migrate.js` + `pg-helpers.js`): `exec(sqlScript)` fuer
Mehrfach-DDL, `query(text,params)->{rows}` fuer parametrisiert.

1. **Skip-Gate zuerst (exit 0):** `storeBackend !== "pg"` ODER `!databaseUrl` → sauberer
   No-op-Log + `exit 0`. **Pflicht**, damit der preDeploy/Boot auch im json-Default-Deploy
   durchlaeuft (sonst blockiert er jeden Deploy). Symmetrisch zur `config.js`-Gate-Logik.
2. **Lazy pg-Import** nur im pg-Pfad (DIP-Muster aus `store.js`): kein DB-Dependency im
   json-Default.
3. **`schema_migrations` idempotent anlegen**, pending Files (`migrations/*.up.sql`,
   lexikografisch) gegen Ledger differenzieren; je bereits-angewendete Migration **Checksum
   vergleichen** (Mismatch → exit ≠ 0).
4. **Pro-Migration-Transaktion** (`BEGIN`/`COMMIT`, Muster wie `flush` in `pg.js`):
   `exec(up.sql)` → `INSERT INTO schema_migrations`. Fehler → `ROLLBACK`, **secret-freier**
   Log (nur `err.message`, nie Connection-String — Begruendung `store.js:48-51`), `exit 1`.
   Pro-Migration statt alle-in-einer: jede angewendete Migration bleibt committed bei
   sauberem Wiederanlauf.
5. **`SET lock_timeout`/`statement_timeout`** vor den Migrationen ⇒ eine haengende Migration
   scheitert kontrolliert mit exit ≠ 0 statt den Deploy ewig zu blockieren.
6. Erfolg: Anzahl loggen, `pool.end()`, `exit 0`.

**Testbarkeit (Pflicht):** Die **Logik** als pure `runMigrations(runner, dir)` von der
Pool-Konstruktion trennen (DIP, genau wie `makePgStore(runner)` vs. `createPgBackend`). Dann
injiziert ein `node:test` denselben `pglite`-Runner wie `pg-helpers.js` und verifiziert
offline: 002 genau einmal angewendet, zweiter Lauf No-op, Ledger-Zeile da, Checksum-Mismatch
wirft. **Kein echtes Postgres im Test.**

### 2.3 Boot-Interaktion: verify-only (Kern von F2)

Solange der Boot migriert, ist die Migration weiter im **Laufzeitpfad und ungated** — F2 nur
halb behoben. Ziel: Boot **verifiziert nur**.

- `src/store/pg.js init()` ersetzt `migrate(client, OWNER)` durch `verifyMigrations(client)`:
  liest `schema_migrations`, vergleicht mit den `migrations/*.up.sql`-Versionen; fehlt eine →
  `throw` mit Hinweis *"pending Migration NNN — 'npm run migrate'/preDeploy ausstehend"*.
  `store.js` faengt das ab und macht `process.exit(1)` mit secret-freier Diagnose (Bestand,
  `store.js:54-63`) ⇒ **fail-closed**: kein Web-Prozess auf veraltetem Schema.
- **Seeding bleibt im Boot** (siehe Pre-Mortem 6.d): `seedDefaults` ist idempotent +
  config-derived + braucht die korrekt gesetzte RLS-GUC (`setTenant` VOR Seed,
  `pg.js:51-52`). Schema (DDL) → Runner/preDeploy; Seed (Daten) → Boot.

### 2.4 `MIGRATE_ON_BOOT` — die ehrliche Bruecke ueber den Free-Plan-Blocker

Da `preDeployCommand` auf Free fehlt, KANN der Boot nicht hart auf verify-only umgestellt
werden, ohne dass niemand mehr migriert. Loesung — ein bewusst-dokumentiertes Flag (kein
stiller Default):

| Umgebung | `MIGRATE_ON_BOOT` | Verhalten | F2 |
|---|---|---|---|
| Free / Fallback | `true` | Boot ruft `runMigrations` (gated ueber Ledger ⇒ harmlos bei Wiederholung) | teilweise behoben, dokumentiert |
| Bezahlt / preDeploy | `false` (Ziel-Default) | Boot nur verify; Migration laeuft ausschliesslich im preDeploy | vollstaendig behoben |

### 2.5 `render.yaml`-Verdrahtung (AC1, plan-gated)

Auf bezahltem Web-Service-Plan (Voraussetzung T-P0-1):

```yaml
services:
  - type: web
    plan: starter            # preDeploy ist paid-only (statt free)
    preDeployCommand: npm run migrate
    autoDeploy: true
```

`preDeployCommand` laeuft NACH `build`, VOR `start`, in eigener Instanz mit denselben
Env-Vars (inkl. `DATABASE_URL`) ⇒ **ausserhalb** des `app.listen`-Boots. Exit ≠ 0 ⇒ kein
Deploy, alter Stand laeuft. Der Skip-Gate (2.2.1) haelt den json-Default-Deploy mit exit 0
durchlaufend. (Managed-Postgres-`databases:`-Block ist T-P0-1-Scope.)

### 2.6 Rollback/Forward

- **Kein Auto-Rollback im preDeploy.** Ein fehlgeschlagener preDeploy laesst alten Code auf
  altem Schema weiterlaufen — es gibt nichts automatisch zurueckzurollen. Ein automatisches
  `down` auf eine halb gelaufene Migration koennte sogar Daten zerstoeren. **Forward-Fix
  (003 korrigiert 002)** ist der Standardweg.
- `.down.sql` = **manueller, im Runbook getesteter** Operator-Pfad fuer bewussten Rueckbau —
  nicht Teil der preDeploy-Kette.
- `001_baseline.down.sql` ist **kein** echtes DROP (Baseline traegt Produktionsdaten) — nur
  Marker *"Rollback nur via DB-Restore aus Backup"*.

---

## 3. Track B — CI + `DEPLOY.command`-Gate

### 3.1 `DEPLOY.command`-Haertung (AC2) — minimal

Einziger Eingriff: `npm test` **vor** `git add -A`; Abbruch bei Fehler. `set -u` bleibt,
**kein** `set -e` (wuerde die Health-Poll-Schleife mit `curl`-Exitcodes brechen).

```bash
# 0. Tests laufen lassen (fail-closed: roter Test -> kein Push)
npm test || { echo "FEHLER: Tests rot. Kein Deploy."; read -r; exit 1; }
# 1. ... bestehender git add -A / commit / push ...
```

**Bewusst NICHT hinein** (Over-Engineering-Schutz — es ist ein Entwickler-Convenience-Skript,
kein CI):
- Coverage/gitleaks → gehoeren in CI; lokal fehlende Tools / `.env.example`-False-Positives
  wuerden jeden Deploy stoppen.
- `npm run check` (`check-setup.js`) → prueft externe Dienste (Anthropic/Twilio/Tunnel),
  schlaegt im Deploy-Kontext fehl.
- `npm audit` → CI-Aufgabe.

### 3.2 CI — gitleaks Secret-Scan (AC3)

- Action `gitleaks/gitleaks-action@v2`, als **erster** Step (frueh scheitern). Auf `push`:
  **Diff-Scan** (schnell); einmaliger Full-History-Scan vorab manuell
  (`gitleaks detect --source . --log-opts "--all"`), um Alt-Secrets auszuschliessen.
- **`gitleaks.toml` zwingend mit einchecken** (sonst schlaegt das Standard-Ruleset sofort auf
  `.env.example` an). Allowlist per **Pfad** (sicherer als Regel-Deaktivierung):

```toml
[allowlist]
  description = "Platzhalter in .env.example und Test-Fixtures"
  paths = [".env.example", "test/helpers.js"]
```

  Begruendung: `.env.example` enthaelt `sk-ant-...`/`ACxxx...`-Platzhalter (kein echtes
  Secret); `test/helpers.js` traegt deterministische Test-Werte (`ACtest...`). `render.yaml`
  ist sauber (`sync:false`/`generateValue`).

### 3.3 CI — Coverage-Gate (AC3)

Bordmittel, Node 22:

```yaml
- name: Coverage-Gate
  run: |
    node --test --experimental-test-coverage \
      --test-coverage-lines=30 --test-coverage-functions=35 --test-coverage-branches=20 \
      "test/*.test.js"
```

**Verifiziert:** Node bricht mit **exit 1** ab, wenn eine Schwelle unterschritten wird.

**Ehrliche Limitation (im CI-Kommentar dokumentieren):** 29 der 81 Test-Dateien spawnen
`src/server.js` als **Kindprozess** (`startServer()` in `test/helpers.js`). Node-Coverage
instrumentiert **nur den Runner-Prozess**, nicht die gespawnten Kinder ⇒ `server.js`,
`store/*`, alle Express-Handler zaehlen NICHT mit, obwohl funktional getestet. Darum
**konservative Startschwelle 30/35/20 (Ratchet)** statt einer Zahl, die luegt.
**Kalibrierung:** ersten CI-Lauf ohne Schwelle fahren, gemessenen Wert ablesen, Schwelle auf
`gemessen − 5%` setzen; spaeter erhoehen, sobald Spawn-Tests durch direkte Imports ersetzt
werden (eigene Schuld, nicht hier).

*Konsolidierungs-Option:* den bestehenden `npm test`-Step durch den Coverage-Lauf ersetzen
(spart den doppelten Lauf ~90 s) — empfohlen, sofern keine separate TAP-Ausgabe gebraucht
wird.

### 3.4 CI — Trigger + Branch-Protection (uebergeordnetes Ziel)

- Trigger erweitern: `on: [push, pull_request]`.
- Required status check = Job-Name **`test`** (bzw. zusaetzlicher `coverage`-Job, falls
  getrennt).
- **Branch-Protection-Runbook** (GitHub-Einstellung, **nicht** committbar — manueller
  Admin-Schritt, `gh auth` mit Admin-Rechten):

```bash
gh api --method PUT repos/{OWNER}/{REPO}/branches/master/protection --input - <<'EOF'
{ "required_status_checks": { "strict": true, "contexts": ["test"] },
  "enforce_admins": true,
  "required_pull_request_reviews": { "required_approving_review_count": 0 },
  "restrictions": null }
EOF
# Verifikation:
gh api repos/{OWNER}/{REPO}/branches/master/protection | jq '.required_status_checks'
```

### 3.5 CI ↔ Deploy koppeln (kein Deploy bei rotem Test)

Heute deployt `autoDeploy:true` bei jedem master-Push **sofort** — die CI laeuft **parallel**,
nicht davor. Optionen:

| Option | Mechanik | passt zu Free? |
|---|---|---|
| **1 (empfohlen)** | Branch-Protection + PR-Workflow: kein Direkt-Push auf master, Merge erst bei gruener CI, danach `autoDeploy` | **Ja** — kein externer Hook noetig |
| 2 | `autoDeploy:false` + Render-Deploy-Hook aus CI nach gruenen Tests | **Nein** — Deploy-Hooks sind paid-only |

Solo-Pragmatik: `enforce_admins:true` erzwingt PRs auch fuer den Owner (sauberstes Gate),
`enforce_admins:false` laesst Admin-Direkt-Push zu, CI laeuft aber trotzdem (schwaecheres,
ehrliches Gate). **Entscheidung beim Menschen** (siehe 7).

---

## 4. Phasen-Schnitt

> Jede Phase klein, einzeln testbar, mit betroffenen Dateien + Parallelisierbarkeit.
> Verifikation bevorzugt deterministisch via `pglite`/`node:test` (offline). **AC5 ist
> Querschnitt:** jede Phase laeuft `npm test` + `npm run check` gruen, bevor sie als fertig
> gilt.

### Track B (jetzt lieferbar, plan-unabhaengig)

| # | Titel | Dateien | Verifikation (deterministisch) | Parallel? | Dep |
|---|---|---|---|---|---|
| **B1** | `DEPLOY.command` Test-Gate (AC2) | `DEPLOY.command` | Test temporaer brechen → Skript bricht mit "Tests rot" ab, kein Commit/Push; gruen → laeuft wie bisher | ja (unabh. von A) | — |
| **B2** | gitleaks Secret-Scan (AC3) | `.github/workflows/ci.yml`, `gitleaks.toml` (neu) | Commit mit Fake-Secret → CI rot; `.env.example`-Platzhalter → gruen (Allowlist) | eingeschr.¹ | — |
| **B3** | Coverage-Gate (AC3) | `.github/workflows/ci.yml` | Unit-Test-Datei entfernen → Coverage < Schwelle → exit 1; sonst gruen | eingeschr.¹ | (Kalibrier-Lauf) |
| **B4** | Trigger `pull_request` | `.github/workflows/ci.yml` | PR oeffnen → CI laeuft auf PR-Commit | eingeschr.¹ | — |
| **B5** | Branch-Protection-Runbook (manuell) | — (GitHub-Setting) | Direkt-Push auf master ohne PR scheitert; PR ohne gruene CI nicht mergebar | nein | B4 (1× gruener PR-Check noetig) |

¹ **B2–B4 fassen dieselbe Datei `ci.yml` an** ⇒ als **ein** CI-Commit/PR bearbeiten (klein,
ein Review-Kontext), Edits sequenziell. B1 ist separater Commit (`DEPLOY.command`).

### Track A (Migration/Versioning; A1–A5 + A7 plan-unabhaengig, A6 plan-gated)

| # | Titel | Dateien | Verifikation (deterministisch, `pglite`) | Parallel? | Dep |
|---|---|---|---|---|---|
| **A1** | Baseline einfrieren + Ledger | `migrations/001_baseline.up.sql` (move von `src/db/schema.sql`), `…down.sql` (Marker), `src/db/migrate.js` (`SCHEMA_FILE`) | `applySchema` 2× ohne Fehler (Bestand `rls-with-check` T6 bleibt gruen, nur Pfad neu); `schema_migrations` CREATE IF NOT EXISTS idempotent | ja (zu Track B) | — |
| **A2** | Pure `runMigrations(runner, dir)` | `src/db/runner.js` (neu) | `node:test`+pglite: leere DB → 001 angewendet + Ledger-Zeile; 2. Lauf No-op; Checksum-Mismatch wirft; pending-Erkennung korrekt | ja (rein) | A1 |
| **A3** | CLI-Runner + Skip-Gate + Secret-Disziplin | `scripts/migrate.js` (neu), `package.json` (`"migrate"`), `.env.example` | `STORE_BACKEND=json npm run migrate` → exit 0 + Skip-Log; ohne `DATABASE_URL` → exit 0; Bash-Check: kein DB-URL-Fragment im Output | teilweise | A2 |
| **A4** | 002-Beispiel-Migration (Forward+Rueckwaerts, AC4) | `migrations/002_<name>.up.sql` + `…down.sql` | pglite: `runMigrations` wendet 001+002 an, beide im Ledger; 002 genau 1×; `.down` nach `.up` syntaktisch anwendbar | nein | A2 |
| **A5** | Boot verify-only + `MIGRATE_ON_BOOT` (AC1-Teil) | `src/store/pg.js` (`init`: migrate→verify+seed), `src/config.js` (Flag), `src/store.js` (Exit-Pfad bleibt) | pglite: fehlende Ledger-Zeile → `init()` wirft mit Hinweis; Flag=`true` → Boot-Apply idempotent; Re-Hydrierung byte-identisch (`store-pg.test` gruen); `seedDefaults` weiter idempotent | nein | A2, A4 |
| **A6** | `render.yaml` preDeploy + Plan (AC1-Rest) | `render.yaml` | Nur bezahlter Plan/Staging: fehlerhafte Migration → Deploy bricht ab, alter Stand laeuft; json-Deploy → preDeploy exit 0 | nein | A3, **T-P0-1** |
| **A7** | Operator-Runbook (Rollback/Forward, Notfall-Bypass) | `docs/` (Runbook-Ergaenzung) | Review: Forward-Fix-Pfad, manueller `.down`-Pfad, `MIGRATE_SKIP`-Bypass, Lock/Timeout dokumentiert | ja (Doku) | A3, A5 |

**Kritischer Pfad A:** A1 → A2 → {A3, A4} → A5 → A7; **A6** zusaetzlich an **T-P0-1** gated.
**A1–A5 + A7 sind plan-unabhaengig und voll mit `pglite`/`node:test` verifizierbar — sofort
baubar.** Nur A6 wartet auf den bezahlten Plan.

### Empfohlene Reihenfolge ueber beide Tracks

1. **Sofort, parallel:** B1 · (B2+B3+B4 als ein CI-PR) · A1 → A2.
2. **Danach:** B5 (nach erstem gruenem PR-Check) · A3/A4 → A5 → A7.
3. **Sobald T-P0-1 steht:** A6 (preDeploy scharf), `MIGRATE_ON_BOOT=false` als Default.

---

## 5. Verifikations-Matrix (AC → Check)

| AC | Deterministischer Beweis | Phase |
|---|---|---|
| AC1 | `init()` wirft bei pending Migration (pglite-Test); auf Staging bricht fehlerhafte Migration den Deploy ab (alter Stand lebt) | A5 (jetzt) / A6 (paid) |
| AC2 | Roter Test ⇒ `DEPLOY.command` exit 1, kein Commit/Push | B1 |
| AC3 | CI rot bei Fake-Secret; CI exit 1 bei Coverage < Schwelle | B2, B3 |
| AC4 | pglite-Test: 002 genau 1× angewendet, Ledger-Zeile, 2. Lauf No-op; `.down` anwendbar | A1, A2, A4 |
| AC5 | `npm test` + `npm run check` gruen nach jeder Phase | Querschnitt |

---

## 6. Pre-Mortem / Risikoregister

| # | Risiko | Mitigation | Status |
|---|---|---|---|
| R1 | `preDeployCommand` paid-only ⇒ AC1 auf Free nicht umsetzbar | `MIGRATE_ON_BOOT`-Fallback (2.4) + harte Abhaengigkeit T-P0-1 ausgewiesen | **bestaetigt** (Render-Docs) |
| R2 | **DB unerreichbar ⇒ preDeploy blockiert ALLE Deploys, auch Notfall-Hotfix** | `MIGRATE_SKIP=true`-Env-Bypass: lauter Log *"Schema NICHT verifiziert"*, exit 0, einmalig im Dashboard gesetzt; alternativ preDeploy im Dashboard temporaer leeren; json-Default-Pfad ist via Skip-Gate ohnehin unbetroffen | designt |
| R3 | Double-Run preDeploy + Boot | Ledger-PK auf `version` (struktureller Schutz) + Boot verify-only; Idempotenz von 001 zweite Linie | designt |
| R4 | Lange/sperrende Migration auf laufender DB (Lock-Konflikt mit altem Prozess) | `lock_timeout`/`statement_timeout` im Runner ⇒ kontrollierter exit ≠ 0; Migrationen klein/additiv; teure Backfills/Indizes separat & bewusst | designt |
| R5 | Over-Engineering `DEPLOY.command` | nur Test-Gate; Coverage/gitleaks/check/audit bewusst ausgeschlossen (3.1) | entschieden |
| R6 | Coverage-Schwelle „luegt" (Spawn-Tests zaehlen nicht) | konservativ 30/35/20, Ratchet, Kalibrier-Lauf, Limitation im CI-Kommentar dokumentiert | designt |
| R7 | gitleaks-False-Positives (`.env.example`-Platzhalter) | `gitleaks.toml`-Pfad-Allowlist; einmaliger Full-History-Scan vorab | designt |
| R8 | Branch-Protection bricht Solo-Direkt-Push-Workflow von `DEPLOY.command` | `enforce_admins` true (PR-Workflow) vs. false (Admin-Direkt-Push, CI laeuft trotzdem) — Mensch entscheidet | offen (7.3) |
| R9 | Prod laeuft heute auf `json` ⇒ Migrations-Track latent | Track B (scharf, plan-unabh.) zuerst; Track A nicht auf Prod-Aktivierung blockieren; Reihenfolge in 4 | benannt |
| R10 | Checksum-Drift (angewendete Migration nachtraeglich editiert) | Runner fail-closed bei Mismatch (2.1) | designt |
| R11 | Migration-Tooling bricht `pglite`-Tests | gesamte Runner-Logik als pure `runMigrations(runner)` gegen pglite getestet (2.2) | designt |

---

## 7. Offene Fragen (Mensch entscheidet)

1. **Render-Plan-Upgrade (T-P0-1)?** Die zentrale Entscheidung: ohne bezahlten Web-Service-Plan
   ist `preDeployCommand` (AC1) nicht verfuegbar; F2 bleibt nur ueber `MIGRATE_ON_BOOT`
   teilweise behoben.
2. **Laeuft Produktion heute auf `pg`?** `render.yaml` setzt `STORE_BACKEND=json`. Falls json,
   ist der Migrations-Track vorerst No-op (F2 latent); falls pg, braucht es das
   Ledger-Backfill fuer 001. **Faktenlage zur Prod-DB klaeren.**
3. **`enforce_admins` true oder false?** PR-Pflicht auch fuer den Owner (sauber) vs.
   Admin-Direkt-Push mit CI-Lauf (pragmatisch). Beeinflusst, ob `DEPLOY.command` auf
   Feature-Branch-Workflow umgestellt werden muss.
4. **Coverage-Startschwelle:** ersten CI-Lauf ohne Schwelle zum Kalibrieren? Empfehlung: ja,
   dann `gemessen − 5%`.
5. **Auto-Rollback gewuenscht?** Empfehlung: nein (Forward-Fix + manuelles `.down`-Runbook).
6. **`MIGRATE_ON_BOOT`-Bruecke akzeptiert** (Migration auf Free weiter im Boot, ueber Ledger
   harmlos) — oder Boot von Tag 1 hart verify-only (dann MUSS A6/Plan-Upgrade zuerst)?
7. **`migrations/`-Ort:** Repo-Root (Vorschlag) vs. `src/db/migrations/`.

---

## 8. Abhaengigkeiten zu anderen Tasks

- **T-P0-1** (Datenhaltung fail-closed + Backups, Managed Postgres, bezahlter Plan) — **hart
  vorausgesetzt** fuer A6 (preDeploy). Ohne T-P0-1 ist Track A nur bis A5/A7 lieferbar.
- **T-P1-9** (CI-Tiefe: ESLint, CodeQL) — Track B (B2/B3) ist die P0-Teilmenge davon; ESLint/
  CodeQL bleiben P1, nicht in dieser Phase.
- Track B ist ansonsten **vollstaendig eigenstaendig** und ohne Plan-Abhaengigkeit lieferbar.

---

### Quellen (externe Fakten, verifiziert)

- Render — Pre-Deploy Command (paid-only, Exit-Gate-Semantik):
  <https://render.com/docs/deploys#predeploy-command>, <https://render.com/docs/free>
- Node.js — Coverage-Threshold-Flags brechen mit exit 1:
  <https://nodejs.org/learn/test-runner/collecting-code-coverage>,
  <https://nodejs.org/api/test.html>
