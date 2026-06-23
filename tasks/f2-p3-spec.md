# F2 P3 — pg-Facade + Schema: private_number TEXT

> Autoritative Scope-/Design-Definition fuer Phase F2-P3. Umbrella: `docs/strategy/f2-inbound-sms-summaries.md` (2.4, P3, Risiko M1). **Basis: der finale Branch von F2-P1** (ops.setPrivateNumber/tenantPrivateNumber existieren — NICHT master). Geschwister-Branch zu P2 (disjunkte Dateien: pg.js/schema.sql vs json.js).

## Ziel

Persistenz der privaten Nummer in PostgreSQL mit json-Paritaet: additive Schema-Spalte + hydrate/flush-Mapping + duenne Facade-Wrapper im `makePgStore`-Objekt. Vorbild durchgehend: `stripe_customer_id` / `setTenantStripe` / `tenantStripe`.

## Verifizierter Code-Stand (gegroundet — grep selbst, KEINE Zeilennummern uebernehmen)

- `src/db/schema.sql`: `tenant`-Tabelle wird additiv per `ALTER TABLE tenant ADD COLUMN IF NOT EXISTS …` erweitert (Muster `kyc_level`, `stripe_customer_id`, `country`/`default_language` — alle NULLABLE, KEIN CHECK, Validierung lebt im Code). Schema wird beim `store.init()` idempotent angewandt (auch unter pglite).
- `src/store/pg.js` `hydrateTenants(client)`: ein `SELECT id, status, owner_name, first_name, idp_subject, kyc_level, stripe_customer_id, stripe_payment_method_id, country, default_language FROM tenant`; im `rows.map` wird jedes Feld NUR-nicht-null hydriert (`if (r.kyc_level != null) tenant.kycLevel = r.kyc_level;`).
- `flushTenants(client, tenants)`: ein `INSERT INTO tenant (… 10 Spalten …) VALUES ($1..$10) ON CONFLICT (id) DO UPDATE SET …` mit Param-Array `[t.id, t.status, t.ownerName ?? null, …, t.country ?? null, t.defaultLanguage ?? null]` (heute **10** Spalten/Parameter -> neue Spalte wird **$11**; der Strategie-Hinweis "$9" ist veraltet).
- `makePgStore`-Objekt: Facade-Methoden als Objekt-Member, z.B. `setTenantStripe(tenantId, patch) { const tenant = ops.setTenantStripe(requireState(), tenantId, patch); save(); return tenant; }` und `tenantStripe: (tenantId) => ops.tenantStripe(requireState(), tenantId),`.
- `test/pg-helpers.js`: `makePgTestStore()` liefert `{store, db, runner}` ueber pglite (kein Netz).

## Konkrete Edits

### 1. `src/db/schema.sql` — additive Spalte (bei den anderen tenant-ALTERs)

```sql
-- F2 Inbound-SMS-Summary: private Mobilnummer des Tenants (E.164), Ziel der
-- Summary-SMS. Additiv NULLABLE: Owner/Bestand ohne Wert -> NULL (keine SMS, still
-- uebersprungen). KEIN CHECK-Constraint: die E.164-/Laender-Validierung lebt
-- fail-closed in setPrivateNumber (eine Quelle, Muster wie kyc_level/stripe_*).
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS private_number TEXT;
```

### 2. `src/store/pg.js` `hydrateTenants` — SELECT + nur-nicht-null-Hydrierung

- `private_number` an die SELECT-Feldliste anhaengen.
- Im `rows.map`:

```js
// F2: nur-nicht-null hydrieren (Muster wie kyc_level/stripe_*) -> Tenant ohne
// private Nummer behaelt KEIN leeres Feld (kein json<->pg-Drift, M1).
if (r.private_number != null) tenant.privateNumber = r.private_number;
```

### 3. `src/store/pg.js` `flushTenants` — Spalte $11 + ON CONFLICT + Param

- Spaltenliste: `…, default_language, private_number)`.
- `VALUES ($1, …, $10, $11)`.
- `ON CONFLICT … DO UPDATE SET …, private_number=EXCLUDED.private_number`.
- Param-Array: `…, t.defaultLanguage ?? null, t.privateNumber ?? null`.

### 4. `src/store/pg.js` `makePgStore` — Facade-Wrapper (Parity zu json.js)

```js
// ---- Private Nummer pro Tenant (F2): Wrapper-Parity zu json.js ----
setPrivateNumber(tenantId, raw) {
  const tenant = ops.setPrivateNumber(requireState(), tenantId, raw);
  save();
  return tenant;
},
tenantPrivateNumber: (tenantId) => ops.tenantPrivateNumber(requireState(), tenantId),
```

## store.js-Bindung — bewusst NICHT in dieser Phase

Wie in P2 begruendet: `src/store.js` bindet EIN Backend ueber die explizite Namen-Liste; die Bindung greift erst, wenn json (P2) UND pg (P3) in master sind. Sie ist ein Konsumenten-Schritt (P7) und KEIN P3-Scope. Tests nutzen `makePgTestStore` direkt. Als Follow-up im Report vermerken.

## Invarianten / Abgrenzung

- Additiv/NULLABLE, KEIN CHECK; Bestands-DBs migrieren idempotent.
- nur-nicht-null hydrieren -> kein null-Feld-Drift json<->pg (M1).
- Wrapper duenn (G5); `tenantPrivateNumber` ohne save.
- Scope: NUR `pg.js` + `schema.sql` (+ Test). KEIN json.js, KEIN store.js.

## Tests (neue Datei `test/f2-pg-private-number.test.js`)

Muster wie `store-pg.test.js` ueber `makePgTestStore()` aus `test/pg-helpers.js`:

- pglite Round-Trip: `store.setPrivateNumber(OWNER_TENANT_ID, "+49 170 1234567")` -> nach implizitem flush via save() -> `store.tenantPrivateNumber(OWNER_TENANT_ID)` === `"+491701234567"`. (Falls ein expliziter Re-Hydrate-Pfad im Test verfuegbar ist, zusaetzlich pruefen, dass der Wert eine frische Hydrierung ueberlebt.)
- leeren: `store.setPrivateNumber(OWNER_TENANT_ID, "")` -> `tenantPrivateNumber` === null (Feld entfernt, kein Drift).
- Owner ohne Nummer initial -> `tenantPrivateNumber(OWNER_TENANT_ID)` === null.
- **Paritaet json==pg (M1):** dieselbe Eingabe (`"+49 (170) 123-4567"`) ueber json-Backend UND pg-Store gesetzt -> beide `tenantPrivateNumber` liefern dieselbe normalisierte Form `"+491701234567"`; nach Leeren beide null.
- `ADD COLUMN IF NOT EXISTS` ist idempotent (zweiter `store.init()`/Schema-Apply wirft nicht) — falls im Test-Setup einfach pruefbar.

## Deterministisch pruefbar

`node --test test/f2-pg-private-number.test.js` gruen; `npm test` insgesamt gruen (json + pglite).
