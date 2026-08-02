# Spec AUTH-P7 — das Gate entfernen (das eigentliche Delta)

Autoritative Definition der Phase. Vorrang vor `PLAN-AUTH-GATE.md` (dort Abschnitt 7,
`### P7`). Was hier nicht steht, ist nicht Teil der Phase.

**Diese Phase ist GENAU EIN Commit.** Sie darf nicht in Teil-Commits zerfallen: ein
Rollback muss den Gate-Wegfall als Ganzes zuruecknehmen koennen.

## Vorbedingung, hart

P3, P4, P5, P6 gemergt und gruen. `GATE_ONLY_ROUTES` in `src/route-policy.js` muss beim
Abschluss dieser Phase **leer** sein — das ist die maschinelle Fassung von "das Gate darf
erst fallen, wenn nichts mehr allein an ihm haengt".

## Auflösung eines Konflikts im Plantext (Owner-relevante Abweichung)

Der Plan sagt an zwei Stellen Unvereinbares:

- P7 darf erst laufen, wenn `GATE_ONLY_ROUTES` leer ist.
- P9 loescht das Legacy-Checkout-Paar (`POST /api/billing/setup-checkout`,
  `GET /api/billing/checkout-return`) **fruehestens 30 Tage nach dem Live-Deploy von
  P7** — bis dahin stehen die beiden also noch in der Liste.

Beides zusammen ist nicht erfuellbar. **Auflösung: die beiden Routen bekommen in dieser
Phase `internalOnly`** (dieselbe Middleware wie die sieben aus P5, kein neuer
Mechanismus) und fallen damit aus `GATE_ONLY_ROUTES` in die Klasse `AUTH`. Geloescht
werden sie weiterhin erst in P9.

Warum das nichts kaputt macht: **AUTH-P3 hat diese beiden Routen fuer externe Aufrufer
bereits stillgelegt** — sie rufen `requireTenant`, und das liefert seit P3 fuer jeden
nicht-lokalen Aufrufer `TENANT_REJECT` -> 403. Ein aus Stripe zurueckkehrender Browser
kam ausserdem noch nie durch: ohne Basic-Credentials beantwortete das Gate ihn mit 401.
Die 30-Tage-Karenz schuetzt also einen Pfad, der faktisch schon zu ist; `internalOnly`
macht denselben Zustand nur sichtbar und maschinell pruefbar. Der Loeschtermin bleibt
unveraendert bei P9.

## Was faellt

**Loeschen:**

- `src/wiring/auth-gate.js` (die Middleware-Fabrik samt Exemption-Liste)
- `test/auth-gate-exemption-order.test.js` (durch den P1-Inventar-Test ersetzt)
- `scripts/sweep-jetzt.sh` **ersatzlos** (Plan-Entscheidung 3 — das Skript existiert nur,
  weil es Basic-Auth-Credentials braucht)

**Aendern:**

- `src/app.js`: `installAuthGate` (Funktion, Import, Aufruf) verschwindet
- die Testdateien, die das Gate voraussetzen — der Plan zaehlt **18** (16 `*.test.js`
  plus `test/helpers.js` und `test/prod-env.js`). **Diese Zahl ist zu pruefen, nicht zu
  glauben**: greppe selbst nach `DASHBOARD_PASSWORD`, `Authorization: Basic`,
  `WWW-Authenticate` und `auth_failed` unter `test/`.
- `README.md`, `CLAUDE.md` (Absolute Regel 3 in der Neufassung aus Plan-Abschnitt 9,
  ausserdem die `public/`-Beschreibung), die Modulkommentare, die noch "hinter
  Basic-Auth" behaupten

**`DASHBOARD_PASSWORD` BLEIBT** in `src/config.js`, `render.yaml` und `.env.example` —
ungenutzt, aber gesetzt. Das ist kein Versehen: ein Rollback auf einen Commit vor P7
findet damit ein scharfes Gate vor. Entfernt wird die Variable erst in P8, fruehestens
14 Tage nach dem Live-Deploy dieser Phase.

## Was dazukommt: die sieben Umleitungen (Owner-Entscheidung 2026-08-02)

| Pfad | Ziel |
| --- | --- |
| `/login`, `/signin`, `/sign-in` | 302 `/auth/login` |
| `/dashboard`, `/account`, `/portal`, `/admin` | 302 `/app` |

Das war der urspruengliche Ausloeser des ganzen Plans: wer die URL tippt, soll im Login
landen statt in einer Basic-Auth-Sackgasse. Mount **vor** dem statischen Serving, Muster
wie `LEGACY_PORTAL_PATH`; Pfade als benannte Konstanten in `src/portal-paths.js` (kein
Magic-String, G25). Die Ziele sind bereits benannte Konstanten — wiederverwenden, nicht
neu schreiben.

## Was sich am Routen-Inventar aendert (derselbe Commit)

1. `src/route-policy.js`
   - `GATE_ONLY_ROUTES` wird **leer** (die beiden Legacy-Routen wandern ueber
     `internalOnly` in die Klasse `AUTH`). Der Block-Kommentar wird auf den neuen Stand
     gebracht: die Liste bleibt als **Mechanismus** stehen, damit eine kuenftige Route
     nicht still wieder allein an einer Sammelsicherung haengt.
   - Die sieben Umleitungen kommen als neue Eintraege in `PUBLIC_ROUTES`, jeder mit
     Begruendung (sie liefern nur einen 302 und tragen keine Daten).
2. `test/route-auth-inventory.test.js`: `ROUTE_FINGERPRINT` waechst um die sieben
   Umleitungen.
3. `scripts/probe-auth.sh` — hier passiert das meiste, und **hier zeigt sich, ob der
   Umbau gelungen ist**:
   - Der Vorgabe-Modus wechselt von `ist-aufnahme` auf `nach-p7`. Ab jetzt gilt:
     **`WWW-Authenticate: Basic` darf auf KEINER Antwort mehr stehen.**
   - Die Spalte `ANTWORTET` bekommt den Wert `internal` (fuer `internalOnly`); der Wert
     `gate` verschwindet aus der Tabelle **vollstaendig**. Beides auch in
     `test/probe-auth-table.test.js` nachziehen.
   - Die neun `internalOnly`-Routen (sieben aus P5 + die zwei Legacy-Billing-Routen):
     `401` -> **`403`**, `gate` -> `internal`.
   - Die sechs P6-Routen: `gate` -> `webauth` (Status bleibt 401), falls P6 die
     Mount-Position hinter dem Gate belassen hat.
   - Die `fehlt`-Zeilen (die sechs in P4 geloeschten Routen sowie
     `/diese-route-gibt-es-nicht-12345`): `401` -> **`404`**, `gate` -> `keine`.
   - `/login` und `/dashboard` sind keine `fehlt`-Zeilen mehr, sondern
     `oeffentlich | 302 | keine`; die fuenf weiteren Umleitungen kommen dazu.
   - **Jede dieser Zeilen ist eine Vorhersage.** Sie werden aus dem Code abgeleitet und
     mit dem Live-Lauf nach dem Deploy geprueft — nicht nachtraeglich an das Ergebnis
     angepasst.

## Abnahme (maschinell)

1. `npm test` gruen, inklusive P1-Inventar-Test.
2. `grep -rn "WWW-Authenticate" src/` -> **leer**.
3. `grep -rn "makeAuthGate\|installAuthGate" src/ test/` -> **leer**.
4. Ein Spawn-Test weist nach: `/api/state` ohne Sitzung -> **403** (nicht 401, nicht
   200); ein unbekannter Pfad -> **404**; `/login` -> 302 auf `/auth/login`;
   `/dashboard` -> 302 auf `/app`. Keine dieser Antworten traegt `WWW-Authenticate`.
5. `GATE_ONLY_ROUTES` ist leer — als Assertion im Test, nicht per Augenschein.
6. **Nach dem Live-Deploy** (Owner-Handlung): `scripts/probe-auth.sh <url> <sha> nach-p7`
   -> Exit 0. Das ist der eigentliche Abnahme-Nachweis dieser Phase und kann in der
   Umsetzungs-Session **nicht** erbracht werden.

## Abbruchsignal live

Die Probe meldet **200 auf `/api/state` ohne Sitzung** -> sofortiger Rollback
(Datenleck-Fall). Rollback = Deploy des Vorgaenger-Commits; das alte Gate findet
`DASHBOARD_PASSWORD` noch vor und ist sofort wieder scharf.

## Nicht-Ziele (bindend)

- **Kein** Entfernen von `DASHBOARD_PASSWORD` (das ist P8, nach 14 Tagen Karenz und
  gruenem Rollback-Drill).
- **Kein** Loeschen des Legacy-Checkout-Paars (das ist P9, nach 30 Tagen).
- **Keine** Cache-Header (P9).
- **Keine** neue Env-Variable, **kein** neues Flag, **keine** neue Dependency.
- Keine Fachlogik-Aenderung an irgendeiner Route.

## Risiko, das benannt gehoert (Pre-Mortem)

Ein Jahr spaeter, die Entscheidung war falsch: nach dem Deploy stand eine Route offen,
die niemand auf der Rechnung hatte — sie war weder in `PUBLIC_ROUTES` noch trug sie eine
Middleware, aber der Inventar-Test sah sie nicht, weil ihre Sicherung im Handler sass und
jemand sie dort entfernt hatte. Das Gate haette das gedeckt; ohne Gate deckt es niemand.

Gegenmassnahme: der quartalsweise Pruefpunkt in `docs/RUNBOOK-AUTH-REVIEW.md` traegt genau
diese drei blinden Flecken — und die Live-Probe laeuft **nach jedem Deploy**, nicht nur
nach diesem. Beides steht schon; diese Phase muss es nur nicht kaputt machen.
