# Spec AUTH-P6 — Betreiber-Routen auf Admin-Session heben

Autoritative Definition der Phase. Vorrang vor `PLAN-AUTH-GATE.md` (dort Abschnitt 7,
`### P6`). Was hier nicht steht, ist nicht Teil der Phase.

## Ziel: `webAuthMw` + `adminMw` vor sechs Betreiber-Routen

| Route | Datei | Was daran haengt |
| --- | --- | --- |
| `POST /api/onboard` | `src/routes/api-onboard.js` | kauft Nummern (Geld) |
| `POST /api/onboard/retry` | `src/routes/api-onboard.js` | kauft Nummern (Geld) |
| `POST /api/billing/flush-meters` | `src/routes/api-billing.js` | schickt Verbrauch an Stripe |
| `POST /api/billing/cost-truing/sweep` | `src/routes/api-billing.js` | Ist-Kosten-Abgleich |
| `GET /api/billing/cost-drift` | `src/routes/api-billing.js` | plattformweite Zahlen |
| `GET /api/billing/platform-costs` | `src/routes/api-billing.js` | plattformweite Zahlen |

`adminMw` (`src/web-auth.js`, `adminOnlyMiddleware`) prueft `role==='admin'` **oder**
`ADMIN_EMAILS`. `webAuthMw` laeuft davor — ohne Session gibt es 401, nicht 403.

**Nicht** `/api/tenant-data/export`: das hat in P5 `internalOnly` bekommen
(Plan-Entscheidung 1). Nicht neu aufrollen.

## Die harte Bedingung: lieber nicht gemountet als ungeschuetzt

`webAuthMw` und `adminMw` entstehen heute **nur** im `guardedBoot`-Block
(`src/wiring/web-login.js`), der an `sessionSecret && storeBackend === "pg"` haengt und
**fail-open** ist: wirft er, sind seine Routen nicht gemountet, aber der Rest lebt weiter.

Daraus folgt die Invariante dieser Phase:

> Stehen die Middlewares nicht zur Verfuegung, werden diese sechs Routen **gar nicht
> gemountet**. Sie duerfen unter keinen Umstaenden ohne sie gemountet werden.

Das ist kein Schoenheitsfehler-Handling, sondern die W6-Kopplung: ein verschluckter
`guardedBoot` wird dadurch zu einem **404** auf genau diesen Routen — und den wertet die
Live-Probe aus P2 als Durchfall. Das ist der Meldeweg. Waeren sie stattdessen
ungeschuetzt gemountet, waere derselbe Ausfall eine offene Tuer, die niemandem auffaellt.

## Zu messen, nicht zu raten: welche Schicht antwortet danach?

Die Mount-Position entscheidet, was ein anonymer externer Aufrufer **heute** (Gate steht
noch) sieht:

- bleibt der Mount **hinter** dem Basic-Auth-Gate, antwortet weiterhin das Gate mit
  401 + `WWW-Authenticate: Basic`;
- wandert er **vor** das Gate (in den Web-Login-Block), antwortet `webAuthGateMiddleware`
  mit 401 **ohne** Basic-Challenge.

Beides ist vertretbar. **Was nicht vertretbar ist, ist es nicht zu wissen.** Die Phase
entscheidet die Mount-Position bewusst, begruendet sie, und zieht die Spalte `ANTWORTET`
in `scripts/probe-auth.sh` fuer diese sechs Zeilen im **selben Commit** nach (H10). Ein
Test pinnt, welche Schicht antwortet — sonst faellt die Probe beim naechsten Deploy rot
aus und niemand weiss, ob das ein Defekt ist.

Empfehlung, sofern nichts dagegen spricht: **Mount-Position unveraendert lassen** (hinter
dem Gate). Das haelt die Staffelung Gate + Session bis P7 aufrecht und der Diff bleibt
klein.

## Was sich am Routen-Inventar aendert (im SELBEN Commit)

1. `src/route-policy.js`: die sechs Eintraege fallen aus `GATE_ONLY_ROUTES` — sie
   klassifizieren ab jetzt ueber `webAuthGateMiddleware`/`adminOnlyMiddleware` als `AUTH`.
   **Nach dieser Phase enthaelt `GATE_ONLY_ROUTES` nur noch das Legacy-Checkout-Paar**
   (`POST /api/billing/setup-checkout`, `GET /api/billing/checkout-return`), das erst in
   P9 faellt. Das ist der Zwischenstand, den P7 vorfindet.
2. `test/route-auth-inventory.test.js`: `ROUTE_FINGERPRINT` bleibt unveraendert (die
   Routen existieren weiter).
3. `scripts/probe-auth.sh`: Spalte `ANTWORTET` fuer die sechs Zeilen entsprechend der
   gewaehlten Mount-Position; `ART` bleibt `sitzung`, `STATUS` bleibt `401`.

## Abnahme (maschinell), je Route drei Faelle

1. **ohne Session** -> 401
2. **mit Nicht-Admin-Session** -> 403
3. **mit Admin-Session** -> Erfolg (die Route tut, was sie vorher tat)

Dazu:

4. Fehlen die Middlewares (kein `sessionSecret` / kein pg-Backend), sind die sechs Routen
   **nicht gemountet** -> 404. Als Test, nicht als Behauptung.
5. `npm test` gruen. Rot-vor-Fix: `adminMw` testweise entfernen -> genau der
   Nicht-Admin-403-Test wird rot. Mutation zuruecknehmen.

## Nicht-Ziele (bindend)

- **Kein** Anfassen von `src/wiring/auth-gate.js` (P7).
- **Keine** Aenderung an der Fachlogik der sechs Routen — nur die Sicherung davor.
- **Kein** Loeschen des Legacy-Checkout-Paars (P9, Karenz).
- **Keine** neue Env-Variable, **kein** neues Flag, **keine** neue Dependency.
  `ADMIN_EMAILS` existiert bereits und wird nur genutzt.

## Risiko, das benannt gehoert (Pre-Mortem)

Ein Jahr spaeter, die Entscheidung war falsch: der Owner kam nach einem Deploy nicht mehr
an das Onboarding — sein Account trug `role !== 'admin'` und stand nicht in
`ADMIN_EMAILS`, und weil `/api/onboard` die einzige Flaeche zum Anlegen neuer Tenants ist,
stand der Verkauf still.

Gegenmassnahme in dieser Phase: **vor** dem Merge feststellen und im Bericht festhalten,
ueber welchen Weg der Owner-Account heute als Admin gilt (`account.role` in der
Produktions-DB **oder** `ADMIN_EMAILS` in der Render-Env). Ist beides unklar, ist das ein
**Blocker** — nicht, weil der Code falsch waere, sondern weil der Deploy dann den Owner
aussperrt. Abbruchsignal live: Owner kommt nicht mehr an Onboarding.
