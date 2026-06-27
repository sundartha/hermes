# Go-Live: pg-Cutover & Boot-Gate — Strategie

Status: Analyse (kein Code geaendert). Stand 2026-06-24.
Autor: RCA-Team (Backend / Multi-Tenant / Infra / Red-Team), moderiert.

## TL;DR — der einfachste Weg

Der Blocker ist **kein** Plan-Problem und **kein** fehlendes-Daten-Problem, sondern ein
**Parity-Bug zwischen den beiden Store-Backends**. Der JSON-Store seedet die aktive
Owner-Absendernummer beim Boot automatisch aus `OWNER_NUMBER` / `OWNER_NUMBER_PROVIDER`
(env). Der pg-Store **vergisst genau diesen einen Seed-Aufruf**. Deshalb startet
`STORE_BACKEND=pg` gegen die leere DB nie durch — egal wie viele Env-Vars gesetzt sind.

**Fix = 1 fehlenden Seed-Aufruf in `pg.js init()` ergaenzen** (Parity zu `json.js`).
Danach seedet jeder Boot die Owner-Nummer idempotent aus der env — **ohne Shell, ohne
One-Off-Job, ohne preDeployCommand**. Damit fallen Blocker #1 **und** #2 weg.

Die vom Briefing vorgeschlagene 4-Phasen-Maschinerie (preDeploy-Seeding, Migration mit
Backfill, manuelles Shell-Seeding) ist **ueberkompliziert** — sie loest ein Problem, das
der Code bereits geloest hat, nur im pg-Pfad nicht verdrahtet ist.

Den Boot-Gate **behalten** wir (echtes Safety-Invariant, kein Single-Tenant-Legacy).
Das einzige unvermeidbare Geld-Thema ist der Render-Plan: ein Telefon-Agent darf nicht
einschlafen → Web-Service Free→Starter ($7/Mo). Postgres kann bis 2026-07-24 Free bleiben.

---

## 1. Root Cause (belegt)

### Der Boot-Gate
`src/server.js` (vor `app.listen`):
```js
if (!findActiveNumber(store.load(), OWNER_TENANT_ID)) {
  console.error("[boot] Keine aktive Owner-Nummer im Store. Erst seeden: ...");
  process.exit(1);
}
```
`findActiveNumber(s, "owner")` sucht in `s.numbers` einen Record mit `tenantId="owner"`
und `status="active"`. Der Gate ist **immer aktiv** (nicht an `MULTI_TENANT` gekoppelt).

### Die Asymmetrie (der eigentliche Bug)
`src/store/json.js` `finishLoad()` seedet beim Boot **drei** Dinge aus der config:
```js
ops.seedOwnerIdentity(state, ...);            // owner_name
ops.seedOwnerNumberFromConfig(state,          // <-- aktive ABSENDER-Nummer -> s.numbers
  config.ownerNumber, OWNER_TENANT_ID, config.ownerNumberProvider);
ops.seedOwnerPrivateNumber(state, ...);       // privateNumber (Summary-SMS-Ziel)
```
`src/store/pg.js` `init()` seedet beim Boot nur **zwei**:
```js
ops.seedOwnerIdentity(state, ...);            // owner_name
ops.seedOwnerPrivateNumber(state, ...);       // privateNumber
// FEHLT: ops.seedOwnerNumberFromConfig(...)  -> s.numbers bleibt leer
```
Ergebnis: Auf pg wird die **aktive Owner-Nummer in `s.numbers` nie geseedet**. Der
Boot-Gate prueft aber genau diese Zeile → `process.exit(1)`. Das ist exakt der
beobachtete Boot-Log.

> Hinweis: `seedOwnerPrivateNumber` setzt `tenant.privateNumber` (SMS-Ziel), **nicht** die
> aktive Absendernummer in `s.numbers`. Zwei verschiedene Felder — leicht zu verwechseln,
> genau hier ist der Bug entstanden.

### Warum JSON auf Render trotzdem keine echte Option ist
JSON bootet (Auto-Seed greift), aber Render-Free-FS ist **fluechtig**: jeder Deploy/Restart
loescht `data/store.json` → alle Tenants, Abos, Calls, Nummern weg. Fuer ein
Multi-Tenant-Produkt mit zahlenden Kunden ist das untragbar. **pg ist Pflicht** — nicht
wegen des Boot-Gates, sondern wegen Datenpersistenz ueber Deploys hinweg.

### Owner-Nummer: Legacy oder noetig?
Noetig, aber kein Single-Tenant-Legacy. Inbound-Routing braucht sie **nicht**
(generischer `findTenantByNumber(e164)` ueber `s.numbers`). Gebraucht wird die aktive
Owner-Nummer fuer **Owner-Outbound** und **From-Nummer** der Dienste. Der Owner ist
"Tenant Null" — strukturell ein normaler Tenant mit ausgezeichneter `tenantId="owner"`.
Den Gate ersatzlos zu streichen ist **falsch**: er schuetzt ein echtes Invariant. Richtig
ist, den fehlenden Auto-Seed zu ergaenzen.

---

## 2. Pre-Mortem ("Launch 2 Wochen nach Go-Live katastrophal gescheitert — warum?")

| # | Szenario | Eintritts-Wahrsch. | Gegenmassnahme |
|---|----------|--------------------|----------------|
| R1 | **Plan-Upgrade gekauft, Boot bricht trotzdem ab** — weil der Parity-Bug nie gefixt wurde; Geld ausgegeben, Blocker bleibt. | hoch (akut) | Code-Fix (Phase 1) **vor** jedem Plan-Upgrade. Reihenfolge zwingend. |
| R2 | **Fix landet im falschen Repo** — Render deployt `jonas986/vodafone-agent` (upstream), nicht `origin`. Push auf origin macht nichts live. | hoch | Fix auf upstream/master pushen; Live-Commit per `[boot]`-Banner/`gh` verifizieren. |
| R3 | **Free-Instanz eingeschlafen** → Inbound-Call/Stripe-Webhook trifft schlafende Instanz (~1 min Cold-Start) → Anruf bricht ab. | sicher auf Free | Web-Service auf Starter ($7/Mo), kein Spin-down. Unvermeidbar. |
| R4 | **Free-Postgres laeuft 2026-07-24 ab** → DB weg, alle Tenants/Abos verloren. | sicher (Datum) | Vor dem 24.07. auf Basic-256MB (~$6/Mo) upgraden; Kalender-Reminder. |
| R5 | **WorkOS Staging + Stripe Test versehentlich im Echtbetrieb** — `sk_test`, Staging-Authkit; echte Kunden zahlen nie / Logins instabil. | mittel | Soft-Launch bewusst auf Test/Staging; Prod/Live als expliziter, abgehakter Schritt (Phase 3) mit Smoke-Test. |
| R6 | **PAYMENT_ENABLED=true ohne gueltiges STRIPE_WEBHOOK_SECRET** → fail-closed, Abos aktivieren nie. | mittel | `PAYMENT_ENABLED` erst flippen, wenn Webhook-Secret verifiziert + Webhook-Endpoint in Stripe registriert; Test-Event durchspielen. |
| R7 | **Daten-Backfill-Annahme falsch** — es gibt gar keine Altdaten zu migrieren (DB ist frisch von heute, JSON-Store war nur lokal/ephemeral). Ein "Backfill"-Schritt waere Aufwand fuer nichts. | — | Kein Backfill noetig. Owner-Nummer kommt aus env-Auto-Seed, nicht aus Migration. Briefing-Annahme entschaerft. |
| R8 | **Idempotenz-Bruch beim Re-Boot** — Seed schreibt bei jedem Boot eine Dublette. | niedrig | `seedOwnerNumber` dedupliziert ueber normalisierte E.164 (verifiziert). Idempotent. |
| R9 | **Owner-Nummer ist Privatnummer statt Provider-DID** → Telnyx 403 beim Outbound (siehe Vorfall 2026-06-23). | mittel | `OWNER_NUMBER` MUSS die Telnyx-DID `+18643028341` sein, NICHT die Privatnummer. Auf Render verifizieren. |

Wichtigste Erkenntnis: **R1 + R2 zuerst.** Ohne Code-Fix auf dem deployten Repo ist jedes
Geld fuer Plan/DB verbrannt — der Boot bricht weiter ab.

---

## 3. Phasen-Strategie (schlank)

### Phase 0 — Stabilisieren (sofort, kostenlos)
Nichts kaufen. Nicht auf JSON zurueckrollen (R7: ephemeres FS verliert Kunden). Der
Service bleibt bis Phase 1 bewusst rot — kein halber Live-Betrieb auf Free.

### Phase 1 — Boot-Gate/Seeding im Code loesen (der eigentliche Fix)
- In `src/store/pg.js` `init()` den fehlenden Aufruf ergaenzen — Parity zu `json.js`:
  ```js
  ops.seedOwnerNumberFromConfig(
    state, config.ownerNumber, OWNER_TENANT_ID, config.ownerNumberProvider);
  ```
  und sicherstellen, dass der bestehende `init()`-Flush diese Nummer persistiert
  (der Flush ist ein Full-Snapshot inkl. `s.numbers`; die Flush-Bedingung ggf. um eine
  aktive Owner-Nummer erweitern, damit der Seed auch ohne `privateNumber` round-trippt).
- Test: pg-Init gegen leere DB → `findActiveNumber(load(), "owner")` ist gesetzt
  (Charakterisierung der json/pg-Parity).
- **Auf das deployte Repo pushen** (upstream `jonas986/vodafone-agent` master), Live-Commit
  per Boot-Banner verifizieren.
- Resultat: `STORE_BACKEND=pg` bootet ohne Shell/One-Off/preDeploy. Blocker #1 + #2 erledigt.

> Bewusst NICHT gemacht: preDeployCommand, Migrations-Seed, manuelles Shell-Seeding.
> Alle drei waeren Workarounds um einen Bug, den der Auto-Seed bereits loest.

### Phase 2 — Plan-Upgrade + pg scharf
- Web-Service `vodafone-agent`: Free → **Starter ($7/Mo)** (kein Spin-down; Voraussetzung
  fuer einen Telefon-Agenten). `STORE_BACKEND=pg`, `DATABASE_URL` bereits verknuepft.
- Postgres `hermes-db`: bleibt Free bis **2026-07-24**, dann **Basic-256MB (~$6/Mo)**.
  Reminder setzen (R4).
- `OWNER_NUMBER`-DID auf Render verifizieren (R9).
- Smoke: Deploy gruen → `/healthz` → Test-Inbound-Call → Owner-Outbound.
- Laufende Kosten Launch: **~$7/Mo** sofort, **~$13/Mo** ab 24.07.

### Phase 3 — Prod-Cutover (WorkOS Live + Stripe Live), separat & abgehakt
- WorkOS Staging → Production-Umgebung (eigene `client_id`/`secret`, Redirect-URI).
- Stripe Test → Live (`sk_live`, Live-Price-IDs, Live-Webhook-Secret).
- `PAYMENT_ENABLED=true` **erst** nach verifiziertem Webhook (R6).
- End-to-End-Smoke: Self-Service-Signup → Abo → Nummer-Provisioning → Inbound/Outbound.

---

## 4. Verworfene / vereinfachte Optionen

- **Boot-Gate ersatzlos streichen** (Briefing-Idee): verworfen. Echtes Safety-Invariant,
  kein Legacy. Der Gate ist nicht das Problem — der fehlende Auto-Seed ist es.
- **preDeployCommand fuer Seeding**: unnoetig. Auto-Seed beim Boot erledigt es ohne
  bezahltes preDeploy. (preDeploy ist ohnehin erst ab Starter verfuegbar.)
- **Manuelles Shell-Seeding / One-Off-Job**: unnoetig (und auf Free gesperrt).
- **Migration mit Daten-Backfill**: kein Backfill noetig (frische DB, env-Auto-Seed).
- **Auf JSON bleiben fuer "Phase 1"**: verworfen — ephemeres Render-FS verliert Kundendaten.

---

## 5. Offene Verifikationen
- pg-Flush in `init()` persistiert die frisch geseedete Owner-Nummer wirklich (Test).
- Live-DB `hermes-db` ist leer/frisch (heute erstellt — sehr wahrscheinlich; MCP-Query
  scheitert an SSL-Erzwingung, Dashboard-Check oder Boot-Log genuegt).
- `OWNER_NUMBER` auf Render = Telnyx-DID, nicht Privatnummer.
- Deployter Commit = Repo mit dem Fix (upstream, nicht origin).
</content>
</invoke>
