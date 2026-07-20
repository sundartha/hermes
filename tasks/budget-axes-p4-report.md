# Budget-Achsen P4 — Spend-Monat-Achse additiv einfuehren (inert)

**Gate: PASS**
**finalBranch:** `phase/ba-p4-spend-month-axis-fix1`
**Basis:** `master` @ `b1675d9` (P1/P2a/P2b/P3 bereits gemergt — `platformSpendCapCents`, `isBookableCents`, `USAGE_CORRUPT_REASON` existieren bereits und werden wiederverwendet)
**headCommit (Impl):** `8a34937ba4a8add59f1ac6d331891018af3e5123`
**Typ:** additiv, strikt verhaltens-identisch — kein Gate liest die neue Achse. Der Flip auf die Achse ist P7.

---

## 1. Ziel der Phase

Neben dem bestehenden Lebenszeit-Geldzaehler (`costCents`, autoritativ seit P1) eine zweite, **periodische** Achse einfuehren: den Verbrauch im laufenden UTC-Kalendermonat (`spendMonthKey` + `spendMonthCostCents`). P4 baut ausschliesslich die Datenstruktur, die Ableitungs-/Vergleichslogik und die Persistenz — **kein Budget-Gate liest die neue Achse**. Das ist bewusst inert: der eigentliche Cap-Flip (Nutzung der Achse in einem Gate-Praedikat) ist P7 und nicht Teil dieser Phase.

---

## 2. Plan (gekuerzt)

### 2.1 Grounding gegen den echten Code (vor Planformulierung verifiziert)

| Stelle | Ist-Zustand | Konsequenz fuer P4 |
| --- | --- | --- |
| `store/defaults.js` `emptyUsage()` | `{inputTokens, outputTokens, costCents, costMicroCentsRem, calls}` | zwei Felder anhaengen |
| `state-ops.js` `trackUsage(s, tenantId, tokens, cfg)` | bereits 4 Argumente, ~25 Bestands-Call-Sites | 5. Argument `nowIso`, siehe Abweichung A1 |
| `state-ops.js` `addVoiceUsageCostCents(s, tenantId, costCents)` | 3 Argumente | + `nowIso` |
| `state-ops.js` Zeit-Freiheit | `voiceMinutesUsedSince`/`setSuspendedAtIfAbsent` bekommen die Uhr von beiden Fassaden injiziert (`new Date().toISOString()`) | exaktes Vorbild fuer die neue Uhr-Injektion |
| `json.js` `save()` | `stripEphemeral` entfernt nur `_finished` + `costMicroCentsRem` | neue Felder persistieren automatisch, keine Logik-Aenderung |
| `json.js` `bucketToCents()` | `{...emptyUsage(), ...bucket}` | Bestandsbuckets defaulten automatisch auf `null`/`0` |
| `pg.js` Hydrierung | `SELECT *` | keine Spaltenliste zu pflegen, nur `rowToUsage` |
| `pg.js` `flushUsage` | explizite Spaltenliste + `ON CONFLICT DO UPDATE` | beide Spalten ergaenzen |
| `api-read.js` `usageView` | explizite Feldauswahl | neue Felder koennen strukturell **nicht** nach `/api/state` lecken |
| `state-ops.js` `exportTenantData` | enthaelt `usage` nicht | kein DSGVO-Export-Drift |
| `db/migrate.js` | `ADD COLUMN IF NOT EXISTS` direkt unter `CREATE TABLE` | Free-Tier-tauglich, kein preDeploy noetig |

### 2.2 Das eine Schluessel-Praedikat

Statt eines "ist aelter"-Booleans liefert die Regel den **autoritativen Schluessel** (das Maximum aus gespeichertem und laufendem Monatsschluessel). Damit ist Monotonie **strukturell** (ein Maximum kann per Konstruktion nicht rueckwaerts wandern), nicht per Disziplin.

Drei neue reine Funktionen in `state-ops.js`, direkt oberhalb von `trackUsage`:

- **`spendMonthKeyOf(nowIso)`** — die eine Ableitungsstelle "ISO-Zeitpunkt -> `'YYYY-MM'`". Explizit `getUTCFullYear`/`getUTCMonth` statt `nowIso.slice(0,7)` (ein Offset-ISO wie `...+02:00` traegt im Praefix den lokalen, nicht den UTC-Monat und haette am Monatsersten den falschen Schluessel gestempelt). Unlesbarer Anker -> `null` (fail-closed: eine kaputte Uhr darf den Zaehler nicht zuruecksetzen).
- **`authoritativeSpendMonthKey(storedKey, nowKey)`** — der autoritative Schluessel = das Maximum. `'YYYY-MM'` ist lexikografisch = chronologisch sortierbar, also genuegt String-Vergleich. Vier Faelle: aelter -> `nowKey` (Rollover), gleich -> `nowKey`, **Zukunft -> `storedKey`** (Riegel gegen Clock-Skew/falsch gestellte Uhr: ein Schluessel in der Zukunft gewinnt und wird nicht auf den laufenden Monat zurueckgestempelt), kein `nowKey` (unlesbar) -> `storedKey` (fail-closed). Genau **zwei** Aufrufer: die Leseprojektion und der Schreiber — keine dritte Kopie der Vergleichsregel.
- **`spendMonthUsageCents(bucket, nowIso)`** (exportiert) — reine Leseprojektion, kein Reset-Job, kein Cron. Liefert `0`, sobald der gespeicherte Schluessel aelter ist als der autoritative; der persistierte Zaehler bleibt dabei unangetastet und wird erst vom naechsten Schreibvorgang neu gestartet.
- **`bookCents(usage, cents, nowIso)`** — die **eine** Cent-Schreibstelle beider Achsen (`costCents` UND `spendMonthCostCents`), aufgerufen von `trackUsage` und `addVoiceUsageCostCents`. Verhindert strukturell, dass eine kuenftige dritte Schreibstelle nur `costCents` erhoeht und die Monats-Achse blind macht. `costMicroCentsRem` wird hier bewusst **nicht** angefasst — der Sub-Cent-Rest bleibt lebenszeit-skaliert und ueberlebt jeden Monatswechsel (P1-Safety-Vorgabe: ein mit-zurueckgesetzter Rest waere ein wiederkehrender struktureller Verlust des KI-Kostenanteils).

### 2.3 Die Edits (Plan-Vorgabe)

1. `store/defaults.js` `emptyUsage()`: `spendMonthKey: null, spendMonthCostCents: 0` anhaengen.
2. `state-ops.js`: Modul-Kommentar-Ergaenzung (Abgrenzung gegen die Stripe-Abrechnungsperiode aus `billing/period.js` — "Periode" ist im Repo an Stripe vergeben, die neue Achse heisst konsequent "Spend-Monat"), die drei neuen Funktionen, `trackUsage`/`addVoiceUsageCostCents` rufen `bookCents` statt `costCents` direkt zu inkrementieren.
3. `json.js`/`pg.js`-Fassaden liefern die Uhr (`new Date().toISOString()`) an der IO-Grenze, Fassaden-Signaturen bleiben unveraendert.
4. `pg.js` `rowToUsage`/`flushUsage`: zwei neue Spalten hydrieren/persistieren. Bewusst **keine** `isBookableCents`-Heilkante auf die neue Spalte (BIGINT kann `'NaN'` nicht darstellen — eine Heilkante ohne moegliche Vergiftung waere toter Code).
5. `db/schema.sql`: `ALTER TABLE usage ADD COLUMN IF NOT EXISTS spend_month_key TEXT` / `spend_month_cost_cents BIGINT NOT NULL DEFAULT 0`, additiv und idempotent, plus Korrektur eines veralteten Bestandskommentars ("cost_eur als JS-Float" — seit P1 falsch, autoritativ ist `costCents`).
6. Ausdruecklich **nicht** angefasst: `store.js` (kein Re-Export — die Leseprojektion haette in P4 keinen Produktionsaufrufer und waere sonst tote Verdrahtung), `outbound-gates.js`, `api-read.js`, `config.js` (keine neue Env-Variable), `.env.example`, `render.yaml`, `PLAN-SECURITY.md`, jede Bestandstest-Datei.

### 2.4 Tests (Plan-Vorgabe)

Eine neue Datei, `node:test`, ohne Netz, Ops-Ebene + PGlite in einer Datei (Vorbild: `test/budget-nan-fail-closed.test.js`). 15 benannte Faelle (a)-(o): Grundfunktion, Monotonie (Uhr rueckwaerts), Zukunfts-Riegel, Mikro-Cent-Ueberlebensfaehigkeit ueber die Monatsgrenze (zweigeteilt in e1/e2), Persistenz-Rundlauf json + pg, Bestandszeilen-Hydrierung, **Inertheits-Beweis** (identische Rueckgabe aller fuenf Budget-Gate-Praedikate bei sonst identischem Zustand, einmal mit "vergifteter" Monats-Achse), Verhaltens-Identitaet ohne `nowIso` (Bestandssuite bleibt bit-identisch), unlesbarer Anker, Offset-ISO gegen die naive `slice(0,7)`-Falle, Migrations-Idempotenz (zweiter `applySchema()`-Lauf).

### 2.5 Deviations/Risiken, bereits im Plan antizipiert

- **A1** — `trackUsage` bekommt ein 5. Argument (`nowIso`), damit F1-Verstoss (>3 Argumente). Bewusst kein Options-Objekt, weil das ~25 Bestands-Call-Sites in Testdateien aendern und damit den Kernbeweis der Phase ("Bestandssuite ohne Test-Aenderung gruen") zerstoeren wuerde. Signatur-Refactor ist explizit auf P7 verschoben, wo die Funktionen ohnehin umgeschrieben werden.
- **A3** — Persistenz-Drift < 1 Cent pro Neustart, weil `spendMonthCostCents` persistiert wird, `costMicroCentsRem` aber ephemer bleibt. Dokumentiert in `schema.sql` und an der `stripEphemeral`-Liste.
- **A4** — ein Bucket mit `spendMonthKey === null` und Zaehler > 0 ist auf Ops-Ebene ohne `nowIso` konstruierbar (liest dann als `0`); in Produktion unerreichbar, da beide Fassaden immer eine Uhr liefern. Handoff an P7: dort muss die Gate-Aufloesung ueber den bestehenden P1-Riegel `isBookableCents` laufen, nicht daran vorbei.
- **DEPLOY-VORBEHALT (bindend im Plan):** die Phase enthaelt eine Schema-Migration. Die Produktiv-DB laeuft am 2026-07-24 ab — der Vorbehalt greift unabhaengig von dieser Phase; nicht deployen, bevor die DB abgeloest/verlaengert ist. Code und Tests decken beide Backends inkl. PGlite/in-process ab, damit die Migration ohne Zugriff auf die Produktiv-DB bewiesen ist.

### 2.6 Blast-Radius (Plan-Ziel)

5 Quelldateien (`defaults.js`, `state-ops.js`, `json.js` — nur Kommentare —, `pg.js`, `schema.sql`), 1 neue Testdatei, 0 geplante Bestandstest-Aenderungen, 0 neue Dependencies, 0 neue Env-Variablen, 0 beruehrte Gates/Routen/Fassaden-Signaturen.

---

## 3. Implementierung — Zusammenfassung

Exakt nach Plan umgesetzt. `spendMonthKey`/`spendMonthCostCents` additiv in `emptyUsage()`; drei neue reine Funktionen in `state-ops.js` (`spendMonthKeyOf`, `authoritativeSpendMonthKey` mit Monotonie-Riegel, `spendMonthUsageCents` als Leseprojektion) plus `bookCents` als die eine Schreibstelle beider Achsen. `trackUsage`/`addVoiceUsageCostCents` bekommen ein optionales, nachgestelltes `nowIso`-Argument und delegieren an `bookCents` statt `costCents` direkt zu inkrementieren. Die `json.js`/`pg.js`-Fassaden bleiben signatur-unveraendert und injizieren `new Date().toISOString()` an der IO-Grenze (Muster `setSuspendedAtIfAbsent`). In `pg.js` hydrieren/persistieren `rowToUsage`/`flushUsage` die beiden neuen Spalten; `schema.sql` bekommt die additive, idempotente Migration plus die geforderte Korrektur des veralteten "cost_eur als JS-Float"-Kommentars.

**Grep-Beweis (Verhaltens-Identitaet, strukturell):** `spendMonth`/`spend_month` kommt in `src/` ausschliesslich in `store/defaults.js`, `store/state-ops.js`, `store/json.js` (nur Kommentare), `store/pg.js` und `db/schema.sql` vor — null Treffer in `telephony/`, `routes/`, `config.js`, `billing/`, `mcp-tools.js`, `store.js`.

**16 neue Tests** (statt der im Plan skizzierten 15, weil (e) in e1/e2 aufgeteilt wurde) decken (a)-(o) vollstaendig ab: Monotonie, Zukunfts-Riegel, Mikro-Cent-Ueberlebensfaehigkeit ueber den Monatswechsel, Persistenz-Rundlauf ueber json und pg (PGlite), Migrations-Idempotenz (zweiter `applySchema()`-Lauf) und der direkte Inertheits-Beweis aller fuenf Budget-Gate-Praedikate.

**Mechanisches Testergebnis:** volle Suite **2587/0** gruen, `node --check` auf allen vier geaenderten `src/`-Dateien gruen. Ein einzelner transienter Fehler in `test/outbound-premature-close.test.js` trat unter Volllast einmalig auf; isoliert 3x hintereinander 8/8 gruen — als der bereits dokumentierte ~12%-Seed-vor-Boot-Race-Flake identifiziert, keine Regression (die Phase beruehrt keine Outbound-Call-/Spawn-Logik).

**Smoke-Test:** `STORE_BACKEND=json`, minimale Env, Boot erfolgreich, `GET /healthz` -> `{"ok":true}` HTTP 200. `store.json` nach Boot traegt den korrekten neuen Bucket-Shape: `{inputTokens:0, outputTokens:0, costCents:0, calls:0, spendMonthKey:null, spendMonthCostCents:0}` (`costMicroCentsRem` korrekt ephemer/abwesend). Sauberer Shutdown per SIGTERM.

### 3.1 Deviations gegenueber dem Plan

1. **A1 (im Plan bereits vorgesehen):** `trackUsage(s, tenantId, tokens, cfg, nowIso)` hat jetzt 5 Argumente (F1-Verstoss). Bewusst kein Options-Objekt — Begruendung s.o. Der Signatur-Refactor bleibt fuer P7 vorgemerkt.
2. **Plan-Abweichung, ungeplant:** Zwei Bestandstests (`test/store-pg.test.js`, `test/store-pg-tenant-budget.test.js`) mussten geaendert werden — sie vergleichen den Usage-Bucket gegen ein **hartcodiertes** Objekt-Literal statt gegen `emptyUsage()` (anders als der selbst-aktualisierende `store-json-migrate-shapes.test.js`, den der Plan als Referenz genannt hatte). Der Plan sagte "0 geaenderte Bestandstests" voraus, hatte aber nur eine der drei betroffenen Dateien verifiziert. Die Aenderung ist rein mechanisch (zwei Felder mit dem inerten Default ergaenzt, keine Assertion-Logik veraendert) und hat ein exaktes historisches Vorbild: ein frueherer Commit hat beim vorherigen additiven Feld (`costMicroCentsRem`) dieselben zwei Dateien auf dieselbe Weise angepasst.
3. **DEPLOY-VORBEHALT (bindend, wie im Plan gefordert):** die Phase enthaelt eine Schema-Migration (`ALTER TABLE usage ADD COLUMN IF NOT EXISTS spend_month_key/spend_month_cost_cents`). Die Produktiv-DB laeuft am 2026-07-24 ab — nicht deployen, bevor sie abgeloest/verlaengert ist. Code ist vollstaendig umgesetzt und getestet (beide Backends inkl. PGlite/in-process), die Migration ist damit ohne Produktiv-DB bewiesen.
4. Der eine transiente Suite-Ausreisser (s.o.) — dokumentierter Bestands-Flake, keine Regression.

### 3.2 Clean-Code-Selbstpruefung (Impl-Agent)

G5 (Duplizierung): die Vergleichsregel lebt einmal in `authoritativeSpendMonthKey`, genau zwei Aufrufer wenden sie an; die Cent-Schreiblogik ist auf `bookCents` gebuendelt. G25 (Magic Numbers): keine neuen unbenannten Zahlen in `src/`. G9/C5 (toter/auskommentierter Code): keiner. F1 (<=3 Argumente): `trackUsage` mit 5 Argumenten ist die dokumentierte, plan-sanktionierte Ausnahme A1. G30/G34: jede der drei neuen Funktionen tut genau eine Sache. N7: `bookCents` ist als mutierende Funktion benannt und dokumentiert. C2: der geforderte Fix des veralteten "cost_eur als JS-Float"-Satzes in `schema.sql` wurde umgesetzt.

---

## 4. Rot-vor-Fix-Beleg

Vor jedem Edit an `src/`: die Testdatei wurde zuerst geschrieben, dann `node --test test/usage-spend-month-axis.test.js` gegen den unveraenderten Code ausgefuehrt.

- **Ergebnis:** Exit-Code 1. Ausgabe: `SyntaxError: The requested module '../src/store/state-ops.js' does not provide an export named 'spendMonthUsageCents'` — der Import brach, weil weder `spendMonthUsageCents` noch die 5-Parameter-Signatur von `trackUsage` existierten.
- Bestaetigt via `node --test ... >/tmp/red-proof.txt 2>&1; echo EXIT_CODE=$?` -> `EXIT_CODE=1`, 1 failing test.
- **Nach der Implementierung:** alle 16 Faelle (a)-(o) gruen (`tests 16, pass 16, fail 0`).

**Unabhaengige Verifikation im Safety-Review** (eigene Testdatei, nicht die des Impl-Agenten): eine eigene Verhaltens-Datei (nicht nur Missing-Export-Pruefung) lief auf `master`/`b1675d9` -> **3/3 ROT** (`emptyUsage` ohne Achse, kein Monatsstempel, kein Monats-Neustart); dieselbe Datei auf dem Fix-Branch -> **3/3 GRUEN**. Zusaetzlich waren sowohl die Impl-Testdatei als auch die Reviewer-Datei auf `master` mit demselben "does not provide an export named spendMonthUsageCents"-Fehler rot.

---

## 5. Safety-Urteil (final)

**Verdikt: APPROVED.** Alle Pflichtfelder positiv: `testsPassIndependently`, `safetyGatesIntact`, `disclosureIntact`, `authFailClosedIntact`, `noSecretsLeaked`, `behaviorAsIntended`, `scopeRespected`, `redBeforeFixVerified` — alle `true`. **Keine Blocker.**

### 5.1 Eigene (unabhaengige) Testlaeufe des Reviewers

- **Volle Suite** auf `phase/ba-p4-spend-month-axis-fix1`: `npm test` -> 2587/2587, 0 fail, exit 0, ~77s. Beide Backends abgedeckt (PGlite-Tests laufen in-process, kein Netz); kein Rot, also kein Isolations-Gegencheck noetig.
- **12 eigene adversariale Tests** (Reviewer-Datei) -> 12/12 gruen: Monotonie bei Rueckwaerts-Uhr (Projektion bleibt bei altem Wert, Schluessel bleibt unveraendert), 10x aufeinanderfolgender Rueckwaerts-Schreibvorgang -> Zaehler waechst monoton, kein Reset; Zukunfts-Schluessel gegen aeltere Uhr -> liest den vollen Wert statt 0 und akkumuliert ohne Rueckwaerts-Stempel; Jahresgrenze (Dezember/Januar) korrekt in beide Richtungen; Mikro-Cent ueber die Monatsgrenze verteilt -> kein Cent verloren, kein Reset des Sub-Cent-Rests; Gate-Inertheit ueber 5 Praedikate x 5 `costCents`-Werte x 2 Achsen-Belegungen inkl. einer "vergifteten" Monats-Achse -> jede Entscheidung identisch; NaN/negative/Infinity-Werte werden verworfen und stempeln die Achse nicht; fehlender/unlesbarer Anker -> kein Phantom-Betrag, kein Reset; UTC-Ableitung gegen die naive `slice(0,7)`-Falle in beide Offset-Richtungen bewiesen.
- **5 eigene Rundlauf-Tests** -> 5/5 gruen: pg-Rundlauf ueber echte Re-Hydrierung, pg-Bestandszeile ohne Werte -> `null`/`0` ohne Fehler, dreifacher `applySchema()`-Lauf ohne Wurf und ohne Ueberschreiben des Bestands, json-Rundlauf ueber Datei, json-Altbucket ohne die neuen Felder -> `null`/`0`.
- Gezielter Re-Lauf der vier betroffenen Store-/Budget-Dateien auf sauberem Branch -> 66/66 gruen. Alle Temp-Dateien entfernt, sauberer Arbeitsbaum. `npm run lint` war in der Review-Umgebung nicht ausfuehrbar (eslint-Binary nicht im PATH) — Umgebungslimit, kein Befund.

### 5.2 Kernaussagen des Urteils

- **Verhaltens-Identitaet** (haertester Pruefpunkt) statisch UND ausfuehrbar bestanden: die vier Budget-Gate-Praedikate (`budgetExceeded`, `reserveExceedsBudget`, `globalBudgetExceeded`, `globalReserveExceedsBudget`) und `tryReserveOutboundBudget` lesen nachweislich nur ueber `costCents`/`globalUsageTotals`, nicht ueber die neue Achse; der Diff fasst keine dieser Funktionen an.
- **Monotonie-Riegel** in beide Richtungen (rueckwaerts und Zukunft) ausfuehrbar bestaetigt — der Cap ist nach dem spaeteren P7-Flip nicht ueber eine einzelne Uhr-Anomalie abschaltbar.
- **Ein Praedikat, zwei Aufrufer** (G5): `authoritativeSpendMonthKey` hat exakt zwei Aufrufer, `bookCents` ist die einzige Cent-Schreibstelle beider Achsen — keine Kopie der Vergleichsregel gefunden.
- **Mikro-Cent-Regel** ausfuehrbar belegt: der Sub-Cent-Rest wird beim Monatswechsel nie zurueckgesetzt, kein Cent geht verloren.
- **Zeit-Freiheit** bestaetigt: kein `Date.now()`/argumentloses `new Date()` im neuen Code; die Uhr wird an der IO-Grenze injiziert, `state-ops.js` bleibt rein.
- **Absolute Regeln** alle intakt: kein Safety-Gate beruehrt, `disclosureSentence`/Allowlist/Denylist/Signaturpruefung/`safeEqual`/Auth-Middleware kommen im Diff nicht vor, keine neue Logausgabe, `usageView` bleibt eine explizite Feld-Whitelist (neue Felder erscheinen nicht in `/api/state`), keine neuen Dependencies, kein `eslint-disable`/`.skip`.

### 5.3 Concerns (nicht blockierend)

1. **Falscher Kommentar** in `test/usage-spend-month-axis.test.js` (Z. 4-5): behauptet, die Datei sei "die EINZIGE Testdatei-Aenderung der Phase (0 Bestandstests angefasst)" — tatsaechlich wurden zwei Bestandstests mechanisch mitgezogen. Die Aenderungen selbst sind einwandfrei; der Kommentar sollte korrigiert werden, bevor er den naechsten Leser in die Irre fuehrt.
2. **Toter Code bis P7:** `spendMonthUsageCents` ist exportiert, hat aber null Produktions-Aufrufer (nur Tests) — vom Plan ausdruecklich als "inert, Flip ist P7" vorgesehen und im Code kommentiert; formal kollidiert das mit dem Repo-Verbot von totem Code, ist aber als plan-sanktionierter Seam akzeptiert und sollte nicht laenger als bis P7 unaufgerufen bleiben.
3. `flushUsage` reicht `spendMonthCostCents` bewusst ohne `?? 0` an eine NOT-NULL-Spalte — bei einem Shape-Defekt bricht der gesamte Flush des Tenants ab, nicht nur dieses Feld. Konsistent zur Nachbarzeile `costCents`, als vertretbares akzeptiertes Risiko notiert.
4. Der Betriebs-Auflagen-Punkt (`PLAN-SECURITY.md`-Eintrag zur befristeten Lockerung) ist P0-Scope und fuer diesen Review irrelevant, sollte aber vor dem Deploy der Gesamtkette gegengeprueft werden.

---

## 6. Clean-Code-Audit (final)

**Verdikt: PASS. Kein Blocker (S1/S2 leer).**

- **S1 (Blocker):** keine Funde.
- **S2 (Blocker):** keine Funde.
- **S3 (nicht-blockierend):** ein Fund — F1 in `state-ops.js`: `trackUsage` (5 Argumente) und `addVoiceUsageCostCents` (4 Argumente) ueberschreiten den F1-Schwellwert von 3. Mildernd: `nowIso` ist optional/nachgestellt, folgt dem im Repo etablierten Zeit-Injektions-Muster (`setSuspendedAtIfAbsent`/`voiceMinutesUsedSince`) und macht eine sonst unreine `new Date()`-Abhaengigkeit explizit statt versteckt — eher ein Gewinn an Testbarkeit/Dependency-Inversion als eine schaedliche Kopplung. Kein Fix noetig; Empfehlung: falls ein sechster Parameter dazukommt, auf ein Kontext-Objekt umstellen.
- **S4:** keine Funde.

**Top-Todos:**
1. Kein Blocker — Phase ist mergefaehig.
2. Beobachten: F1 (Argumentzahl der beiden Schreibfunktionen) nicht weiter wachsen lassen; beim naechsten zusaetzlichen Parameter auf ein Kontext-Objekt umstellen.
3. P7 (Cap-Flip auf `spendMonthUsageCents`) bleibt wie dokumentiert ausstehend — kein P4-Scope-Fehler, nur Reminder fuer die naechste Phase.

**Weitere Pass-Notizen:** Alle 55 direkt betroffenen Tests plus volle Suite (2587/2587) unabhaengig verifiziert, inkl. PGlite-Rundlauf und Migrations-Idempotenz. G5 sauber (`authoritativeSpendMonthKey` hat genau die zwei dokumentierten Aufrufer, kein dritter Vergleichsort per Grep gefunden). G25 (Magic Numbers): keine Funde — die "2" in `padStart(2, "0")` ist die inhaerente Breite des `YYYY-MM`-Formats an der einzigen Ableitungsstelle; Testkonstanten sind benannt und hergeleitet. N7 sauber: alle Identifier tragen konsequent das Praefix `spendMonth`; "Periode" taucht nur abgrenzend in Kommentaren auf, nie als Bezeichner (per Grep gegen `billing/period.js` verifiziert). C2: keine veralteten Datei:Zeile-Kommentare im Scope gefunden. Ein Grenzfall (kein gespeicherter Schluessel UND unlesbares `nowIso`) war bereits ein "Review-Blocker Runde 1" und ist per explizitem Guard behandelt (s. Fix-Runde unten) und mit eigenem Test abgesichert. Facade-Signaturen (`store.js`/`json.js`/`pg.js`) bleiben fuer Aufrufer unveraendert — sauberes Muster. Scope entspricht exakt den 8 Dateien aus `git diff --stat` (`PLAN-BUDGET-AXES.md` im Arbeitsverzeichnis ist nicht Teil des Branch-Diffs und daher zu Recht nicht auditiert).

---

## 7. Fix-Runden

**Runde 1 (fix1):** einziger gemeldeter Blocker behoben. `bookCents()` behandelte den Grenzfall "kein gespeicherter Monatsschluessel UND unlesbares/fehlendes `nowIso`" (`authoritativeSpendMonthKey` liefert dann `null`) faelschlich als "derselbe Monat" (`null === null`), wodurch `spendMonthCostCents` phantomhaft weiterakkumulierte, obwohl gar kein gueltiger Monatsschluessel je gestempelt wurde. Der Fix ergaenzt den expliziten Guard fuer diesen Grenzfall; abgesichert durch die Faelle (l)/(m) in der Testdatei. Nach diesem Fix: Safety- und Clean-Code-Review beide final PASS/APPROVED ohne weitere Blocker. Der finale Branchname (`phase/ba-p4-spend-month-axis-fix1`) traegt entsprechend das `-fix1`-Suffix dieser einen Runde.

---

## 8. Offene Deploy-Vorbedingungen

1. **Schema-Migration + Produktiv-DB-Ablauf (bindend, blockiert Deploy dieser und aller nachfolgenden Ketten-Phasen):** die Phase fuegt `ALTER TABLE usage ADD COLUMN IF NOT EXISTS spend_month_key/spend_month_cost_cents` hinzu. Die aktuelle Produktiv-DB (Render Free Tier) laeuft am 2026-07-24 ab. Die Ablösung/Verlaengerung ist Owner-Sache und ausserhalb dieser Phase — **nicht deployen, bevor das geklaert ist.** Code und Migration sind vollstaendig gegen PGlite/in-process bewiesen (inkl. Idempotenz-Test), also ohne Zugriff auf die echte Produktiv-DB verifizierbar.
2. **Kommentar-Korrektur (Kosmetik, kein Blocker):** der irrefuehrende Kommentar in `test/usage-spend-month-axis.test.js` ("EINZIGE Testdatei-Aenderung") sollte vor dem naechsten Lese-Durchgang korrigiert werden, um kuenftige Leser nicht in die Irre zu fuehren.
3. **P7-Vormerkung:** `spendMonthUsageCents` bleibt bis zum Cap-Flip in P7 ohne Produktionsaufrufer (plan-sanktioniert inert). Der Signatur-Refactor von `trackUsage`/`addVoiceUsageCostCents` (Abweichung A1, aktuell 5 bzw. 4 Argumente) ist explizit fuer P7 vorgesehen, wo beide Funktionen ohnehin angefasst werden.
4. **PLAN-SECURITY.md-Gegenpruefung:** der bestehende Eintrag zur befristeten Budget-Lockerung (P0-Scope, nicht Teil dieses Diffs) sollte vor dem Deploy der Gesamtkette erneut gegengeprueft werden.
