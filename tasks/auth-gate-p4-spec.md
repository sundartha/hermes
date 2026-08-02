# Spec AUTH-P4 — tote, aber scharfe Routen loeschen

Autoritative Definition der Phase. Vorrang vor `PLAN-AUTH-GATE.md` (dort Abschnitt 7,
`### P4`). Was hier nicht steht, ist nicht Teil der Phase.

## Warum diese Phase VOR dem Gate-Wegfall liegt

`/api/profiles` und `POST /api/action-items/:id/toggle` rufen den Tenant-Resolver
**gar nicht** auf. AUTH-P3 (Bootstrap-Fallback fail-closed) deckt sie deshalb **nicht** —
zwei unabhaengige Loecher, zwei Phasen.

Faellt das Gate vor dieser Phase, steht ein anonymes Schreibfenster offen, ueber das ein
`POST /api/profiles {"unrestricted":true}` das Verifikations-Gate in
`src/outbound-gates.js` aushebeln koennte: Outbound ohne Abo und ohne KYC. Das ist der
Grund fuer die Reihenfolge, nicht Ordnungsliebe.

## Ziel: sechs Routen ersatzlos entfernen

| Route | Datei |
| --- | --- |
| `POST /api/settings` | `src/routes/api-tenant-write.js` |
| `POST /api/action-items/:id/toggle` | `src/routes/api-tenant-write.js` |
| `POST /api/calendar` | `src/routes/api-tenant-write.js` |
| `GET /api/profiles` | `src/routes/api-profiles.js` |
| `POST /api/profiles` | `src/routes/api-profiles.js` |
| `DELETE /api/profiles/:tenantId` | `src/routes/api-profiles.js` |

Beide Dateien entfallen vollstaendig, ebenso ihre Mounts in `src/app.js`
(`makeTenantWriteRoutes`, `makeProfileRoutes`) samt Importen.

**Pflicht-Umzug, sonst bricht der Boot:** `validIdentity` und `IDENTITY_MAX_LEN` werden
von `src/routes/api-onboard.js` aus `api-profiles.js` importiert. Sie ziehen nach
`src/routes/_validation.js` (neue Datei, Namenskonvention wie `_tenant.js`). Der Import
in `api-onboard.js` wird nachgezogen. Wer die Datei loescht, ohne den Umzug zu machen,
faellt beim Serverstart auf die Nase — und `npm test` faengt das, wenn ein Spawn-Test
laeuft.

**Der Profil-Mechanismus bleibt unangetastet:** `PROFILES_JSON`-Seed, `resolveProfile`,
`src/outbound-gates.js`. Es faellt **nur** die HTTP-Schreibflaeche.

## Owner-Entscheidung, bewusst in Kauf genommen (Plan-Entscheidung 4)

Mit `POST /api/settings` faellt die einzige HTTP-Schreibflaeche fuer Settings-Felder
**ausserhalb** der engeren Self-Service-Whitelist (`src/self-service.js`). Solche Felder
sind danach nur noch per direktem DB-Eingriff aenderbar. **Der Owner hat das ausdruecklich
akzeptiert.** Das ist keine offene Frage und wird nicht neu aufgerollt.

## Mitzufuehren im SELBEN Commit (H10 — die Erwartung wandert mit der Phase)

Eine geloeschte Route verschwindet an **vier** Stellen, sonst widersprechen sich die
Sicherungen:

1. `src/route-policy.js` — die sechs Eintraege aus `GATE_ONLY_ROUTES` entfernen.
   Sie wandern **nicht** nach `PUBLIC_ROUTES`.
2. `test/route-auth-inventory.test.js` — `ROUTE_FINGERPRINT` um die sechs Zeilen
   kuerzen. Der Test verlangt genau diese bewusste Aktualisierung; das ist Absicht.
3. `scripts/probe-auth.sh` — die sechs Zeilen von `sitzung` auf `fehlt` drehen.
   **Erwarteter Status bleibt 401**, `ANTWORTET` bleibt `gate`: das Basic-Auth-Gate
   haengt vor dem 404-Handler und maskiert die geloeschte Route am heutigen Deploy
   weiterhin mit 401. Erst P7 dreht diese Zeilen auf 404. Die Zeilen werden **nicht
   geloescht** — als Negativkontrolle sind sie mehr wert denn je: taucht eine geloeschte
   Schreibroute je wieder auf und antwortet 200, faellt genau hier auf.
4. `docs/RUNBOOK-AUTH-REVIEW.md` — nur, falls dort eine der Routen namentlich steht.

`test/probe-auth-table.test.js` haelt (1) und (3) zusammen. Wird eine der vier Stellen
vergessen, ist `npm test` rot. Das ist der Mechanismus, nicht ein Hindernis.

## Abnahme (maschinell)

1. `POST /api/profiles` -> **404**, `POST /api/settings` -> **404**,
   `POST /api/action-items/:id/toggle` -> **404**, `POST /api/calendar` -> **404**,
   `GET /api/profiles` -> **404**, `DELETE /api/profiles/x` -> **404**.
   Im Spawn-Test ist das direkt sichtbar (dort ist kein `DASHBOARD_PASSWORD` gesetzt,
   das Gate ruft `next()`).
2. Server startet ohne Import-Fehler (`node --check` je geaenderter Datei + ein
   Spawn-Test, der wirklich bootet).
3. `POST /api/onboard` funktioniert unveraendert — es nutzt `validIdentity` nach dem
   Umzug.
4. `npm test` gruen, inklusive des bewusst aktualisierten Fingerprints.

## Nicht-Ziele (bindend)

- `POST /api/billing/setup-checkout` und `GET /api/billing/checkout-return` bleiben
  **stehen** — sie fallen erst in P9, fruehestens 30 Tage nach dem Live-Deploy von P7
  (eine vor dem Deploy geoeffnete Stripe-Session traegt die alte Rueckkehr-Adresse).
- Kein `internalOnly` (P5), kein `webAuthMw`/`adminMw` (P6), kein Anfassen von
  `src/wiring/auth-gate.js` (P7).
- Keine neue Env-Variable, kein neues Flag, keine neue Dependency.
- Der Profil-Mechanismus selbst (`resolveProfile`, `PROFILES_JSON`,
  `src/outbound-gates.js`) wird **nicht** angefasst.

## Risiko, das benannt gehoert (Pre-Mortem)

Ein Jahr spaeter, die Entscheidung war falsch: ein Betriebsvorgang, der still ueber
`POST /api/settings` lief, ist weggebrochen — und weil er selten war, fiel es erst auf,
als er gebraucht wurde. Gegenmassnahme in dieser Phase: **jeden** Aufrufer der sechs
Routen enumerieren (grep ueber `src/`, `scripts/`, `apps/web/src/`, `public/`,
`test/`, `src/mcp-tools.js`) und das Ergebnis in den Bericht schreiben. Ein gefundener
lebender Aufrufer ist ein **Blocker**, kein Detail — dann stimmt die Praemisse "tot"
nicht mehr und der Owner entscheidet neu.
