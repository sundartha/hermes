# Phase AUTH-P3 — Bootstrap-Fallback fail-closed (B2, der offene Boden)

**Gate: PASS**
**finalBranch:** `phase/auth-p3-bootstrap-fail-closed`
**Commit-Hash:** `8baf654`

## Was diese Phase am heutigen Deploy sichtbar aendert

**Nichts — fuer jeden im Repo belegbaren Konsumenten.** Das Basic-Auth-Gate
(`installAuthGate`) haengt in `src/app.js` vor allen `/api`-Routern und
antwortet externen Requests ohne gueltige Credentials weiterhin zuerst mit
401 — bevor der Tenant-Resolver ueberhaupt laeuft. Diese Phase zieht **den
Boden ein, auf dem P7 stehen wird** (das Basic-Gate faellt erst dort): sie
stellt sicher, dass der Tenant-Resolver selbst — unabhaengig vom Gate —
fail-closed ist, falls das Gate je fehlt, umgangen wird oder faellt. Am
heutigen, live laufenden Verhalten aendert sich dadurch nichts Messbares:

- `/mcp` ist gate-exempt, laeuft aber live nachweislich unter `MCP_AUTH=oauth`
  (2026-08-02 gemessen: der 401 samt `www-authenticate: Bearer
  resource_metadata=…` stammt ausschliesslich aus `verifyOauth`) — `req.auth`
  ist gesetzt, der von P3 geaenderte Zweig wird gar nicht betreten.
- `/voice/*` und `/webhooks/stripe` rufen den Tenant-Resolver nicht.
- Web-Sessions laufen ueber `webAuthMw`/`req.tenant`, nicht ueber den
  Resolver.
- Der einzige lebende externe Credential-Nutzer (`scripts/sweep-jetzt.sh`)
  zielt auf eine Route ohne Resolver.

Einzige benannte Ausnahmeklasse: ein Betreiber-`curl` **von aussen mit
gueltigen Basic-Credentials** gegen eine Resolver-Route (`/api/state`,
`/api/tenant-data/export`, `POST /api/settings`, …) bekaeme jetzt weniger/
andere Daten (403 statt Owner-Daten). Dafuer existiert kein Skript und kein
Code-Aufrufer im Repo — es ist der ausdrueckliche Zweck der Phase.

## Die Aenderung — `src/routes/_tenant.js`, eine Bedingung, eine Quelle

Neue Modul-Funktion:

```js
export const operatorChannelTenant = (req) =>
  isTrustedLocalCaller(req) ? BOOTSTRAP_TENANT_ID : TENANT_REJECT;
```

`isTrustedLocalCaller` ist die bereits bestehende, security-reviewte
Vertrauensgrenze (echter Loopback-Socket UND kein `X-Forwarded-For`) — keine
neue Vertrauensquelle. `singleTenantBootstrap` (die alte, unkonditionale
Bootstrap-Closure) wurde restlos entfernt, kein toter Code.

### Beide Konsumentenstellen exakt

**Stelle A — `MULTI_TENANT=false`-Zweig:**
```diff
-    if (!config.tenancy.multiTenant) return singleTenantBootstrap();
+    if (!config.tenancy.multiTenant) return operatorChannelTenant(req);
```

**Stelle B — Fallback bei fehlender Identitaet in `requestTenant`:**
```diff
-    if (!req.auth && !internal) return singleTenantBootstrap();
+    if (!req.auth && !internal) return operatorChannelTenant(req);
```

Zusaetzlich Doku-Anpassungen an drei Kommentarbloecken (Auflösungspunkte (1)
und (3), `requireTenant`-Header-Kommentar), damit die alte Zusage „ohne
Identitaet = vertrauter Owner-Kanal" nicht zur Luege wird — sie gilt jetzt
nur noch fuer den Betreiber-Kanal.

**Nicht angefasst:** `src/wiring/auth-gate.js`, `src/route-policy.js`,
`scripts/probe-auth.sh`, `src/store/defaults.js`, `src/config.js`,
`.env.example`, `render.yaml`, `test/helpers.js` — kein neuer Env-Key, kein
`BASE_ENV`-Eintrag noetig.

## Konsumenten-Enumeration

| # | Fundstelle | Route | Resolver | Urteil |
|---|---|---|---|---|
| 1 | `api-read.js` `/api/state` | `GET /api/state` | `requestTenant` | bleibt In-Process vertrauenswuerdig; extern verliert Owner-Daten (`MULTI_TENANT=true`) bzw. Restloch bei `=false` — geschlossen erst durch P5 |
| 2 | `api-read.js` `/api/calls/:id` | `GET` | `requestTenant` | bleibt In-Process; extern -> 404 (fail-closed, unveraendert korrekt) |
| 3 | `api-read.js` `/api/tenant-data/export` | `GET` | `requireTenant` | bleibt In-Process; extern -> 403 (Kernziel der Phase, AUTH-P3-10/-11) |
| 4 | `api-calls.js` `.../consult` | `GET` | `requestTenant` | bleibt — einziger Aufrufer MCP `await_call_event` ueber Loopback |
| 5 | `api-calls.js` `.../consult/answer` | `POST` | `requireTenant` | bleibt — einziger Aufrufer MCP `answer_consult` ueber Loopback |
| 6 | `api-calls.js` `.../cancel` | `POST` | `requestTenant` (via `callVisibleTo`) | bleibt — MCP `cancel_call` ueber Loopback |
| 7 | `api-tenant-write.js` `/api/settings` | `POST` | `requireTenant` | stirbt fuer externe Aufrufer, beabsichtigt: kein Code-Aufrufer im Repo (AUTH-P3-12) |
| 8 | `api-tenant-write.js` `/api/calendar` | `POST` | `requireTenant` | stirbt extern, beabsichtigt, gleiche Begruendung |
| 9 | `api-billing.js` `/api/billing/setup-checkout` | `POST` | `requireTenant` | stirbt extern, beabsichtigt: Legacy-Paar, ersetzt durch Self-Service-Pfad |
| 10 | `api-billing.js` `/api/billing/checkout-return` | `GET` | `requireTenant` | stirbt fuer einen vor dem Deploy geoeffneten Legacy-Checkout: 403 statt Karten-Bindung. Kein Live-Regress (aktive Kartenerfassung laeuft ueber Self-Service-Pfad); als Restrisiko in `PLAN-SECURITY.md` benannt |
| 11 | `routes/mcp.js` `POST /mcp` | `requestTenant` | bleibt live: `MCP_AUTH=oauth` gemessen, `req.auth` gesetzt, geaenderter Zweig nicht betreten. Restrisiko: `MCP_AUTH=token/off/Legacy-extern` wuerde den Connector stumm schalten (keine Boot-Sonde) |
| 12 | `outbound-gates.js` Gate `resolve_identity` | `POST /api/calls` | `requestTenant` | bleibt In-Process; extern -> `tenant_reject` -> 403, kein Originate mehr (AUTH-P3-13, `profiles.test.js`) |

Zusaetzlich geprueft: `scripts/sweep-jetzt.sh` unberuehrt (Zielroute ohne
Resolver); `scripts/check-setup.js` `/api/state` ueber ngrok bleibt
funktionsfaehig (prueft nur `r.ok`, kein Owner-Daten-Leck-Check);
`scripts/probe-auth.sh` unveraendert (`git diff --stat` leer verifiziert);
`src/mcp-tools.js` `api()`-Loopback-Hop bleibt vertrauenswuerdig
(AUTH-P3-15), Annahme benannt: gilt nur solange `GATEWAY_URL` auf localhost
zeigt — keine Boot-Sonde dafuer. ~40 weitere Tests mit injizierten
Fake-Resolvern und alle Spawn-Tests ueber `srv.localUrl` (127.0.0.1, kein
XFF) unberuehrt.

## Neue Tests — `test/auth-p3-bootstrap-fallback.test.js`

16 Tests, Praefix `AUTH-P3-N` (kollidiert nicht mit dem i18n-Katalogmuster
-> laeuft im Regressionslauf `npm test`, nicht in `test:gates`).

**Unit (9):**

| ID | Assertion |
|---|---|
| AUTH-P3-1 | `operatorChannelTenant` fuer `127.0.0.1`/`::1`/`::ffff:127.0.0.1` ohne XFF `=== BOOTSTRAP_TENANT_ID` |
| AUTH-P3-2 | Loopback **mit** `x-forwarded-for` `=== TENANT_REJECT`, `notEqual` Bootstrap |
| AUTH-P3-3 | externer Socket mit/ohne XFF beide `TENANT_REJECT` |
| AUTH-P3-4 | `requestTenant`, `MULTI_TENANT=false`, extern `=== TENANT_REJECT`, `store.calls` leer |
| AUTH-P3-5 | `requestTenant`, `MULTI_TENANT=false`, Loopback ohne XFF `=== BOOTSTRAP_TENANT_ID`, `store.calls` leer |
| AUTH-P3-6 | `requestTenant`, `MULTI_TENANT=true`, keine Identitaet, extern `=== TENANT_REJECT` |
| AUTH-P3-7 | `requestTenant`, `MULTI_TENANT=true`, keine Identitaet, Loopback `=== BOOTSTRAP_TENANT_ID` |
| AUTH-P3-8 | `requireTenant`, `MULTI_TENANT=false`, extern: Rueckgabe `null`, `res.statusCode===403` |
| AUTH-P3-9 | Tabellentest {loopback,extern}×{XFF,kein XFF}: Bootstrap NUR bei loopback∧¬XFF |

**Spawn (7), Gate beweisbar abwesend (`DASHBOARD_PASSWORD=""`):**

| ID | Assertion |
|---|---|
| AUTH-P3-10 | `GET /api/tenant-data/export` mit XFF, `MULTI_TENANT=true`: `status===403`, `www-authenticate===null`, kein `data_export`-Audit |
| AUTH-P3-11 | wie 10, `MULTI_TENANT=false`: `status===403`, kein `www-authenticate` |
| AUTH-P3-12 | `POST /api/settings` mit XFF: `status===403`, Store-Owner-Settings unveraendert (`"Hermes"`) |
| AUTH-P3-13 | `POST /api/calls` mit XFF, offline: `status===403` (Gate `tenant_reject`, nicht 500), `store.calls.length===0` |
| AUTH-P3-14 | Loopback ohne XFF: `/api/state` -> 200 mit `agent.owner==="Jonas Beispiel"`, `calls.length===1`; `/api/tenant-data/export` -> 200, `tenantId==="owner"` |
| AUTH-P3-15 | MCP `list_calls` ueber Loopback, `MCP_AUTH=""`: `isError !== true` |
| AUTH-P3-16 | `GET /api/state` **mit** XFF: `status===200`, `agent.owner===""`, `calls.length===0` — pinnt explizit das nicht behobene Restloch (403 kommt erst mit P5/`internalOnly`) |

## Mutationsprobe

`operatorChannelTenant` testweise auf `(_req) => BOOTSTRAP_TENANT_ID`
(alter unkonditionaler Fallback) zurueckgedreht.

**Ergebnis:** genau AUTH-P3-2, -3, -4, -6, -8, -9, -10, -11, -12, -13, -16
wurden ROT (11 von 16); AUTH-P3-1, -5, -7, -14, -15 blieben GRUEN (die
In-Process-Pfad-Pins) — exakt wie im Plan spezifiziert. Gegenprobe
`test/profiles.test.js`/`test/request-tenant-unit.test.js`: der angepasste
`profiles.test.js`-Subtest und der angepasste `request-tenant-unit.test.js`-
Fall wurden unter der Mutation ebenfalls rot (Beweis, dass die Anpassung
den neuen Zustand pinnt, nicht bloss die Assertion aufweicht). Mutation von
Hand zurueckgenommen (kein `git stash`, geteilter `refs/stash` zwischen
Worktrees); `node --check` OK; `npm test` danach erneut vollstaendig gruen
(3779/3779).

## Angepasste Bestandstests

1. **`test/request-tenant-unit.test.js`** — „requestTenant: Flag AUS ->
   explizite Bootstrap-Bindung": `reqWith()`-Default war ein externer Socket
   (`203.0.113.7`); der Test meinte nie „extern", sondern „der Flag-Kurzschluss
   greift vor auth/tenant". Auf Loopback ohne XFF festgenagelt, Name
   angepasst. Aussage (`store.calls` leer) bleibt wortgleich gepinnt.
2. **`test/request-tenant-unit.test.js`** — „requestTenant: extern +
   x-internal-tenant -> ignoriert": erwartete frueher `BOOTSTRAP_TENANT_ID`
   fuer einen externen Aufrufer — genau die Eigenschaft, die P3 beseitigt.
   Jetzt `TENANT_REJECT` + `assert.notEqual` gegen Bootstrap. Tragende
   Assertion (`store.calls` leer, kein Lookup) unveraendert.
3. **`test/request-tenant-unit.test.js`** — „requireTenant: Flag AUS ->
   BOOTSTRAP_TENANT_ID, Gate inert": gleicher Default-Socket-Fehler,
   explizit auf Loopback korrigiert.
4. **`test/profiles.test.js`** — Subtest „extern: Header ignoriert ->
   requestedBy=owner (kein Spoof)": frueher `500` + Call mit
   `requestedBy:"owner"` (Call ENTSTAND); jetzt `tenant_reject` greift vor
   dem Originate -> `403`, **kein** Call. Keine Abschwaechung, sondern
   frueherer Durchsetzungspunkt derselben Spoof-Aussage; die beiden anderen
   Subtests derselben Datei decken die verbleibenden Pfade weiter ab.

**Bewusst NICHT angepasst (Scope-Grenze):** `test/security.test.js` — zwei
Tests prüfen nur `status===200` bei `/api/state` unter `MULTI_TENANT=false`
und bleiben gruen, messen aber ab jetzt weniger als der Name verspricht.
Als Befund in `PLAN-SECURITY.md` benannt statt geaendert.

## Testlauf

`npm test`: 3779/3779 gruen. `npm run test:gates`: 3 rote Tests
(GAP-05, GAP-15 x2 — Stripe-Promo-Codes, Legal-Text-Platzhalter),
nachweislich unabhaengig von dieser Aenderung (gegrept: keine Treffer von
`_tenant.js`/`requestTenant`/`requireTenant`/`operatorChannelTenant` in den
betroffenen Modulen).

## Safety-Urteil

**FREIGABE (approved: true).** Kernbefunde der unabhaengigen Pruefung:

- Fail-closed selbst nachgerechnet: im gesamten `src/` gibt es exakt zwei
  Stellen, die einem Request eine Identitaet zuweisen (`web-auth.js:735`
  nach signiertem Cookie + DB-Session; `auth.js:86` nach `jwtVerify`), plus
  die beiden In-Process-Header-Kanaele, die beide an `isTrustedLocalCaller`
  haengen. Kein dritter Weg fuer eine anonyme externe Anfrage.
- Der 403-Test misst nachweislich den Resolver, nicht das Gate: mit
  `DASHBOARD_PASSWORD=""` ist das Gate laut `makeAuthGate`-Kurzschluss
  ABWESEND (nicht umgangen); mit gesetztem Passwort antwortet derselbe
  Request stattdessen mit 401 + `WWW-Authenticate`.
- Keine zweite Vertrauensquelle: Diff enthaelt keine neuen
  `process.env`-Lesungen und keine neuen Header-Zugriffe;
  `isTrustedLocalCaller` selbst ist byte-unveraendert.
- In-Process-Pfad live nachgemessen auf zwei unabhaengigen Bahnen
  (Branch + Master-Baseline): Master gab demselben anonymen Request Owner-
  Export inkl. Transkript und legte tatsaechlich einen Call-Datensatz an;
  der Branch liefert 403/403 und legt nichts an.
- `route-policy.js`, `probe-auth.sh`, `auth-gate.js`, `config.js`,
  `.env.example`, `render.yaml`, `store/defaults.js` allesamt unangetastet
  (`git diff --stat` leer).

**Concerns (kein Blocker, alle als Restzustand benannt):**
1. Unter `MULTI_TENANT=false` liefert `GET /api/state` einem anonymen
   externen Aufrufer weiterhin 200 mit ungefilterter Call-Liste inkl.
   Transkript (kein Regress ggue. master, aber `render.yaml` traegt
   `MULTI_TENANT:"false"` — Schliessung ist P5).
2. `scripts/check-setup.js` (PUBLIC_URL-Diagnose ueber ngrok) fehlte in der
   urspruenglichen Enumeration — nachtraeglich ergaenzt, kein
   Produktions-/Geld-/Anrufpfad, sichtbare Warnung statt stiller Tod.
3. Routen ganz ohne Resolver (`/api/profiles`, `/api/onboard`,
   `/api/billing/flush-meters` u.a.) bleiben allein durch das Basic-Gate
   gedeckt — gehoert zu P4/P6, nicht dieser Phase.
4. `MCP_AUTH≠oauth`-Rueckfall wuerde den Connector stumm schalten (keine
   Boot-Sonde) — bereits in `PLAN-SECURITY.md` benannt.
5. `GATEWAY_URL` auf die oeffentliche URL gesetzt wuerde alle MCP-Tools auf
   `TENANT_REJECT` laufen lassen — Ausfallart wechselt von „falsch
   attribuiert" zu „hart tot", aber keine Boot-Sonde vorhanden.

## Clean-Code-Audit (S1-S4)

**S1 (Blocker):** keine Verstoesse.
**S2 (Duplizierung):** keine Verstoesse — die Vertrauensbedingung existiert
genau einmal (`operatorChannelTenant`), ersetzt beide vorherigen
Aufrufstellen der alten `singleTenantBootstrap()`-Closure.
**S3:** keine Verstoesse — Kommentare deutsch ohne Umlaute, keine
Datei:Zeile-Referenzen in neuen Zeilen, keine ungebuendelten Magic
Numbers/Strings (`EXTERNAL_ADDR`/`LOCAL_ADDRS` als benannte Testkonstanten).
**S4:** keine Verstoesse — eine neue Funktion ersetzt zwei vorherige
Inline-Aufrufstellen, reduziert eher die Konzeptzahl.

**Verdict: PASS.** Namensgebung (`operatorChannelTenant`) traegt die
fachliche Absicht statt der Mechanik; `node --check` auf der Branch-Version
lief fehlerfrei; kein Blocker, keine Pflicht-Todos. Ein optionaler Hinweis
(kein Flag): Kommentare in `src/routes/mcp.js:61` und `src/config.js:885`
liegen ausserhalb des Diff-Scopes und werden durch AUTH-P3 leicht ungenau
(„requestTenant === BOOTSTRAP_TENANT_ID" gilt jetzt nur noch fuer den
Betreiber-Kanal) — bei naechster Beruehrung dieser Dateien nachziehen.

## Fix-Runden

Keine. Der Review-Zyklus lief einmal durch (Safety FREIGABE, Cleancode
PASS) ohne Blocker, daher keine Fix-Runde noetig.

## Was diese Phase NICHT belegt

- **Ob `isTrustedLocalCaller` in Produktion hinter Render fuer den
  In-Process-Pfad tatsaechlich `true` liefert, ist eine Annahme, kein
  Live-Beweis.** Der Test AUTH-P3-15/-14 belegt das Verhalten in einer
  lokal gespawnten Testumgebung (echter Loopback-Socket, `GATEWAY_URL` zeigt
  auf `http://localhost:<port>`), nicht im Render-Deploy. Ob Render den
  In-Process-Hop tatsaechlich als echten Loopback-Socket ohne
  `X-Forwarded-For` durchreicht, zeigt erst der Live-Deploy.
  **Abbruchsignal: MCP-Tools in claude.ai liefern Fehler statt Daten** —
  dann sofort Rollback ueber Render-Redeploy des Vorgaenger-Commits,
  verifiziert an `GET /healthz` -> `commit`.
- Ob ausserhalb dieses Repos ein Betreiber-`curl` mit Basic-Creds von aussen
  gegen `/api/state` oder `/api/tenant-data/export` gefahren wird, ist nicht
  belegbar (kein Skript, kein Code-Aufrufer im Repo gefunden) — nur, dass
  ein solcher Aufruf nach dieser Phase weniger/anders liefern wuerde.
- Das Abnahmekriterium „externer Request auf `/api/state` -> 403" aus dem
  Plan ist **nicht erreicht** und wurde bewusst nicht erzwungen (zweite
  Verhaltensaenderung waere noetig gewesen, `/api/state` ruft
  `requestTenant`, nicht `requireTenant`). Stattdessen liefert `/api/state`
  unter `MULTI_TENANT=true` weiterhin 200, aber ohne Owner-Daten — die
  Schliessung auf 403 ist P5 (`internalOnly`) vorbehalten, gepinnt in
  AUTH-P3-16.
- Kein Beleg, dass diese Phase irgendeinen bereits laufenden Angriff oder
  Fehlnutzung beendet — sie schliesst eine Luecke, die heute durch das
  Basic-Auth-Gate bereits verdeckt ist. Der Nutzen wird erst messbar,
  sobald P7 das Gate tatsaechlich entfernt.
