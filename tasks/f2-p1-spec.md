# F2 P1 — Modell-Kern: setPrivateNumber / tenantPrivateNumber in state-ops.js

> Autoritative Scope-/Design-Definition fuer Phase F2-P1. Umbrella: `docs/strategy/f2-inbound-sms-summaries.md` (Abschnitt 2.3 + 2.4, P1). **Basis: der finale Branch von F2-P0** (E164/countryAllowed liegen bereits in defaults.js — NICHT master).

## Ziel
Reine, IO-freie Domaenen-Funktionen zum Setzen/Lesen der privaten Nummer auf dem **Tenant-Record** (nicht in `settings` — PII-Grund, Strategie 2.2). Eine Validier-Quelle (G5) fuer Onboard UND spaeteren Self-Service. Vorbild-Paar: `setKycLevel`/`setTenantStripe`/`tenantStripe` in `state-ops.js`.

## Verifizierter Code-Stand (gegroundet — grep selbst, KEINE Zeilennummern uebernehmen)
- `state-ops.js` importiert `normNum` aus `./defaults.js`. F2-P0 hat dort `E164`, `countryAllowed`, `DEFAULT_COUNTRY_PREFIX` ergaenzt -> diese in den bestehenden Import-Block aus `./defaults.js` aufnehmen.
- Muster `setTenantStripe(s, tenantId, {…})`: `findTenant(s,tenantId)`; fehlender Tenant -> `throw new Error("…: Tenant … nicht gefunden")`; reine Mutation, kein IO; liefert den Tenant.
- Muster `tenantStripe(s, tenantId)`: reine Query, kein IO; `tenant?.feld ?? null` (NIE undefined; fehlender Tenant -> null, KEIN throw).
- `findTenant(s, id)` liefert `null` bei Nichtfund.
- `registerTenant(s, id, { firstName, lastName } = {})`: legt Tenant an (`{ id, status: TENANT_STATUS.ACTIVE }`), `applyOwnerIdentity(...)`, `s.tenants.push(tenant)`, liefert Tenant; bestehender Tenant kommt unveraendert zurueck (idempotent, kein Upsert).
- `registerTenant` wird in `server.js` mit `{ firstName, lastName }` aufgerufen — neuer optionaler `privateNumber`-Key ist rueckwaerts-kompatibel.

## Konkrete Edits in `src/store/state-ops.js`

### Import-Block aus `./defaults.js` erweitern
`E164, countryAllowed` (und ggf. `DEFAULT_COUNTRY_PREFIX`, falls direkt gebraucht) zusaetzlich zu `normNum` importieren.

### 1. `normalizePrivateNumber(raw)` — pure Validierung, eine Quelle (G5)
**Signatur-Verfeinerung (clean-code):** der Auftrag schreibt `normalizePrivateNumber(s, raw)`; Normalisierung/Validierung braucht den State NICHT — der `s`-Parameter waere ungenutzt (Verstoss G12/F1). Daher **`normalizePrivateNumber(raw)`** (exportiert, direkt unit-testbar). Reihenfolge `normNum -> E164 -> countryAllowed` ist verbindlich (Strategie M3):
```js
// Normalisiert + validiert eine private Nummer auf E.164. Reihenfolge verbindlich
// (M3): erst normNum (strippt Trennzeichen), dann E164-Format, dann Laender-Gate
// (Toll-Fraud, H1). Wirft bei ungueltig/Premium statt Muell zu speichern (fail-closed).
// Liefert die normalisierte E.164-Form. Reine Funktion, kein State, kein IO.
export function normalizePrivateNumber(raw) {
  const e164 = normNum(raw);
  if (!E164.test(e164)) throw new Error("privateNumber: ungueltiges E.164-Format");
  if (!countryAllowed(e164)) throw new Error("privateNumber: Laender-Praefix nicht erlaubt");
  return e164;
}
```

### 2. `setPrivateNumber(s, tenantId, raw)` — Mutation, kein IO (Wrapper saved)
```js
// Setzt/leert die private Nummer eines Tenants (Nebeneffekt im Namen, N7). Leer/null
// -> Feld entfernen (Strategie 2.3: delete -> Reader liefert null, "keine Nummer"-
// Semantik). Sonst normalisieren+validieren via normalizePrivateNumber (eine Quelle,
// G5). Fehlender Tenant wirft (kein stilles No-Op, Muster setKycLevel/setTenantStripe).
// privateNumber lebt auf dem Tenant-Record (PII, NICHT in settings). Liefert den Tenant.
export function setPrivateNumber(s, tenantId, raw) {
  const tenant = findTenant(s, tenantId);
  if (!tenant) throw new Error(`setPrivateNumber: Tenant ${tenantId} nicht gefunden`);
  if (raw == null || raw === "") {
    delete tenant.privateNumber;
    return tenant;
  }
  tenant.privateNumber = normalizePrivateNumber(raw);
  return tenant;
}
```

### 3. `tenantPrivateNumber(s, tenantId)` — Query, kein IO
Muster `tenantStripe`: fehlender Tenant/fehlendes Feld -> `null` (NIE undefined, KEIN throw):
```js
// Lese-Query der privaten Nummer (reine Query, kein IO). Liefert den E.164-String
// oder null (fehlender Tenant / nicht gesetzt) - nie undefined. finishCall (P7) zieht
// das SMS-Ziel ueber DIESEN Reader (call.tenantId), NICHT ueber tenantContext (PII).
export function tenantPrivateNumber(s, tenantId) {
  const tenant = findTenant(s, tenantId);
  return tenant?.privateNumber ?? null;
}
```

### 4. `registerTenant` — optionaler `privateNumber`-Parameter (G5: teilt die Validierung)
Validieren BEVOR der Tenant in den Spiegel gepusht wird (kein halb-registrierter Tenant bei Muell-Eingabe). Nur bei nicht-leerer Eingabe:
```js
export function registerTenant(s, id, { firstName, lastName, privateNumber } = {}) {
  const existing = findTenant(s, id);
  if (existing) return existing;
  // privateNumber ZUERST validieren (wirft bei Muell/Premium), bevor der Tenant im
  // Spiegel landet -> kein halb-registrierter Record. Eine Quelle (G5).
  const normalized = (privateNumber == null || privateNumber === "") ? null : normalizePrivateNumber(privateNumber);
  const tenant = { id, status: TENANT_STATUS.ACTIVE };
  applyOwnerIdentity(tenant, firstName, lastName);
  if (normalized) tenant.privateNumber = normalized;
  s.tenants.push(tenant);
  return tenant;
}
```

## Invarianten / Abgrenzung
- **PII:** `privateNumber` lebt auf dem Tenant-Record, NIE in `settings`/`tenantContext`/`agent{}`.
- **fail-closed:** ungueltig/Premium/leerer-Praefix -> throw; fehlender Tenant (Setter) -> throw; Reader tolerant -> null.
- **G5:** EINE Validier-Quelle `normalizePrivateNumber`, genutzt von Setter UND registerTenant.
- **Scope:** NUR `state-ops.js` (+ Import aus defaults.js). KEINE json/pg-Facade (P2/P3), KEIN Onboard-Route-Wiring (P4), KEINE store.js-Bindung.

## Tests (neue Datei `test/f2-private-number.test.js`) — Negativfaelle PFLICHT
Muster wie `test/state-ops-tenant-stripe.test.js` (reine state-ops-Unit, kein Netz/pglite):
- gueltig mit Trennzeichen: `setPrivateNumber(s, A, "+49 (170) 123-4567")` -> `tenantPrivateNumber(s, A)` === `"+491701234567"` (M3).
- ungueltig: `setPrivateNumber(s, A, "abc")` -> throws; alter Wert/Record unveraendert.
- ohne `+`: `setPrivateNumber(s, A, "01701234567")` -> throws (E164).
- Premium/nicht-DE: `setPrivateNumber(s, A, "+8881234567")` -> throws (countryAllowed).
- leeren: set gueltig -> `setPrivateNumber(s, A, "")` -> `tenantPrivateNumber` === null (Feld geloescht).
- fehlender Tenant: `setPrivateNumber(s, "ghost", "+49170…")` -> throws `/nicht gefunden/`.
- Reader-Grenzfall: `tenantPrivateNumber(s, "ghost")` === null (kein throw); Owner ohne Nummer -> null.
- `normalizePrivateNumber` direkt: gueltig -> normalisiert; Muell -> throw.
- `registerTenant(s, "t2", { privateNumber: "+491701234567" })` -> Record traegt `privateNumber`; mit `"abc"` -> throws; ohne -> Record ohne Feld; bestehender Tenant -> unveraendert (Idempotenz).

## Deterministisch pruefbar
`node --test test/f2-private-number.test.js` gruen; `npm test` insgesamt gruen.
