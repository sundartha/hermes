# P0-1: Datenhaltung fail-closed + Backups — Strategie

> Reine Strategie-/Analyse-Phase (kein Code). Erarbeitet von einem 3-Strang-Agent-Team
> (Boot-Refusal-Design, Render-Postgres-Recherche, Ops/RTO-RPO/Migration), synthetisiert
> + gegen den realen Code verifiziert. Stand 2026-06-19. Konvention: Deutsch ohne Umlaute.

## 0. Kontext & Scope

**Problem (aus Projekt-Audit, `docs/strategy/project-audit-2026-06-19.md`):** Der Default
`STORE_BACKEND=json` schreibt nach `data/store.json` auf Renders **fluechtigem** Free-FS.
`render.yaml` hat weder `databases:` noch `disk:`. Jeder Deploy / Neustart / Spin-down
loescht **alle** Calls, Summaries, Action Items, Budget-/Usage-Zaehler, Audit-Spuren,
Profile, Kalender, Tenant-Budgets und Usage-Events.

**Ziel dieser Phase:** Fail-closed gegen genau diesen Footgun (Boot-Refusal bei
`RENDER_EXTERNAL_URL` + json), Managed Postgres (EU/DE) mit Backups+PITR als
Produktions-Pflicht, dazu RTO/RPO + Restore-Runbook.

**Wichtiger Live-Befund (Nebenlaeufigkeit):** Der Worktree wird **parallel bearbeitet**.
Waehrend dieser Analyse wuchs `src/config.js` von 261 auf 294 Zeilen und erhielt eine
neue, exportierte Funktion `productionFootguns()` (Feature **T-P0-5 / H1**, uncommitted)
samt der zwei neuen Testdateien `test/config-prod-footguns.test.js` und
`test/boot-prod-footguns.test.js`. **Das veraendert den AC1-Home** (Abschnitt 4.1) und
erzeugt eine **Sequenz-Abhaengigkeit zu T-P0-5** (Abschnitt 6). Vor der AC1-Implementierung
unbedingt den dann aktuellen Stand von `config.js` re-lesen.

---

## 1. Verifizierter Code-Befund

| Fakt | Fundstelle | Bedeutung fuer die Phase |
|---|---|---|
| `storeBackend` Default `"json"` | `src/config.js:87` | Der Footgun-Default; render.yaml setzt zusaetzlich `STORE_BACKEND value:"json"` (`render.yaml:109-110`). |
| **`productionFootguns(cfg, isProduction)`** — reine, exportierte Funktion; im Hosting (`RENDER_EXTERNAL_URL`) ist jeder Treffer **fatal** | `src/config.js:227-239` | **Kanonischer AC1-Home.** Schon in `assertConfig()` verdrahtet (`config.js:266`: `fatal = configFatalErrors().concat(productionFootguns(...))`). |
| Backend-Wahl: `if (config.storeBackend === "pg") {pg} else {json}` | `src/store.js:54-66` | json-Backend wird benutzt fuer **alles ausser exakt `"pg"`** -> AC1-Check muss `!== "pg"` sein, nicht `=== "json"` (sonst rutscht ein vertippter Wert wie `"postgres"` still ins json-Backend). |
| Boot-Reihenfolge: `store.load()` (Z.1066) -> `assertConfig()` (Z.1078) -> `!ok` => `process.exit(1)` (Z.1085) -> `app.listen` | `src/server.js:1066-1087` | Der Exit-Pfad existiert bereits; AC1 ist rein additiv in `config.js`, **server.js bleibt unberuehrt**. |
| **Migration laeuft beim Modul-Import**: `store.js` top-level-await -> `createPgBackend()` -> `store.init()` -> `migrate()` (`applySchema` + `seedDefaults`) | `src/store.js:13-44`, `src/store/pg.js:50-57`, `src/db/migrate.js:85-88` | Migration-im-Boot ist der Konflikt mit **T-P0-2** (Deploy-Gate); Abschnitt 5.3. |
| `applySchema` = `db.exec(schema.sql)` im Simple-Query-Modus; durchgaengig `IF NOT EXISTS` / `ON CONFLICT DO NOTHING`. **Kein** `pg_advisory_lock`, **keine** Transaktionsklammer, **keine** `schema_migrations`-Tabelle | `src/db/migrate.js:19-22`, `src/db/schema.sql` | Idempotent, aber **nicht nebenlaeufigkeits-sicher** (Abschnitt 5.3, R1). |
| **Demo-Kalender-INSERT ohne `ON CONFLICT`** (Check-then-Insert ohne Lock) | `src/db/migrate.js:69-81` | Seed-Race -> unique-violation -> Boot-Crash (`store.js:62` exit 1). Bestaetigt R2. |
| **F5 (`assertNoBypassRls`) deckt nur den Portal-Pool**, nicht den Owner-/Migrations-Pool aus `createPgBackend()` | `src/portal-pool.js:16,58` vs. `src/store.js:13-44` | = Audit-Luecke **M3 / T-P1-2**. Heute migriert evtl. eine ungepruefte (Superuser-)Rolle. Relevant fuer Restore (Rolle pruefen) + Phasen-Ordnung. |
| json-Default ist CI-/Dev-sicher: `helpers.js:58` `STORE_BACKEND:"json"`, `helpers.js:92` `RENDER_EXTERNAL_URL:""` (falsy -> Guard inaktiv); `.github/workflows/ci.yml:20` `npm test` ohne `STORE_BACKEND` | `test/helpers.js:58,92`, `.github/workflows/ci.yml` | **AC5 ist strukturell schon erfuellt**; pg wird in CI ueber **pglite** getestet (~Dutzend `store-pg*.test.js`). |
| render.yaml-Tests existieren und assertieren auf den Blueprint-Inhalt | `test/render-region.test.js`, `test/directive-render.test.js`, `test/telnyx-render.test.js`, `test/telnyx-stream-render.test.js` | AC2/AC6 (render.yaml-Aenderung) **muss diese Tests mitziehen** — sonst Rotbruch. |

---

## 2. Zielbild

1. **Produktion kann nicht versehentlich auf json laufen.** `RENDER_EXTERNAL_URL` gesetzt
   + Backend != `pg` => FATAL, exit 1, secret-freie Diagnose.
2. **Managed Postgres EU/DE mit Backups + PITR** ist die Produktions-Persistenz, im
   `render.yaml`-Blueprint deklariert (`databases:` + `fromDatabase`-Verdrahtung).
3. **Deploy bricht ab, wenn die DB nicht erreichbar ist** (`preDeployCommand` als Gate).
4. **RTO/RPO sind definiert**, ein **Restore-Runbook** existiert und wird per Drill getestet.
5. **json bleibt der Dev-/CI-Default** (kein DB-Zwang lokal), Backend-Paritaet ueber
   geteilte `state-ops.js` + pglite-Tests abgesichert.

---

## 3. Akzeptanzkriterien-Mapping

| AC | Kriterium | Loesungskern | Phase |
|---|---|---|---|
| **AC1** | Boot-Refusal bei `RENDER_EXTERNAL_URL` + `STORE_BACKEND=json`, FATAL, exit 1 | 1 Zeile in `productionFootguns()` (`!== "pg"`) + Tests | **A** |
| **AC2** | `render.yaml` mit `databases:` Postgres + Backup-Plan | `databases:`-Block (`basic-1gb`, frankfurt) + `STORE_BACKEND=pg` + `DATABASE_URL fromDatabase` + Web-Plan paid | **B** |
| **AC3** | RTO/RPO definiert + dokumentiert | RPO-Ziel 5 min (PITR) / Minimum 24 h; RTO 60 min (a/b), 8 h (Region) | **F** |
| **AC4** | Restore-Prozedur dokumentiert | `docs/RUNBOOK-RESTORE.md` (Managed-Backup, PITR, Drill, Notfall-Reimport) | **F** |
| **AC5** | Tests gruen; json-Store fuer Dev/CI erhalten | Strukturell schon erfuellt; als Konvention festschreiben | **A,H** |
| **AC6** | `preDeployCommand` prueft DB-Erreichbarkeit vor Deploy | `scripts/migrate.js` (DB-Check + Migration + exit-code) als `preDeployCommand` | **C(+D)** |

---

## 4. Architektur-Entscheidungen

### 4.1 AC1 — Boot-Refusal (Home: `productionFootguns()`)

**Entscheidung:** AC1 ist der **fuenfte Produktions-Footgun**, additiv in `productionFootguns()`
(`src/config.js:227`). Das ist sauberer als ein generischer `missing.push` in `assertConfig()`
(die urspruengliche Agent-Empfehlung, die auf dem Stand *vor* T-P0-5 fusste): die Funktion ist
rein, bekommt `isProduction` injiziert, ist ohne Spawn unit-testbar und bereits in den
Fatal-Pfad verdrahtet.

**Skizze (eine Zeile in `productionFootguns`):**

```js
// in productionFootguns(cfg, isProduction), nach den bestehenden Checks:
if (cfg.storeBackend !== "pg")
  errors.push(
    "STORE_BACKEND ist nicht 'pg' - der json-Store liegt auf Renders fluechtigem " +
    "Dateisystem (Datenverlust bei jedem Deploy/Neustart). Im Hosting STORE_BACKEND=pg " +
    "+ DATABASE_URL Pflicht."
  );
```

**Warum `!== "pg"` und nicht `=== "json"`:** `store.js:54` waehlt das pg-Backend **nur** bei
exakt `"pg"`; jeder andere Wert (auch ein Tippfehler `"postgres"`) faellt ins json-Backend.
Der Guard muss exakt diese Bedingung spiegeln, sonst entsteht genau im Fehlerfall ein Leck.

**Konsequenz fuer Bestandstests (PFLICHT):** Das Fixture `SAFE_PROD` in
`test/config-prod-footguns.test.js` (T-P0-5) traegt heute **kein** `storeBackend`. Mit
`!== "pg"` wuerde `undefined !== "pg"` den Footgun ausloesen und **alle T-P0-5-Tests brechen**.
Daher: `SAFE_PROD` um `storeBackend: "pg"` ergaenzen. Das ist die einzige nicht-offensichtliche
Bruchstelle und gehoert in denselben Commit.

**Produktions-Signal:** `RENDER_EXTERNAL_URL` (truthy) bleibt das Signal — konsistent mit
`config.js:227,265` und `config.js:97`. `NODE_ENV` ist **kein** verlaesslicher Render-Indikator
(nirgends gesetzt) und wird **nicht** verwendet. Optionale Haertung (Render-PR-Previews bewusst
mit json) via `IS_PULLREQUEST` wird **nicht** umgesetzt (fail-closed gewollt), nur hier vermerkt.

**Beweis "bricht Dev/CI nicht":** `helpers.js:92` setzt `RENDER_EXTERNAL_URL:""` (falsy) ->
Guard in keinem Spawn-Test aktiv; lokal ist die Var nie gesetzt; die In-Process-Unit-Tests
setzen sie nicht. **Kein Bestandstest** kombiniert truthy `RENDER_EXTERNAL_URL` mit json — ausser
nach der SAFE_PROD-Ergaenzung, die wir bewusst auf `pg` ziehen.

### 4.2 AC2 — `render.yaml` Managed Postgres (EU/DE)

**Entscheidung:** `databases:`-Block mit dem **kleinsten Plan, der Backups + PITR kann**:
`basic-1gb` (~20 USD/Monat), Region `frankfurt` (EU/DE, identisch zum Web-Service — wird **nicht**
automatisch geerbt). DB-Anbindung ueber `fromDatabase`.

```yaml
databases:
  - name: vodafone-agent-db
    plan: basic-1gb            # kleinster Plan mit PITR + logischen Backups
    region: frankfurt          # EU/DE-Datenresidenz (separat zum Web-Service setzen)
    databaseName: vodafone_agent
    user: agent_user
    postgresMajorVersion: "16"
    diskSizeGB: 10
    ipAllowList: []            # leer = nur Render-internes Netz (kein Public Internet)
```

Im `services:`-Block:

```yaml
      - key: STORE_BACKEND
        value: "pg"            # ersetzt das heutige "json"
      - key: DATABASE_URL
        fromDatabase:
          name: vodafone-agent-db
          property: connectionString
```

**Plan-Zwang Web-Service:** `preDeployCommand` (AC6) gibt es **nur auf bezahlten** Instanz-Typen.
Sobald AC6 implementiert wird, muss `plan: free` -> bezahlt (z.B. `starter`, ~7 USD/Monat;
**aktuellen Plannamen vor Commit im Dashboard verifizieren**, Render hat ihn historisch umbenannt).

**Free-Postgres ist disqualifiziert:** keine Backups, kein PITR, **laeuft nach ~30 Tagen ab**
(dann 14 Tage Grace, danach permanente Loeschung). Free erfuellt AC2 nicht.

**Datenresidenz-Caveat:** `region: frankfurt` ist technische Lokalisierung, **keine** Rechtsgarantie;
Render nennt keine DSGVO-/SOC2-Zertifizierung oeffentlich. Falls regulatorisch noetig: Render-DPA
anfordern (offener Punkt, Abschnitt 8).

### 4.3 AC6 — `preDeployCommand` als DB-Gate

**Render-Semantik (belegt):** `preDeployCommand` laeuft **nach** Build, **vor** Go-Live der neuen
Instanz, auf einer separaten temporaeren Instanz; **non-zero exit bricht den Deploy ab**, der alte
Service laeuft weiter; Timeout 30 min; `DATABASE_URL` (via `fromDatabase`) ist zugaenglich
(Community-bestaetigt; beim ersten Deploy `console.log(!!process.env.DATABASE_URL)` verifizieren).

**Entscheidung:** Ein **Node-Script** `scripts/migrate.js` (statt inline-psql) erfuellt AC6 **und**
loest gleichzeitig die Migrations-Entkopplung (4.4 / 5.3): es baut den Pool, prueft **F5**
(`assertNoBypassRls`, jetzt auch fuer den Migrations-Pool!), nimmt `pg_advisory_lock`, ruft
`migrate()`, terminiert mit exit 0/1. Bei DB-unerreichbar oder Migrationsfehler -> exit 1 -> Render
deployt nicht. Damit ist AC6 = DB-Erreichbarkeits-Gate **und** der "single point of migration".

```yaml
      preDeployCommand: node scripts/migrate.js
```

### 4.4 AC3 — RTO/RPO

**Annahmen:** kleines Datenvolumen (Single-/Few-Tenant) -> Restore ist provider-dominiert, nicht
datenmengen-dominiert; Telefonie ist kritischer Pfad (DB-Verlust => Prozess-Exit, `store.js:46-63`);
wertvollste Daten sind **Audit-Spuren** + **usage_event** (append-only Billing-Ledger).

| Szenario | RPO (taegl. Backup) | RPO (PITR) | RTO (Ziel) | Bemerkung |
|---|---|---|---|---|
| a) versehentl. DELETE / Daten-Korruption (App-Bug) | bis 24 h | **< 5 min** | 30-60 min | **Eigentlicher PITR-Business-Case** (Billing/Audit). |
| b) DB-Instanz-Verlust | bis 24 h | < 5 min | 30-90 min | Neue Instanz + neue `DATABASE_URL` + Redeploy. |
| c) Region-/Provider-Ausfall | bis 24 h (off-region-Export) | ~24 h (WAL meist regional) | **4-8 h** | PITR hilft hier NICHT allein -> off-region-Export noetig. |

**Zielvorgabe:**
- **RPO-Ziel = 5 min** (verlangt PITR) — **Pflicht vor `PAYMENT_ENABLED=true` und echtem Multi-Tenant**.
- **RPO-Minimum (Uebergang) = 24 h** (taegliches Managed-Backup) — akzeptabel im Owner-Prototyp.
- **RTO-Ziel = 60 min** (a/b), **= 8 h** deklariertes Maximum (c).
- **Zusatzkontrolle gegen c:** woechentlicher, verschluesselter `pg_dump`-Export in eine zweite
  Region/Objektspeicher (deckt auch "Render-Account/Provider weg" ab, was PITR nicht abdeckt).

**PITR-Retention haengt am Workspace-Plan**, nicht am DB-Plan: Hobby ~3 Tage, Pro ~7 Tage
(zwei Render-Quellen leicht widerspruechlich -> vor Commit im Dashboard verifizieren, Abschnitt 8).

### 4.5 AC4 — Restore-Runbook

Neue Datei `docs/RUNBOOK-RESTORE.md` (neben `docs/RUNBOOK-OPERATOR.md`, gleiche Konvention).
Reine Doku. Kerninhalte (Details im Runbook):

1. **Restore aus Managed-Backup (b/c):** Dashboard -> Postgres -> Backups -> juengstes Backup vor
   Schaden -> Restore (legt **neue** Instanz an, Original NICHT ueberschreiben -> Forensik).
   Internal `DATABASE_URL` kopieren. **Rolle pruefen:** wiederhergestellte Instanz muss die
   **non-superuser/NOBYPASSRLS-App-Rolle** haben (sonst F5/M3 fail-closed). Ggf. App-Rolle neu
   anlegen + `DATABASE_URL` auf deren Credentials.
2. **Restore via PITR (a):** Zielzeitpunkt **unmittelbar vor** dem schaedlichen Statement
   (`audit_log.at` als Quelle, da append-only/ohne RLS) -> neue Instanz -> weiter wie 1.
3. **Web-Service umhaengen:** `DATABASE_URL` auf neue Instanz, `STORE_BACKEND=pg` sicherstellen,
   **manuellen Redeploy** (Boot/preDeploy-Migration laeuft idempotent erneut). Repo-Split beachten
   (Render deployt `upstream`, `RUNBOOK-OPERATOR.md` Abschnitt 0).
4. **Verifikation VOR Produktiv-Schaltung:** erst lesen, dann Traffic. `/healthz` 200 ->
   Boot-Banner-Commit pruefen -> Probe-Reads (`/api/state`, `/api/calls`) -> Row-Counts
   (`call`, `usage_event`, `audit_log`, `number`) gegen Referenz; `MAX(audit_log.at) <=`
   PITR-Zielzeitpunkt. Erst dann Inbound/Nummer wieder freigeben.
5. **Restore-Drill (quartalsweise):** Restore auf **Wegwerf-Instanz**, Prod-`DATABASE_URL`
   NICHT umstellen; Smoke-Checks gegen die Restore-URL; **Ist-RTO/RPO mit Stoppuhr messen** und
   gegen die Zielwerte (4.4) spiegeln; Ergebnis ins Runbook.
6. **Notfall-Reimport (nur `store.json` vorhanden):** Realitaetscheck — Free-FS ist fluechtig,
   ein produktiver `store.json` existiert dort i.d.R. gar nicht; daher Notnagel fuer lokale/Demo-
   Bestaende, kein Prod-Backup-Ersatz. Verlangt das Import-Script (Phase G).

### 4.6 AC5 — json fuer Dev/CI erhalten

**Strukturell schon erfuellt** (Abschnitt 1): json ist Default, CI laeuft ohne `STORE_BACKEND`,
pg wird ueber **pglite** mitgetestet. Massnahme = **Konvention festschreiben** (Phase H):
jede neue Store-Funktion braucht einen json-**und**-pg-Paritaetstest (Vorbild
`test/telnyx-seed.test.js`). **Bekannte Restluecke dokumentieren:** pglite reproduziert
**pgBouncer Transaction-Pooling nicht** -> das manuelle `docs/RELEASE-GATE-killer-test.md`
bleibt das ergaenzende Gate (CI deckt Logik, nicht Pooling-Semantik).

---

## 5. Pre-Mortem (die vier genannten Risiken)

### 5.1 "Fataler Boot bricht lokale Entwicklung"
**Entschaerft by design:** Guard greift nur bei truthy `RENDER_EXTERNAL_URL`. Beweis in 4.1.
Einzige Bestands-Bruchstelle = `SAFE_PROD`-Fixture -> bewusst auf `storeBackend:"pg"` ziehen.

### 5.2 "Postgres-Pflicht erhoeht Cold-Start-Latenz (Free -> bezahlt)"
Free-Web-Service spinnt nach 15 min Inaktivitaet herunter (~1 min Spin-up). Eine DB-Verbindung
beim Boot ist dagegen marginal (~50-200 ms Pool-Aufbau intern). **Zwei Treiber zwingen ohnehin
zum bezahlten Web-Plan:** (1) `preDeployCommand` (AC6) nur auf paid; (2) Wunsch nach Cold-Start-
Freiheit. Mitigationen: `plan: starter` (eliminiert Cold-Start), `/healthz` (vorhanden) + externer
Keep-Alive-Ping, Lazy-DB-Connect. **Mindestkosten** (Web starter + Postgres basic-1gb): ~27 USD/Monat
(~25 EUR); mit 7-Tage-PITR (Workspace Pro) ~52 USD (~48 EUR).

### 5.3 "Migration laeuft schon im Boot — Konflikt mit T-P0-2 (Deploy-Gate)"
**Heute:** jede Instanz migriert beim Import; unkritisch nur weil Render Free = **1 Instanz**.
Bei Deploy-Gate/Multi-Instanz brechen die Annahmen:
- **R1 (High):** `applySchema` ohne advisory lock/Transaktion; `DROP POLICY IF EXISTS x` +
  `CREATE POLICY x` ist **nicht atomar** -> bei parallelen Migrationen RLS-Loch-Fenster oder
  `CREATE POLICY`-Fehler.
- **R2 (High):** Demo-Kalender-INSERT **ohne `ON CONFLICT`** (`migrate.js:69-81`) -> Seed-Race ->
  unique-violation -> Boot-Crash der zweiten Instanz (exit 1).

**Empfehlung (sauber):** Migration **aus dem Boot herausloesen** in `scripts/migrate.js`, via
`preDeployCommand` aufgerufen (= Schnittstelle zu T-P0-2): `init()` macht dann nur noch
`setTenant` + `hydrate` (Read), kein DDL. **Vertrag:** "Schema/Seed existieren, wenn `init()`
laeuft; sonst fail-closed mit klarer Meldung."

**Sofort-Versicherung (falls Multi-Instanz vor T-P0-2 kommt, Phase E):** `pg_advisory_lock` um
`migrate()` im Boot + Demo-Kalender `ON CONFLICT (id) DO NOTHING` — beseitigt R1/R2 mit minimalem
Eingriff, unabhaengig von der Entkopplung.

**Nicht-offensichtliche Bruchstelle der Entkopplung:** `init()` migriert heute *implizit* fuer die
pglite-Tests (`test/pg-helpers.js:16`). Wird `migrate()` aus `init()` entfernt, muss
`makePgTestStore` vor `store.init()` explizit `migrate(db, OWNER_TENANT_ID)` rufen — sonst sind
~Dutzend pg-Tests rot. Gehoert in **denselben** Commit wie die Entkopplung.

**Reihenfolge zu T-P1-2 (M3):** Die Migration soll unter der gepruften NOBYPASSRLS-Rolle laufen.
`scripts/migrate.js` ruft daher `assertNoBypassRls` selbst (heute nur am Portal-Pool). Ideal: M3
(F5 auch fuer Owner/Migrations-Pool) vor/zusammen mit Phase D.

### 5.4 "Existierende Daten im JSON-Store bei Migration zu Postgres"
Live laeuft json auf **fluechtigem** Free-FS -> mit hoher Sicherheit **kein** dauerhafter,
geschaeftskritischer Bestand; `seedDefaults` reproduziert den Owner-Grundzustand byte-nah zum
frischen json-State. **Cut-over "leer starten" ist akzeptabel** (R10 Low). **Aber** ein
**einmaliges Import-Script** `scripts/import-json-to-pg.js` (Phase G) trotzdem bauen — als
Notfall-Reimport + Drill-Werkzeug. Eleganz: json- und pg-Spiegel teilen den `state-ops.js`-Shape,
also `state = JSON.parse(store.json)` -> json-Migrationen -> `migrate(client)` -> **`flush(client, state)`
wiederverwenden** (Full-Upsert unter RLS-GUC). Verlangt schmale Exports von `flush`/`hydrate` aus
`store/pg.js` (heute modul-intern).

---

## 6. Phasen-Schnitt

Legende: **[C]** Code/Script · **[D]** reine Doku · **||** parallelisierbar.
Jede Phase ist klein und einzeln testbar.

| Phase | Inhalt | Art | Betroffene Dateien | Parallel | Abhaengigkeit |
|---|---|---|---|---|---|
| **A — AC1 Boot-Refusal** | 1 Zeile in `productionFootguns()` (`!== "pg"`); `SAFE_PROD`-Fixture um `storeBackend:"pg"`; neue Unit-Tests (prod+json->fatal, prod+pg->ok, kein-RENDER+json->ok); Spawn-Test exit 1 | **[C]** | `src/config.js`, `test/config-prod-footguns.test.js`, `test/boot-prod-footguns.test.js` | **|| zu B,F,G,H**; **NICHT** || zu **T-P0-5** (gleiche Dateien) | **T-P0-5** (productionFootguns existiert; derzeit uncommitted!) |
| **B — AC2 render.yaml Postgres** | `databases:`-Block; `STORE_BACKEND`->`pg`; `DATABASE_URL fromDatabase`; Web-`plan` free->paid | **[C]** | `render.yaml`, `test/render-region.test.js` u. a. render-yaml-Tests **mitziehen** | || zu A,D,F,G,H | keine (aber Kosten-Freigabe, Abschnitt 8) |
| **C — AC6 preDeploy DB-Gate** | `preDeployCommand: node scripts/migrate.js` | **[C]** | `render.yaml`, evtl. render-yaml-Tests | nein | **D** (braucht das Standalone-Script) + B |
| **D — Migrations-Entkopplung** (Kern, = O3, Schnittstelle T-P0-2) | `migrate()` aus `init()` raus; `scripts/migrate.js` (F5 + advisory_lock + exit-code); `pg-helpers.js`/pg-Tests auf explizites `migrate()` umstellen | **[C]** | `src/store/pg.js`, `src/db/migrate.js`, neu `scripts/migrate.js`, `test/pg-helpers.js`, mehrere `store-pg*.test.js` | **nein** (Boot-Pfad breit; solo) | idealerweise **T-P1-2 / M3** davor |
| **E — Sofort-Haertung** (Alternative zu D, falls Multi-Instanz frueher) | `pg_advisory_lock` um Boot-`migrate()`; Demo-Kalender `ON CONFLICT` | **[C]** | `src/db/migrate.js`, `src/store/pg.js` | || (klein, isoliert) | keine |
| **F — RTO/RPO + Restore-Runbook** | Zielwerte (4.4) + Runbook (4.5) + Drill | **[D]** | neu `docs/RUNBOOK-RESTORE.md`; Querverweis `STATUS-OFFENE-PHASEN.md` Abschnitt 3 | || zu allem | inhaltlich auf Phase G (Reimport) verweisend |
| **G — Import-Script json->pg** | `scripts/import-json-to-pg.js`; `flush`/`hydrate`-Export | **[C]** | neu `scripts/import-json-to-pg.js`, `src/store/pg.js` (Export) | || | unabhaengig von D/C |
| **H — Backend-Paritaet-Konvention** | json-vs-pg-Paritaetstest als Pflicht; pglite!=pgBouncer + Killer-Test-Gate festhalten | **[D]** | `docs/` (Test-Konvention), Verweis `docs/RELEASE-GATE-killer-test.md` | || | keine |

**Kritischer Pfad:** **D -> C** (einzige harte Sequenz). **D** ist der riskanteste Schritt
(Boot-Pfad + Test-Umstellung) -> solo, `pg-helpers.js`-Fix im selben Commit. **A** muss nach/mit
**T-P0-5** laufen (Datei-Kollision). Alles uebrige (B, E, F, G, H) ist parallelisierbar.

**Empfohlene Reihenfolge:** (1) A sobald T-P0-5 gelandet ist (Sicherheitsnetz zuerst); parallel
B + F + G + H. (2) D solo. (3) C nach D. E nur als Bridge, falls D sich verzoegert und vorher
Multi-Instanz droht.

---

## 7. Risiko-Register

| ID | Risiko | Severity | Fundstelle | Mitigation / Phase |
|---|---|---|---|---|
| R1 | Boot-Migration ohne advisory lock/Transaktion; `DROP`+`CREATE POLICY` nicht atomar -> RLS-Loch/Crash bei Multi-Instanz | **High** | `migrate.js:19-22`, `schema.sql`, `store/pg.js:50-57` | D (Entkopplung) oder E (advisory_lock) |
| R2 | Demo-Kalender-INSERT ohne `ON CONFLICT` -> Boot-Crash bei Seed-Race | **High** | `migrate.js:69-81` | D/E (`ON CONFLICT (id) DO NOTHING`) |
| R3 | Owner-/Migrations-Pool prueft F5 nicht (nur Portal) -> Migration evtl. unter Superuser, FORCE-RLS wirkungslos (= M3/T-P1-2) | **High** | `store.js:13-44` vs. `portal-pool.js:16,58` | T-P1-2 vor/mit D; `scripts/migrate.js` ruft F5 |
| R4 | Kein Backup/Restore-Runbook, keine RTO/RPO -> kein Wiederherstellungspfad bei DB-Verlust | **High** (Ops) | `docs/` (Fehlen) | F |
| R5 | Kein Migrations-Versioning/Rollback (`schema_migrations` fehlt) | **Medium** | `db/` (Fehlen), Audit F2 | spaeter (out of scope; in F notieren) |
| R6 | PITR fehlt im Free-/Starter-Tier -> RPO bis 24 h | **Medium** (High ab Payment) | `render.yaml plan` | B (`basic-1gb`) + Workspace-Plan-Entscheidung |
| R7 | Region-Ausfall nicht abgedeckt ohne off-region-Export | **Medium** | `render.yaml region` | F (woechentl. `pg_dump`-Export) |
| R8 | Test-Bruch beim Entkoppeln: `pg-helpers.js` + ~Dutzend pg-Tests, wenn `migrate()` aus `init()` faellt | **Medium** | `pg-helpers.js:16`, `store/pg.js:53` | D (Fix im selben Commit) |
| R9 | pglite != pgBouncer: CI gruen garantiert keine Pooling-Korrektheit | **Medium** | `RELEASE-GATE-killer-test.md`, STATUS 1e | H (Konvention + manuelles Gate) |
| R10 | json->pg-Cut-over verliert ephemeren json-Bestand | **Low** | `json.js:1-4`, `render.yaml` | G (Import-Script als Notnagel) |
| R11 | **Nebenlaeufige Worktree-Bearbeitung** (T-P0-5 in `config.js`/Tests uncommitted) -> AC1-Merge-Konflikt | **Medium** (Prozess) | Live-Befund Abschnitt 0 | A nach T-P0-5 sequenzieren; config.js vor Implementierung re-lesen |

---

## 8. Offene Betreiber-Entscheidungen (nicht autonom — Geld/Account)

1. **Kosten-Freigabe Postgres-Pflicht:** ~27 USD/Monat (Web starter + Postgres basic-1gb) bzw.
   ~52 USD mit 7-Tage-PITR (Workspace Pro). Free-Web bleibt nur ohne AC6 moeglich.
2. **PITR-Tier:** 3 Tage (Hobby) vs. 7 Tage (Pro). Vor `PAYMENT_ENABLED` mind. PITR Pflicht
   (Billing/Audit). Quellenlage zur Retention leicht widerspruechlich -> im Dashboard verifizieren.
3. **Aktueller paid-Web-Planname** (`starter`/`basic`?) und **`postgresMajorVersion`** ("16"/"17")
   vor Commit im Render-Dashboard/Blueprint-Validator bestaetigen.
4. **DSGVO/DPA:** `region: frankfurt` ist technisch, keine Rechtsgarantie -> falls noetig Render-DPA.
5. **Bestehende Free-DB?** Falls bereits eine Free-Postgres existiert, ist Plan/Region per Blueprint
   nicht aenderbar -> manuelle Dashboard-Migration noetig (vor B pruefen).
6. **Env-Var im preDeployCommand:** beim ersten Deploy `console.log(!!process.env.DATABASE_URL)`
   verifizieren (Render-Doku nicht explizit).

---

## 9. Querverweise

- `docs/strategy/project-audit-2026-06-19.md` — Ausgangs-Audit.
- `STATUS-OFFENE-PHASEN.md` Abschnitt 1e/3 — Betreiber-ToDo "Postgres prod: non-superuser/
  NOBYPASSRLS + pgBouncer (transaction mode), EU/DE"; `docs/RELEASE-GATE-killer-test.md`.
- **T-P0-2** (Deploy-Gate) — konsumiert `scripts/migrate.js` als preDeploy-Gate (Phase C/D).
- **T-P1-2 / M3** — F5 fuer Owner-/Migrations-Pool; Voraussetzung fuer sichere Migration (R3).
- **T-P0-5 / H1** — `productionFootguns()`; AC1 baut darauf auf (R11, Phase A).
- `docs/RUNBOOK-OPERATOR.md` — bestehendes Betriebs-Runbook (Repo-Split, Boot-Banner).

---

## 10. Zusammenfassung fuer den Boss

- **AC1** ist ein **Einzeiler** im bereits existierenden `productionFootguns()` (T-P0-5) plus ein
  Fixture-Fix — kleinste, sicherste Naht; server.js unberuehrt. **Sequenz-Abhaengigkeit zu T-P0-5**
  (gleiche Dateien, gerade uncommitted im Worktree).
- **AC2/AC6** sind `render.yaml` + ein `scripts/migrate.js`, das **zugleich** das DB-Gate (AC6) und
  den Single-Point-of-Migration (loest den T-P0-2-Konflikt) ist. Kostet Geld (paid plans) -> Freigabe.
- **AC3/AC4** sind reine Doku (`docs/RUNBOOK-RESTORE.md`) mit konkreten Zielwerten (RPO 5 min via PITR
  / RTO 60 min) und Drill.
- **AC5** ist strukturell schon erfuellt; nur als Konvention festschreiben.
- **Hoechste latente Gefahr:** die nicht-nebenlaeufigkeits-sichere Boot-Migration (R1/R2) — heute
  durch "1 Instanz" maskiert, bricht mit Deploy-Gate/Multi-Instanz. Phase D loest es sauber,
  Phase E ist die billige Sofort-Versicherung.
</content>
</invoke>
