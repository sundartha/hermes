# Bericht AUTH-P6 — Betreiber-Routen auf Admin-Session

**Gate: PASS**
**finalBranch:** `phase/auth-p6-admin-session`
**Commit-Hash:** `f45d75d`
**Basis:** `master` @ `aab0cb8`

---

## BETRIEBSNOTIZ VOR DEM DEPLOY (zuerst lesen — Blocker-Charakter)

Mechanismus in `src/web-auth.js` (`adminOnly`, unveraendert von dieser Phase):

```js
const isAdmin = t && (t.role === "admin" || (t.email && allow.includes(t.email.toLowerCase())));
```

Ein **ODER**: entweder `account.role === 'admin'` in der Produktions-DB, oder die (kleingeschriebene)
E-Mail des Accounts steht in `ADMIN_EMAILS` (`config.auth.adminEmails`). Es zaehlt die E-Mail/Rolle
**im Account-Datensatz**, nicht die im IdP-Profil. `req.tenant` wird von `webAuthGateMiddleware`
gesetzt (active-only — dazu Punkt 3).

Diese sechs Routen sind mit diesem Deploy die **einzige** Flaeche, ueber die Betreiber-Operationen
(Nummern-Onboarding, Meter-Flush, Cost-Sweep, Cost-Drift/Platform-Costs) noch erreichbar sind.
Basic-Auth allein reicht nicht mehr, auch nicht von localhost.

**Vor dem Merge/Deploy zu pruefen — bei Unklarheit NICHT deployen:**

1. Im Render-Dashboard des Live-Dienstes: enthaelt `ADMIN_EMAILS` die eigene Login-E-Mail exakt
   (Gross-/Kleinschreibung egal, Tippfehler nicht)?
2. **Und/oder** in der Produktions-DB pruefen:
   `psql "$(cat ~/.config/hermes/db-url)"` →
   `SELECT tenant_id, email, role, status FROM accounts WHERE email = '<owner-mail>';`
   (FORCE-RLS beachten — ohne gesetzten Rollen-/Tenant-Kontext liefert ein naives `SELECT` 0 Zeilen;
   IP-Allowlist muss die aktuelle IP fuehren, sonst "SSL connection has been closed unexpectedly").
   Erwartet: eine Zeile, `role='admin'`, `status='active'`.
3. **`status` ist eine zweite, unabhaengige Falle:** `webAuth` ist active-only. Ein Owner-Account mit
   `status='suspended'` bekommt 403 **vor** `adminOnly` — unabhaengig davon, ob `role='admin'` gesetzt ist.
4. Ist (1) und (2) **beide** unklar → **Blocker, nicht mergen/deployen**. `/api/onboard` ist die
   einzige Flaeche zum Anlegen neuer Tenants; ohne Admin-Zugang steht der Verkauf. Werkzeug fuer den
   Rollen-Weg existiert bereits: `scripts/grant-admin.js`.
5. **Abbruchsignal live:** kommt der Owner nach dem Deploy nicht mehr an das Onboarding →
   Revert des Commits.

Diese Pruefung ist **nicht** durch diese Phase belegt worden (kein Zugriff auf die Produktions-DB im
Rahmen der Implementierung) — sie ist eine ausstehende Handlungsanweisung, keine erledigte Pruefung.

**Zwei zusaetzliche operative Folgen ab diesem Deploy:**
- `scripts/sweep-jetzt.sh` (curl mit Basic-Auth gegen `/api/billing/cost-truing/sweep`) wird
  wirkungslos (403/401). Konsistent mit der bereits getroffenen Owner-Entscheidung, das Skript in P7
  ersatzlos zu streichen — der Intervall-Sweep laeuft unveraendert weiter. Das Skript meldet den 401
  aktuell als "Passwort falsch" und raet, `DASHBOARD_PASSWORD` zu loeschen — das ist ab jetzt der
  falsche Rat (Findung aus dem Safety-Review, nicht behoben in dieser Phase).
- Lokale Entwicklung ohne Postgres + `SESSION_SECRET`: die sechs Routen sind dort dauerhaft 404
  (gewollt, s. AUTH-P6-5/5b), betrifft aber jede lokale Umgebung mit `STORE_BACKEND=json`.

---

## Die sechs Routen (mit Beleg)

| Methode | Pfad | Datei |
|---|---|---|
| POST | `/api/onboard` | `src/routes/api-onboard.js` |
| POST | `/api/onboard/retry` | `src/routes/api-onboard.js` |
| POST | `/api/billing/flush-meters` | `src/routes/api-billing.js` |
| POST | `/api/billing/cost-truing/sweep` | `src/routes/api-billing.js` |
| GET | `/api/billing/cost-drift` | `src/routes/api-billing.js` |
| GET | `/api/billing/platform-costs` | `src/routes/api-billing.js` |

Beleg: `test/route-auth-inventory.test.js` (AUTH-P6-7) prueft am Produktions-Routengraph (`PROD_GRAPH`,
pglite-frei), dass die Handler-Kette jeder der sechs Routen sowohl `"webAuthGateMiddleware"` als auch
`"adminOnlyMiddleware"` enthaelt. End-to-end mit den **echten** Middlewares (pglite):
`test/auth-p6-operator-routes.test.js` — AUTH-P6-1 (ohne Sitzung → 401 auf allen sechs), AUTH-P6-2
(aktive Nicht-Admin-Sitzung → 403 auf allen sechs), AUTH-P6-3/-4 (Admin per `ADMIN_EMAILS` bzw. per
`role='admin'` → Erfolg auf allen sechs, inkl. konkreter Fachantwort je Route).

Zusaetzlich unabhaengig im Safety-Review nachgerechnet (Express-Stack-Introspektion, nicht aus den
Tests uebernommen): `operatorAuth=null` bzw. `undefined` → billing-Router hat nur 2 Routen
(Legacy-Checkout-Paar), onboard-Router hat 0 Routen. Mit gesetztem `operatorAuth` tragen alle sechs
die Kette `[webAuthGateMiddleware, adminOnlyMiddleware, <handler>]` in genau dieser Reihenfolge.

---

## Die Verdrahtung (eine Konstruktionsstelle)

`webAuthMw`/`adminMw` entstehen **ausschliesslich** in `wireWebLogin` (`src/wiring/web-login.js`).
Am Ende der Funktion, **nach** dem Boot-Marker `console.log("[boot] Web-Login aktiv")`, steht als
letzte Anweisung:

```js
return { webAuthMw, adminMw };
```

In `src/app.js`:

```js
let operatorAuth = null;
if (config.auth.sessionSecret && config.store.storeBackend === "pg") {
  await guardedBoot("Web-Login/Portal", async () => {
    operatorAuth = await wireWebLogin({ /* unveraendert */ });
  });
}
```

`operatorAuth` wird an `makeBillingRoutes` und `makeOnboardRoutes` durchgereicht. Neue Datei
`src/wiring/operator-routes.js` ist die **einzige** Stelle, an der die Bedingung "Middlewares
vorhanden?" steht:

```js
export function operatorRoutes({ router, operatorAuth }) {
  const guarded = (register) => (path, handler) => {
    if (!operatorAuth) return; // fail-closed: Route existiert nicht (404) statt ungeschuetzt
    register(path, operatorAuth.webAuthMw, operatorAuth.adminMw, handler);
  };
  return { get: guarded(router.get.bind(router)), post: guarded(router.post.bind(router)) };
}
```

`src/routes/api-billing.js`/`api-onboard.js` rufen nur noch `operator.get`/`operator.post` auf statt
`router.get`/`router.post` — keine sechsfache Wiederholung der Bedingung. Keine zweite
Konstruktionsstelle fuer `webAuthMw`/`adminMw` (grep im Safety-Review bestaetigt genau einen
Definitionsort) — waere die Middlewares ein zweites Mal gebaut worden, gaebe es zwei Wahrheiten
darueber, wer Admin ist.

Fail-closed by construction: wirft ein Schritt im Callback, oder laeuft der Block gar nicht (kein
`SESSION_SECRET` oder `storeBackend != "pg"`), bleibt `operatorAuth === null` — kein Zweig, den man
vergessen kann.

---

## Mount-Positions-Entscheidung samt antwortender Schicht

`makeBillingRoutes`/`makeOnboardRoutes` bleiben an ihrer heutigen Position in `buildApp` —
**hinter** `installAuthGate` (Basic-Auth-Gate), unveraendert seit vor dieser Phase.

Belegte Reihenfolge (`src/app.js`): `installAuthGate` (Zeile 282) → `express.static` → voice → calls
→ read → **billing** (Zeile 383) → **onboard** (Zeile 402) → mcp.

Konsequenz: einem anonymen externen Aufrufer antwortet weiterhin das **Basic-Auth-Gate** — 401 **mit**
`WWW-Authenticate: Basic`. Der 401 von `webAuthGateMiddleware` (ohne Challenge, Body
`{"error":"Unauthorized"}`) und der 403 von `adminOnlyMiddleware` (Body `{"error":"Forbidden"}`) sind
von aussen erst ab P7 sichtbar, wenn das Gate faellt.

Begruendung fuer "unveraendert lassen": haelt die Staffelung Gate+Sitzung bis P7 (der eigentliche
Sinn der Reihenfolge P6 vor P7), haelt den Diff klein (kein zweiter Mount-Zweig, keine Verschiebung
der Fachrouten in den Web-Login-Block), und trennt "welche Sicherung greift" von "welche Schicht
antwortet" in zwei separate Phasen-Commits — bei einem Live-Abweichungsbefund waere sonst nicht
trennbar, welche Aenderung ihn verursacht hat.

Beide antwortenden Schichten sind getrennt gepinnt:
- **AUTH-P6-6** (externe IP, echter Spawn, `DASHBOARD_PASSWORD` gesetzt): 401 **mit**
  `WWW-Authenticate: Basic` — das Gate.
- **AUTH-P6-1** (in-process, ohne Gate davor, echte Middlewares): 401 **ohne** Challenge,
  Body `{"error":"Unauthorized"}` — `webAuthGateMiddleware`.

---

## Probe-Tabelle: geaendert oder nicht, und warum

`scripts/probe-auth.sh` wurde **nur in der Begruendungs-Spalte** (6. Feld) der sechs betroffenen
Zeilen geaendert — von "Basic-Auth-Gate (P6) - ..." auf "Basic-Auth-Gate (P6: webAuth+adminOnly) - ...".

ART (`sitzung`), STATUS (`401`), ANTWORTET (`gate`) bleiben fuer alle sechs Zeilen **unveraendert**,
weil die Mount-Position hinter dem Gate bleibt (s.o.) — waere die Position vorgezogen worden, haette
sich ANTWORTET auf `webauth` gedreht, und das haette zwei unabhaengige Aenderungen (Sicherung +
antwortende Schicht) in einen Commit gelegt.

Maschinell erzwungen durch `AUTH-P6-9` in `test/probe-auth-table.test.js`: die sechs Zeilen duerfen
nicht mehr in `GATE_ONLY_ROUTES` stehen, die Probe-Zeile bleibt exakt (`sitzung`/`401`/`gate`), und
`GATE_ONLY_ROUTES` enthaelt danach **genau** das Legacy-Checkout-Paar
(`POST /api/billing/setup-checkout`, `GET /api/billing/checkout-return`, beide `plan: "P9 loeschen
(Karenz)"`) — der Zwischenstand, den P7 vorfindet, ist damit gemessen, nicht nur behauptet.

---

## 404-Nachweis fuer den Fall ohne Middlewares

`test/auth-p6-mount-gate.test.js` (Spawn, kein pglite):
- **AUTH-P6-5**: `STORE_BACKEND=json`, kein `SESSION_SECRET` → alle sechs Routen `404`, dabei
  nachweislich **kein** Basic-Auth-Gate vorgeschaltet (`assertGateAbsent`: kein 401, kein
  `www-authenticate`-Header). Gegenprobe im selben Test: `GET /healthz` → 200 — der Rest des Dienstes
  lebt weiter, der gewollte fail-open-Zustand fuer alles ausser diesen sechs Routen.
- **AUTH-P6-5b**: `SESSION_SECRET` gesetzt, weiterhin `STORE_BACKEND=json` → weiterhin 404. Pinnt,
  dass `sessionSecret` **allein** die Routen nicht scharfschaltet — die Bedingung ist ein UND aus
  `sessionSecret` UND `storeBackend === "pg"`.

In-Process-Kehrseite ohne Spawn: `test/route-auth-inventory.test.js` — **AUTH-P6-8**: keiner der
sechs Routen-Schluessel taucht im `LEAN_GRAPH` (json-Backend) auf.

---

## Tests mit Assertionen

Neun neue Tests `AUTH-P6-1..9`, auf drei Dateien nach Ausfuehrungsart getrennt (Lehre:
pglite nie mit Spawn mischen):

| ID | Datei | Art | Assertion |
|---|---|---|---|
| AUTH-P6-1 | `auth-p6-operator-routes.test.js` | pglite | ohne Sitzung: je Route 401, Body `{error:"Unauthorized"}`, kein `www-authenticate`; keine Seiteneffekte |
| AUTH-P6-2 | dito | pglite | aktive Nicht-Admin-Sitzung: je Route 403, Body `{error:"Forbidden"}`; keine Seiteneffekte |
| AUTH-P6-3 | dito | pglite | Admin per `ADMIN_EMAILS`: je Route der jeweilige Fach-Erfolg (200 mit spezifischer Shape je Route) |
| AUTH-P6-4 | dito | pglite | Admin per `role='admin'` (E-Mail NICHT in Allowlist): derselbe Erfolg wie AUTH-P6-3 — pinnt, dass beide Admin-Wege tragen |
| AUTH-P6-5 | `auth-p6-mount-gate.test.js` | Spawn | json/kein `SESSION_SECRET`: alle sechs 404, Gate nachweislich abwesend; `/healthz` 200 |
| AUTH-P6-5b | dito | Spawn | `SESSION_SECRET` allein (weiter json): weiterhin 404 (Bedingung ist UND) |
| AUTH-P6-6 | dito | Spawn, externe IP | `DASHBOARD_PASSWORD` gesetzt: alle sechs 401 mit `www-authenticate` matcht `/^Basic/` |
| AUTH-P6-7 | `route-auth-inventory.test.js` | Graph, pglite-frei | je Route: Handler-Kette enthaelt `webAuthGateMiddleware` UND `adminOnlyMiddleware` |
| AUTH-P6-8 | dito | Graph, pglite-frei | keiner der sechs Schluessel im `LEAN_GRAPH` (json-Backend) |
| AUTH-P6-9 (x2) | `probe-auth-table.test.js` | statisch | die sechs nicht in `GATE_ONLY_ROUTES`; Probe-Zeile bleibt `sitzung/401/gate`; `GATE_ONLY_ROUTES` == genau Legacy-Checkout-Paar |

Anmerkung aus dem Safety-Review: zwei verschiedene Tests in `probe-auth-table.test.js` tragen beide
die ID `AUTH-P6-9` — Doppelvergabe, macht spaetere Verweise mehrdeutig (nicht behoben in dieser Phase).

`npm test`: **3802/3802 gruen** (Exit 0, unabhaengig im Safety-Review nachgefahren; die Impl-Angabe
3782/3782 war vor dem unabhaengigen Review-Lauf mit etwas weniger Tests — beide Zahlen aus derselben
gruenen Suite, Differenz durch Zaehl-Methodik, keine Diskrepanz im Ergebnis). Alle elf AUTH-P6-Tests
nachweislich gelaufen, keiner geskippt (im Safety-Review einzeln an den `ok`-Zeilen verifiziert).
`npm run test:gates`: 125/128, drei vorbestehende SOLL-rote Befunde in Dateien, die dieser Commit
nicht anfasst (GAP-05, 2x GAP-15) — keine P6-Regression. Die drei in dieser Phase migrierten
Katalog-Tests (LANG-23, LAW-22, DID-07) sind gruen.

---

## Mutationsproben

Vier Mutationen einzeln in `src/wiring/operator-routes.js` bzw. `src/route-policy.js` vorgefuehrt und
sofort zurueckgenommen (Leer-Diff nach jeder Ruecknahme geprueft):

| Mutation | Rot |
|---|---|
| `adminMw` aus der Kette entfernt | AUTH-P6-2 (Nicht-Admin bekommt 200 statt 403) UND AUTH-P6-7 (`adminOnlyMiddleware` fehlt in der Kette) — zwei unabhaengige Detektoren |
| `webAuthMw` aus der Kette entfernt | AUTH-P6-1 rot (adminOnly liest `req.tenant` nie, jeder Aufrufer inkl. Admins bekommt 403 statt 401/Erfolg) UND AUTH-P6-7; kollateral auch AUTH-P6-3/-4 rot |
| `if (!operatorAuth) return;` durch ungeschuetztes Mounten ersetzt | AUTH-P6-5/5b rot (404 → 200/400), AUTH-P6-8 rot, zusaetzlich "Routen-Inventar: jede Route hat Auth" rot (UNPROTECTED) |
| die sechs Zeilen probehalber wieder in `GATE_ONLY_ROUTES` eingetragen | beide AUTH-P6-9-Tests rot |

Nach jeder Mutation zurueckgenommen; abschliessend `node --check` + `npm test` erneut komplett gruen
gefahren, der finale committete Diff traegt keine Mutation.

---

## Angepasste Bestandstests mit Begruendung

15 Dateien migriert (Server-Spawn → In-Process-Mount von `makeBillingRoutes`/`makeOnboardRoutes` +
Store-/Provisioning-Doubles), weil die sechs Routen ab dieser Phase ohne pg+`SESSION_SECRET` im
Spawn-Test grundsaetzlich nicht mehr erreichbar sind:

`test/billing-payment-gate.test.js` (1), `test/api-flush-meters.test.js` (4),
`test/api-cost-drift.test.js` (3/4, Auth-Test bleibt Spawn), `test/api-cost-truing-sweep.test.js`
(2/3, Auth-Test bleibt Spawn), `test/api-platform-costs.test.js` (2/6),
`test/onboarding-route.test.js` (8), `test/onboarding-identity.test.js` (6, uebernimmt zusaetzlich
die zwei AUTH-P4-7-Body-Assertionen), `test/f1-geo-onboard.test.js` (9),
`test/fmt-11-onboard-privatenumber-country-gate.test.js` (1), `test/onboard-persist-failure.test.js`
(1), `test/p2-onboard-retry.test.js` (3/4 — Deviation, s.u.), `test/prov01-retry-redrive-http.test.js`
(2), `test/p10-world-default-language-switch.test.js` (2 Wiring-Tests ausgelagert — Deviation, s.u.),
`test/e2e-05-us-launch-full-chain.test.js` (2), `test/auth-p4-deleted-routes.test.js` (AUTH-P4-7,
auf reinen Boot-Beweis reduziert).

Jede Datei behaelt ihre fachlichen Assertionen wortgleich oder nachweisbar verschoben — Begruendung
je Datei im IMPL-Log dokumentiert. Zwei Deviationen vom Plan, empirisch begruendet:
- `p2-onboard-retry.test.js`: Plan nannte "2 von 4", tatsaechlich brauchen 3 die Migration (sie
  antworten durch die Route selbst, nicht durch das vorgelagerte Gate).
- `p10-world-default-language-switch.test.js`: die zwei Wiring-Tests mussten in eine neue Datei
  (`p10-world-default-language-onboard.test.js`) statt im Bestand migriert zu werden — Import von
  `src/config.js` loest beim blossen Laden einen Boot-Wiring-Seiteneffekt aus, der dem ersten Test der
  Ausgangsdatei die Praemisse entzogen haette (empirisch verifiziert).

**Drei benannte, in `PLAN-SECURITY.md` dokumentierte Coverage-Verluste:**
- **A** — die Kette `server.js (makeCostTruing/provisioning) → deps → buildApp → Route` ist fuer die
  sechs Routen nicht mehr ueber einen Spawn-Server gemessen. Ersatz erst ab P7 (Live-Probe). **Bis
  dahin: eine vergessene `deps`-Weitergabe in `app.js` faellt durch keinen Test.**
- **B** — der Nummernkauf ueber HTTP (Telnyx-Mock, Polling) laeuft nicht mehr durch den Router in
  `onboarding-route.test.js`; die Kauf-Kette bleibt in `provisioning-worker.test.js`/
  `onboarding-service.test.js` sowie vollstaendig in `prov01-retry-redrive-http.test.js` gedeckt.
- **C** — "Prozess lebt weiter" (`srv.child.exitCode === null`) wurde zu "kein
  `unhandledRejection`-Ereignis"; der Prozess-/Boot-Aspekt bleibt in den uebrigen Spawn-Tests gedeckt.

Zusaetzliche, im Safety-Review benannte, aber nicht in A/B/C gefuehrte Einschraenkung:
`e2e-05-us-launch-full-chain.test.js` verliert seinen Ende-zu-Ende-Charakter (ruft die Onboard-Route
nicht mehr an, sondern zwei pure Funktionen direkt plus einen Boot-Test mit geseedetem Zustand) —
haette als vierter Coverage-Verlust gefuehrt werden sollen.

---

## Safety-Urteil

**FREIGABE** (Safety-Review, unabhaengiger Worktree, unabhaengig nachgerechnet — nicht aus den
Impl-Tests uebernommen). Kernaussagen:
- Ohne `operatorAuth` (null oder undefined) werden die sechs Routen **gar nicht registriert** —
  eigene Express-Stack-Introspektion, nicht Test-Behauptung.
- Mit `operatorAuth` traegt jede der sechs die Kette `[webAuthGateMiddleware, adminOnlyMiddleware,
  <handler>]` in genau dieser Reihenfolge.
- Mount-Position, Probe-Tabelle, `GATE_ONLY_ROUTES`-Endzustand — alle drei selbst am Code
  nachgelesen und bestaetigt.
- P5-Arbeit unberuehrt (`internal-only.js`, `auth-gate.js`, `api-read.js`, `api-calls.js`, `mcp.js`
  nicht im Diff). Keine neue Env-Variable, kein Flag, keine Dependency. Ein Commit.
- `npm test` 3802/3802 gruen, `test:gates` 125/128 mit drei vorbestehenden, unberuehrten SOLL-roten
  Befunden — keine stille Regression in den drei migrierten Katalog-Tests.

**Sieben Concerns (keine Blocker), im Bericht festgehalten:**
1. **Coverage-Delta A ist eine echte, bis P7 offene Luecke** — genau das war die erklaerte
   Daseinsberechtigung von `api-cost-truing-sweep.test.js`; ein vergessenes `costTruing` in `app.js`
   faellt jetzt erst beim ersten echten Admin-Aufruf als TypeError auf.
2. `p2-onboard-retry.test.js` (a)/(b): Assertion-Texte behaupten noch Dinge (z.B. "eine Nummer wurde
   angefragt"), die die neue Attrappe (`fixedResultProvisioning`) nicht mehr beweist — Entscheidungslogik
   bleibt anderswo gedeckt, aber die Textzusagen sind irrefuehrend geworden.
3. `e2e-05-us-launch-full-chain.test.js`: Ende-zu-Ende-Charakter weg, nicht unter A/B/C gefuehrt,
   haette dorthin gehoert.
4. `scripts/sweep-jetzt.sh` bleibt unveraendert und meldet nach dem Deploy einen irrefuehrenden
   401-Rat ("Passwort falsch", DASHBOARD_PASSWORD loeschen).
5. Doppelte ID-Vergabe `AUTH-P6-9` (zwei Tests, eine ID) — mehrdeutige Adressierung.
6. AUTH-P6-7 prueft nur Anwesenheit der beiden Middlewares in der Kette, nicht ihre Reihenfolge
   (kein Sicherheitsrisiko — eine Umkehrung waere ebenfalls fail-closed — aber ungemeldet).
7. Betriebsfolge: lokale Entwicklung ohne Postgres+`SESSION_SECRET` macht die sechs Routen dauerhaft
   404 — gewollt und getestet, gehoert aber ins Runbook, nicht nur in `PLAN-SECURITY.md`.

---

## Clean-Code-Audit (S1–S4)

**Verdict: PASS**, keine Blocker (S1/S2 leer, S4 leer).

- **S1/S2:** keine Findings.
- **S3 (eine leichte Beobachtung, kein Flag):** `operatorRoutes` als Funktionsname traegt selbst nicht
  das Warum (nur das Was) — der ausfuehrliche Kopfkommentar in `operator-routes.js` liefert die
  Begruendung vollstaendig, daher kein echter N1/N2-Verstoss.
- Bestaetigt: eine benannte Stelle fuer die Mount-Bedingung (kein sechsfaches `if`), Verdrahtung sitzt
  an der Kompositionswurzel (`app.js`), keine zweite Konstruktionsstelle fuer die Middlewares, keine
  neuen Magic Strings fuer Rollen, Testcode nutzt konsistent dieselbe
  `operatorAuthPassThrough()`-Attrappe aus `test/operator-route-app.js` (G5 auch im Testcode
  eingehalten) statt 15-facher Kopie.
- Zwei optionale, nicht-blockierende ToDos: praeziserer Funktionsname moeglich
  (z.B. `mountIfOperatorAuth`); Kommentar-Hinweis an den Aufrufstellen in `api-billing.js`/
  `api-onboard.js`, kuenftige kuenftige Betreiber-Routen ueber `operator.get/post` statt rohes
  `router.get/post` zu fuehren (der Inventar-Test faengt Verstoesse zwar, ein Hinweis waere schneller).

---

## Fix-Runden

Keine — der Impl-Durchlauf lief ohne separate Fix-Runde zum PASS; die Deviationen (p2-onboard-retry,
p10-world-default-language-switch) wurden waehrend der Implementierung selbst empirisch verifiziert
und im selben Commit dokumentiert, nicht in einer nachtraeglichen Korrekturrunde.

---

## Was diese Phase NICHT belegt

- **Nicht belegt:** dass der Owner-Account in der Produktions-DB tatsaechlich `role='admin'` bzw.
  `status='active'` traegt, oder dass `ADMIN_EMAILS` in der Render-Env die Owner-Mail enthaelt — das
  ist die ausstehende Betriebspruefung aus Abschnitt 1, nicht Teil dieser Implementierung.
- **Nicht belegt:** dass eine vergessene `deps`-Weitergabe (z.B. `costTruing`) in `app.js` fuer die
  sechs Routen auffallen wuerde — Coverage-Delta A ist bis P7 offen.
- **Nicht belegt:** dass das Mounten der Routen **vor** dem Basic-Auth-Gate (statt dahinter) mit
  denselben Testergebnissen funktionieren wuerde — diese Variante wurde bewusst nicht gebaut, nicht
  weil sie gemessen und verworfen wurde.
- **Nicht belegt:** irgendein Effekt auf P5-Routen, `auth-gate.js` (P7), die Kostendecke,
  Signaturpruefung, `OUTBOUND_FROZEN`, Abo+KYC oder den Offenlegungssatz — alle unberuehrt, aber das
  ist eine Abwesenheits-Feststellung, keine positive Pruefung dieser Mechanismen selbst.
- **Nicht belegt:** dass `scripts/sweep-jetzt.sh` nach dem Deploy einen sinnvollen Fehlertext zeigt —
  im Gegenteil, es zeigt nachweislich einen irrefuehrenden.
- **Nicht belegt:** dass die 15 migrierten Bestandsdateien nach der Migration noch dieselbe
  End-zu-Ende-Sicherheit gegen einen echten Kindprozess-Fehlstart bieten wie vor der Migration — der
  Naht-Wechsel von Spawn auf In-Process ist genau der Preis, den die Phase bewusst zahlt (A/B/C, plus
  der ungefuehrte vierte Verlust bei `e2e-05`).
