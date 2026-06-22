# F2 P2 — json-Facade: setPrivateNumber / tenantPrivateNumber in json.js

> Autoritative Scope-/Design-Definition fuer Phase F2-P2. Umbrella: `docs/strategy/f2-inbound-sms-summaries.md` (2.4, P2). **Basis: der finale Branch von F2-P1** (ops.setPrivateNumber/tenantPrivateNumber existieren — NICHT master).

## Ziel
Duenne json-Backend-Wrapper, exakt analog `setTenantStripe`/`tenantStripe` in `src/store/json.js`: Mutation -> `save()`, Query -> kein save. Kernlogik bleibt in `state-ops.js` (G5, kein Drift).

## Verifizierter Code-Stand (gegroundet — grep selbst)
Bestehendes Vorbild-Paar in `json.js`:
```js
export function setTenantStripe(tenantId, patch) {
  const tenant = ops.setTenantStripe(load(), tenantId, patch);
  save();
  return tenant;
}
export function tenantStripe(tenantId) {
  return ops.tenantStripe(load(), tenantId);
}
```
`ops` ist der Namespace-Import aus `state-ops.js`; `load()`/`save()` sind die json-Persistenz.

## Konkrete Edits in `src/store/json.js`
Neuer Block (bei den anderen Tenant-Record-Settern, z.B. nach `tenantStripe`):
```js
// ---- Private Nummer pro Tenant (F2) ----
// setPrivateNumber mutiert -> save (Muster setTenantStripe); tenantPrivateNumber ist
// reine Query (kein save, analog tenantStripe/kycReached).
export function setPrivateNumber(tenantId, raw) {
  const tenant = ops.setPrivateNumber(load(), tenantId, raw);
  save();
  return tenant;
}

export function tenantPrivateNumber(tenantId) {
  return ops.tenantPrivateNumber(load(), tenantId);
}
```

## WICHTIG — store.js-Bindung bewusst NICHT in dieser Phase (Scope + Korrektheit)
`src/store.js` bindet die Backend-Funktionen ueber eine explizite 43-Namen-Destrukturierung aus EINEM aktiven Backend (`json` ODER `pg`). Die store.js-Bindung von `setPrivateNumber`/`tenantPrivateNumber` gehoert NICHT in P2:
- **Korrektheit:** store.js bindet ein einzelnes Backend; die Bindung darf erst greifen, wenn BEIDE Backends (json=P2 UND pg=P3) die Methoden in master haben — sonst wirft der pg-Pfad zur Laufzeit (undefined). P2 und P3 sind Geschwister-Branches.
- **Scope (ABS_RULES):** Der Auftrag scopt P2 ausschliesslich auf `src/store/json.js` (+ Test). store.js ist KEIN P0-P3-Scope.
- **Konsequenz:** Die store.js-Bindung ist ein **Konsumenten-Schritt** und wird in der finishCall-Phase (P7) nachgezogen, wenn beide Backends in master sind. Das ist als Follow-up im Report zu vermerken.
- Die Tests dieser Phase importieren `json.js` DIREKT (Praezedenz: `test/state-ops-tenant-stripe.test.js` testet `jsonBackend.setTenantStripe` ohne store.js). Kein store.js noetig.

## Invarianten / Abgrenzung
- Wrapper bleiben duenn (keine Logik-Duplizierung, G5).
- `tenantPrivateNumber` ruft KEIN save() (reine Query).
- Scope: NUR `json.js` (+ Test). KEIN pg.js, KEIN schema.sql, KEIN store.js.

## Tests (neue Datei `test/f2-json-private-number.test.js`)
Muster wie der json-Roundtrip-Block in `test/state-ops-tenant-stripe.test.js` (`DATA_DIR` im `before` auf Temp via `tempDataDir()`, json.js dynamisch importieren):
- Round-Trip: `setPrivateNumber(OWNER_TENANT_ID, "+49 170 1234567")` -> `tenantPrivateNumber(OWNER_TENANT_ID)` === `"+491701234567"` (persistiert via save()).
- leeren: danach `setPrivateNumber(OWNER_TENANT_ID, "")` -> `tenantPrivateNumber` === null.
- Owner ohne Nummer initial -> `tenantPrivateNumber(OWNER_TENANT_ID)` === null.
- ungueltig: `setPrivateNumber(OWNER_TENANT_ID, "abc")` -> throws (Validierung schlaegt im ops-Kern durch).
- Export-Landmine: `typeof jsonBackend.setPrivateNumber === "function"` und `typeof jsonBackend.tenantPrivateNumber === "function"`.

## Deterministisch pruefbar
`node --test test/f2-json-private-number.test.js` gruen; `npm test` insgesamt gruen.
