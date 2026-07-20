# Phase PA-6 — `flushOwnScoped`-Helfer fuer das own-filter + deleteMissing-Idiom in `src/store/pg.js`

- **Gate**: PASS
- **finalBranch**: `phase/polish-a-p6`
- **headCommit**: `259562f8014196c5a50a997c8b2bc93d69a16415`
- **Datum**: 2026-07-18 (Session-Log; Plan/Impl/Review liefen am 2026-07-17)

## 1. Ausgangslage / Zweck der Phase

In `src/store/pg.js` existierte dreifach identischer Code fuer den per-Tenant-Flush der id-PK-Tabellen `number` (`flushNumbers`), `provisioning_job` (`flushProvisioningJobs`) und `usage_event` (`flushUsageEvents`): jeweils

1. `own = rows.filter((r) => r.tenantId === tenantId)` — own-Filter als zweite Verteidigungslinie zusaetzlich zur per-Tenant-RLS-GUC (der INSERT schreibt `tenant_id = <tenantId>`, nicht `row.tenantId`),
2. `deleteMissing(client, table, tenantId, own.map((r) => r.id))` — prunt Zeilen, die nicht mehr im Spiegel stehen (Retention/Erase),
3. eine sequenzielle `for`-Insert-Schleife mit tabellenspezifischem Upsert.

PA-6 sollte dieses Idiom als G5-Template-Method-Refactor in einen gemeinsamen Helfer `flushOwnScoped` heben. `flushTenantBudgets` (Tabelle `tenant_budget`, PK=`tenant_id`, kein `deleteMissing`) war bewusst ausgenommen.

## 2. Plan (gekuerzt)

### Vorbedingungen (verifiziert gegen `master` @ `34fdf25`)
- Arbeitsbaum-`src/store/pg.js` byte-identisch zu `master`.
- Dep PA-3 gemergt (`ensureTenant` -> `hydrateTenant` setzt `setTenant` vor `hydrateTenantInto`).
- Die 3 Idiom-Stellen per Grep bestaetigt, alle modul-intern, nicht exportiert, ausschliesslich aus `flushTenantScope` pro Tenant unter dessen RLS-GUC aufgerufen.
- Abgrenzung: `flushTenantBudgets` bleibt unveraendert.
- RLS: Tabellen sind `ENABLE` + `FORCE ROW LEVEL SECURITY`; der pglite-Test-Runner ist Superuser und umgeht FORCE — der own-Filter ist im Testumfeld die einzige Schranke gegen Cross-Tenant-Fehletikettierung, daher Cross-Tenant-Tests als echter Regressionswaechter geplant.

### Clean-Code-Einordnung (Plan)
G5-Form-3-Refactor (Template Method): fixer Teil = own-Filter -> deleteMissing -> Insert-Loop, variabler Teil = tabellenspezifischer Upsert (`insertRow`-Callback). Verhaltens-erhaltend. F1: ein Objekt-Argument (5 Felder) statt Positionsargumente. N7: `flushOwnScoped`-Name signalisiert Schreib-Seiteneffekt (`flush*`-Konvention der Datei). Keine Magic Numbers, kein toter Code.

### Geplante Aenderung (1 Datei, kein neuer Export/Import)
Neuer modul-interner Helfer, direkt ueber `flushNumbers` platziert:

```js
async function flushOwnScoped({ client, tenantId, table, rows, insertRow }) {
  const own = rows.filter((r) => r.tenantId === tenantId);
  await deleteMissing(client, table, tenantId, own.map((r) => r.id));
  for (const row of own) {
    await insertRow(row);
  }
}
```

`flushNumbers`, `flushProvisioningJobs`, `flushUsageEvents` werden auf Aufrufe von `flushOwnScoped` mit tabellenspezifischem `insertRow`-Callback (Closure ueber `client`/`tenantId`) umgestellt — SQL-Text, Spalten, Parameter-Reihenfolge, `deleteMissing`-vor-Insert-Reihenfolge und `flushTenantScope`-Aufrufreihenfolge bleiben unangetastet. `flushTenantBudgets` bleibt zwischen den umgestellten Funktionen unveraendert stehen.

### Geplante Tests (`test/store-pg-multitenant.test.js`, additiv)
5 neue Tests, als Golden-Master/Regressionswaechter gedacht (muessen sowohl vor als auch nach dem Refactor gruen sein):

- **T-PA6-1**: `number` — volle Lifecycle-Spalten (inkl. `providerNumberId`/`paymentIntentId`/`country`/`language`) round-trippen ueber Save/Reopen/Load.
- **T-PA6-2**: `provisioning_job` — Cross-Tenant-Isolation (Owner-Job bleibt Owner, B-Job bleibt B, keine Vermischung) + volle Spalten (`status`/`attempts`/`lastError`/`createdAt`) nach `markProvisioningJob`.
- **T-PA6-3**: `usage_event` — Cross-Tenant-Isolation + volle Spalten (`costCents`/`quantity`/`stripeMeterSent`) inkl. `markMeterEventsSent`-Flip.
- **T-PA6-4**: `usage_event`-Downstream — `planMinutesExceeded` und `aggregatePendingMeters` lesen die round-getrippten Zeilen korrekt (Gate- und Metering-Konsumenten).
- **T-PA6-5**: leere keep-Liste (`deleteMissing`-Empty-Branch) prunt genau den betroffenen Tenant, Owner-Zeilen bleiben unberuehrt.

### Deterministisches Ergebnis-Gate (Plan)
`node --check`, Grep-Struktur-Gates (`flushOwnScoped`-Vorkommen, verbleibende inline own-Filter, `flushTenantBudgets`-Diff-Umfang), Fokus-Suite `test/store-pg-multitenant.test.js`, Verhaltens-Erhalt-Beweis durch Lauf derselben neuen Tests gegen `master` (vor dem Edit), Voll-Suite.

### Blast-Radius (Plan)
1 geaenderte Produktionsdatei (`src/store/pg.js`, rein modul-intern), 1 geaenderte Testdatei (additiv), keine neue Dependency, keine Env-Var, kein Config-Zugriff, kein Deploy/Push, Safety-Gates/Offenlegung/Auth unberuehrt.

### Offene Frage (Plan, mit Default)
Golden-Master fuer volle Spalten primaer ueber re-hydrierte State-Assertion (Produktions-Read-Pfad `hydrateTenantInto`) statt roher DB-Spalten-Assertion (Date-vs-ISO-Bruch bei `created_at`) — Default = State-Golden-Master, ohne Rueckfrage umgesetzt.

## 3. Implementierung — Zusammenfassung

- **headCommit**: `259562f8014196c5a50a997c8b2bc93d69a16415`, Branch `phase/polish-a-p6`.
- `node --check`: PASS.
- Tests: PASS, 2388 gesamt (0 fail).
- `flushOwnScoped` wurde exakt wie geplant modul-intern in `src/store/pg.js` ergaenzt und `flushNumbers`/`flushProvisioningJobs`/`flushUsageEvents` darauf umgestellt; `flushTenantBudgets` bewusst unveraendert gelassen.
- Verhaltens-erhaltend: kein SQL-/Parameter-/Reihenfolge-Delta, own-Filter als Defense-in-Depth erhalten.
- 5 neue additive Tests wie geplant (Golden-Master volle Spalten je Tabelle, Cross-Tenant-Regressionswaechter fuer `provisioning_job` + `usage_event`, Downstream-Test `planMinutesExceeded` + `aggregatePendingMeters`, leere-keep-Liste-Sonderfall).
- Full-Suite 2388/0 gruen, Fokus-Suite 9/9 gruen, Smoke (`/healthz` 200) ok.
- Regressionswaechter wurden per **Bug-Injection** tatsaechlich verifiziert: own-Filter aus dem Helfer entfernt -> betroffene Tests schlagen erwartungsgemaess fehl (kein nur behaupteter, sondern scharf bewiesener Regressionsschutz).
- Geaenderte Dateien (im Worktree `wf_47dd0286-796-2`):
  - `src/store/pg.js`
  - `test/store-pg-multitenant.test.js`

### Deviations (Abweichungen vom Plan)

1. **Plan-Grep-Vorhersage "`flushOwnScoped` 4x" traf nicht zu** — tatsaechlich 7 Treffer (1 Definition + 3 Aufrufe + 3 Kommentar-Erwaehnungen, letztere wortgleich aus dem Plan-Text selbst). Keine Code-Abweichung vom Plan, nur eine ungenaue Vorhersage im Plan-Dokument.
2. **Plan-Grep-Vorhersage "`flushTenantBudgets`-Diff 0 Treffer" traf nicht woertlich zu** — `git diff` zeigt 2 Fundstellen (eine neue Kommentarzeile, die `flushTenantBudgets` namentlich erwaehnt, sowie die diff-Hunk-Header-Zeile mit der naechsten Funktionssignatur als Kontext). Der Funktions-**Body** selbst ist nachweislich zeilengleich unveraendert (separat verifiziert) — keine echte Abweichung.
3. **Ungeplanter Zwischenschritt**: `npx prettier --write` wurde versehentlich auf beide Dateien angewendet und hat dabei unbeteiligten Bestandscode reformatiert (`master` selbst ist unter der installierten Prettier-Version nicht prettier-clean). Erkannt, beide Dateien auf den Pre-Prettier-Stand zurueckgesetzt, die PA-6-Edits sauber erneut angewendet, danach erneut verifiziert (Syntax/Fokus-Suite/Voll-Suite/Smoke gruen, Diff-Scope wieder exakt wie beabsichtigt).

### Clean-Code-Self-Check (Implementierung)

G5 (Duplizierung) ist der Kernzweck der Phase: das 3x identische own-Filter+deleteMissing+Insert-Loop-Idiom ist jetzt an einer Stelle (`flushOwnScoped`). F1 (Argumente): 1 Objekt-Argument mit 5 Feldern statt Positionsargumente. N7: `flushOwnScoped` signalisiert Schreib-Seiteneffekt (`flush*`-Konvention der Datei). Keine Magic Numbers, kein toter/auskommentierter Code, keine ungenutzten Imports. G30/G34: der Helfer hat genau eine Aufgabe (own-Filter -> deleteMissing -> Insert-Loop), eine Abstraktionsebene; die 3 Aufrufer sind auf die Objekt-Literal-Konfiguration reduziert. C2: Kommentare wurden inhaltlich aktualisiert (verweisen jetzt auf den Helfer statt das Idiom zu wiederholen), keine Datei:Zeile-Referenzen. Tests: P13 (Build-Operate-Check) ueber lokalen `makeNumberRow`-Helfer, der die 9-Feld-Boilerplate kapselt (G5 auch im Testcode); P12-Isolation gewahrt (kein datei-uebergreifender Helper, jeder Test bekommt eine frische pglite-Instanz); P14 mit Augenmass (mehrere zusammengehoerige Assertions pro Test wie im Bestandsmuster der Datei, nicht dogmatisch auf 1 Assert reduziert). Der Cross-Tenant-Regressionswaechter (T-PA6-2/3) wurde per Bug-Injection tatsaechlich als scharf verifiziert, nicht nur behauptet.

## 4. Safety-Urteil (final)

- **approved**: true
- testsPassIndependently: true
- safetyGatesIntact: true
- disclosureIntact: true
- authFailClosedIntact: true
- noSecretsLeaked: true
- scopeRespected: true
- behaviorAsIntended: true
- blockers: keine

**concerns**: Voller Suite-Lauf zeigte 1 roten Test (`test/telnyx-event-ingest-route.test.js:49`, "call.hangup Settlement idempotent"). Das ist **nicht** PA-6-verursacht: spawn-basierter Telnyx-Settlement-Test, beruehrt die pglite-Flush-Ebene nicht. Es ist der dokumentierte ~12% Voll-Last-Flake (Seed-vor-Boot-Race) und isoliert gruen (3/3). Kein Regressionsverdacht gegen `flushOwnScoped`.

**independentTestSummary**: Unabhaengiger Suite-Lauf (`node --test`): 2388 Tests, 2387 pass, 1 fail, Dauer ~122s. Alle 8 PA-6-Tests (T-PA6-1..5 + Owner-only/Zwei-Tenant/RLS-WITH-CHECK) gruen. Der einzige rote Test ist der bekannte Voll-Last-Flake in `telnyx-event-ingest-route.test.js` (Settlement-Idempotenz, spawn-basiert) — isoliert 3/3 gruen, unabhaengig vom `pg.js`-Refactor. `node --check` auf `pg.js` und Testdatei OK. pglite deckt das pg-Backend ab; json-Backend laeuft ueber die uebrigen Spawn-Tests (`BASE_ENV STORE_BACKEND=json`).

**verdict**: APPROVED. PA-6 ist eine saubere, verhaltens-erhaltende G5-Dedup: die 3 vollen own+deleteMissing+Insert-Idiome (`number`/`provisioning_job`/`usage_event`) sind byte-identisch (SQL-Spalten, ON-CONFLICT, Param-Arrays, own-Filter, deleteMissing-vor-Insert, Reihenfolge) in einen `flushOwnScoped`-Helfer gebuendelt. `flushTenantBudgets` (PK=`tenant_id`, kein `deleteMissing`) korrekt und byte-identisch ausgenommen — die Abgrenzung ist eingehalten und im Helfer-Kommentar begruendet. Der own-Filter bleibt als zweite Verteidigungslinie zusaetzlich zur RLS-GUC erhalten (Defense-in-Depth). Scope streng eingehalten: nur `src/store/pg.js` + die additive Testdatei, keine neue npm-Dependency, kein Logging-/Env-Zugriff, keine Secrets, keine Aenderung an Safety-Gates/Disclosure/Auth/MCP. Teststrategie voll erfuellt (Golden-Master mit vollen Spalten je Tabelle, Leere-keep-Liste-Sonderfall, Downstream `planMinutesExceeded` + `billing/meter.js`, Cross-Tenant auf `provisioning_job` und `usage_event`). Eigene Tests gruen (der eine rote ist der dokumentierte, PA-6-unabhaengige Flake, isoliert gruen).

## 5. Clean-Code-Audit (final)

- **s1**: keine Befunde
- **s2**: keine Befunde
- **s3**: keine Befunde
- **s4**: keine Befunde
- **blocker**: false

**verdict**: PASS. PA-6 (259562f, Branch `phase/polish-a-p6` gegen `master`) refaktoriert `flushNumbers`/`flushProvisioningJobs`/`flushUsageEvents` in `src/store/pg.js` auf einen gemeinsamen Helfer `flushOwnScoped` (own-Filter + deleteMissing + Insert-Loop) und fuegt 5 neue Tests in `test/store-pg-multitenant.test.js` hinzu (T-PA6-1..5). Diff ist genau das, was G5 vorschreibt (Form 2: gemeinsame Schritte extrahieren) — keine neue Duplizierung, keine bestehende uebersehen. Kein S1/S2-Befund. Nur eine minimale Randnotiz (kein FLAG, da ein Fix die Lesbarkeit nicht verbessern wuerde, Regel 3).

**passNotes**:

Verifikation: `node --check` auf Phase-Branch-`pg.js` OK. Volle Suite auf `phase/polish-a-p6` in isoliertem Worktree gelaufen: 2387/2388 gruen; die eine rote Test (`telnyx-p5-origination.test.js:143`, "genau eine neue Notification") ist der in MEMORY dokumentierte vorbestehende ~12%-Voll-Last-Flake (Seed-vor-Boot-Race, `suite-flake-p5-gate-proof-spawn-race`) — isoliert nachgefahren: 4/4 gruen. Nicht PA-6-verursacht (Datei ausserhalb des Diff-Scopes, keine Telefonie-/Store-Ueberschneidung). Die 5 neuen PA-6-Tests selbst: 9/9 gruen inkl. der 3 alten Golden-Master-/RLS-Tests in derselben Datei.

Inhaltlich: `flushOwnScoped` kapselt exakt das dreifach identische Idiom (`own=rows.filter(r=>r.tenantId===tenantId)` -> `deleteMissing` -> for-Insert-Loop), die drei umgebauten Funktionen sind byte-fuer-byte verhaltensgleich (bewiesen durch die Golden-Master-Tests T-PA6-1/2/3 und durch identisches SQL/Parameter-Binding im Diff). Sequenzielle `await`-Insert-Schleife bleibt erhalten (keine `Promise.all`-Race eingefuehrt, P16 unberuehrt). `tenant_budget` wurde bewusst NICHT auf den Helfer umgestellt (kein `deleteMissing` dort, PK=`tenant_id`) — im Kommentar explizit begruendet, verhindert Leser-Verwirrung (gute G22/G17-Disziplin). `flushCalendar`/`flushActionItems`/`flushNotifications` (unveraendert, ausserhalb Diff) haben eine andere Form (kein own-Filter, teils Reverse-Insert fuer Notification-Reihenfolge) — korrekt NICHT in denselben Helfer gezwungen, waere sonst eine falsche Abstraktion (G6) gewesen.

Tests folgen P13 (Build-Operate-Check, expliziter `makeNumberRow`-Builder), decken Cross-Tenant-Isolation (own-Filter-Verletzung wuerde rot werden), Downstream-Konsumenten (`planMinutesExceeded`, `aggregatePendingMeters`) und den `deleteMissing`-Leerlisten-Voll-Prune-Zweig (G3/T5-Grenzfall) ab. Keine Umlaute in neuen Kommentaren (Konvention eingehalten), keine toten Imports, kein auskommentierter Code, keine Magic Numbers ohne Kontext, keine Secrets/Sicherheits-Gates beruehrt.

**Randnotiz (kein FLAG)**: `flushOwnScoped` nimmt ein Optionsobjekt mit 5 benannten Feldern (`client`, `tenantId`, `table`, `rows`, `insertRow`) entgegen — an der oberen F1-Grenze, aber jeder Call-Site ist durch Namen selbsterklaerend und folgt einem im selben File bereits etablierten Muster (`deleteMissingByText` nutzt dieselbe Objekt-Konvention). Aufteilen wuerde nichts klarer machen (Regel 3) -> bewusst nicht geflaggt.

**topTodos**: keine.

## 6. Fix-Runden

Keine. `s1`-`s4` sind leer, `blocker: false` — der Clean-Code-Auditor hat PA-6 im ersten Durchlauf ohne Blocker/Findings mit PASS bewertet, das Safety-Review hat im ersten Durchlauf mit `approved: true` und ohne Blocker abgeschlossen. Es waren keine Fix-Runden noetig.

## 7. Fazit

PA-6 ist abgeschlossen: `flushOwnScoped` buendelt das dreifach duplizierte own-filter+deleteMissing+Insert-Loop-Idiom in `src/store/pg.js` verhaltens-erhaltend hinter einem G5-Template-Method-Helfer, `flushTenantBudgets` bleibt bewusst und nachweislich unveraendert ausgenommen. Beide Reviews (Safety, Clean-Code) haben ohne Blocker mit PASS/APPROVED abgeschlossen, keine Fix-Runde war noetig. Der einzige rote Test in der Voll-Suite ist ein vorbestehender, dokumentierter Flake ausserhalb des Diff-Scopes.
