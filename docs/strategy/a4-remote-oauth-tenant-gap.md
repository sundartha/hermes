# A4 — Remote-Browser-OAuth fuer Self-Service: `requestTenant()`-Tenant-Luecke

> Strategie (KEIN Code). Schliesst eine Privilege-Escalation-Luecke: per OIDC-Web-Login
> authentifizierte Browser-Nutzer (`req.tenant`) bekommen ueber `requestTenant()`-Routen
> heute fahrlaessig Owner-Zugriff statt ihres gescopten Tenants.
>
> Erarbeitet mit Agent-Team (Architektur-/Phasen-Agent + Pre-Mortem-/Test-Seam-Agent),
> alle Annahmen gegen den echten Code in `src/server.js`, `src/web-auth.js`, `src/auth.js`
> und die Tests verifiziert. Einstufung: **NORMAL**.

---

## 1. Kontext & Problem (am Code verifiziert)

`requestTenant(req)` (`src/server.js:78-85`) loest den Request-Tenant heute **ausschliesslich** aus:

- `req.auth.sub` — MCP-OAuth, gesetzt von `mcpAuth`/`verifyOauth` (`src/auth.js`), nur auf `/mcp`.
- `internalIdentity(req)` — localhost-only `X-Internal-Identity`-Header (`src/server.js:52-56`).
- sonst `!sub && !internal -> return OWNER_TENANT_ID` (`src/server.js:82`).

`req.tenant = { tenantId, sub, role, email }` wird im gesamten `src/` **nur** von `webAuthMiddleware`
gesetzt (`src/web-auth.js:372`) — und zwar erst nach signiertem Cookie + gueltiger, nicht-invalidierter,
nicht-abgelaufener DB-Session + aktivem Account (`status==='active'`). `req.tenant` ist damit **voll
vertrauenswuerdig**.

**Die Luecke:** Ein OIDC-Web-Nutzer hat `req.tenant`, aber **kein** `req.auth` und ist **nicht** localhost.
Er faellt in `requestTenant` in den `!sub && !internal`-Zweig und bekommt **`OWNER_TENANT_ID`** —
Cross-Tenant-Owner-Zugriff.

**Praezisierung zur heutigen Erreichbarkeit (wichtig fuer die Einordnung):** `webAuthMw` wird nicht global
gehaengt, sondern pro Route explizit — Portal (`server.js:175`), Admin (`189`), Self-Service (`200`).
Genau diese Web-Routen lesen `req.tenant.tenantId` **direkt** und rufen `requestTenant` **nicht** auf
(`self-service-routes.js:26,43`; `server.js:177`). Die `requestTenant`-Konsumenten (`/api/calls`,
`/api/state`, `/api/settings`, `/api/calendar`, `/api/tenant-data/export`, `/api/calls/:id[/cancel]`,
`/mcp`-Audit) liegen **nicht** hinter `webAuthMw` -> dort ist `req.tenant` heute nie gesetzt. `webAuthMw`
und `mcpAuth` laufen also auf **disjunkten** Routen.

> Konsequenz: A4 schliesst eine **latente** Escalation-Luecke (fail-closed-Haertung + Konvergenz-Vorsorge
> fuer Remote-Browser-OAuth-Self-Service). Sie wird **real**, sobald eine `requestTenant`-Route hinter
> `webAuthMw` gehaengt wird — was die Self-Service-Konvergenz (#3) bereits anstoesst. Der Fix ist geboten,
> klein und risikoarm.

---

## 2. Ziel & Akzeptanzkriterien

`requestTenant` MUSS `req.tenant` auswerten, wenn vorhanden — fail-closed:

1. `req.tenant` gesetzt -> `req.tenant.tenantId` **direkt** nutzen (kein zweiter Lookup).
2. Sonst: bisherige Logik (`req.auth.sub` -> `internalIdentity` -> Owner) **byte-identisch** beibehalten.
3. **fail-closed:** `req.tenant` vorhanden ohne gueltige `tenantId` -> `TENANT_REJECT` (NIE Owner).
4. KEIN Cross-Tenant-Leak.

**Akzeptanzkriterien (global):**

- [ ] Flag `config.multiTenant` aus -> `OWNER_TENANT_ID`, byte-identisch zum Bestand.
- [ ] `req.tenant.tenantId` gueltig -> genau dieser Tenant (nicht Owner, nicht Reject).
- [ ] `req.tenant` ohne/leere `tenantId` -> `TENANT_REJECT`, nie Owner.
- [ ] Kein `req.tenant` -> bestehende `sub`/`internal`/Owner-Logik unveraendert.
- [ ] `req.auth`/MCP-Pfad **byte-identisch**: Tests `V1`-`V4` (`test/request-tenant.test.js`) bleiben gruen.
- [ ] Alle ~12 `requestTenant`/`requireTenant`-Aufrufstellen bleiben unveraendert korrekt.

---

## 3. Architektur-Skizze

### 3.1 Vorgeschlagener Kontrollfluss von `requestTenant` (Pseudocode, KEIN finaler Diff)

```
function requestTenant(req):
    if not config.multiTenant:
        return OWNER_TENANT_ID                 # (1) Flag-Kurzschluss — UNVERAENDERT, zuerst

    if req.tenant is set:                       # (NEU) Web-Session-Pfad, VOR der req.auth-Logik
        return req.tenant.tenantId || TENANT_REJECT   # fail-closed: leer/falsy -> REJECT, NIE Owner

    sub      = req.auth ? req.auth.sub : null   # (2) MCP-/internal-Achse — BYTE-IDENTISCH
    internal = req.auth ? null : internalIdentity(req)
    if not sub and not internal:
        return OWNER_TENANT_ID                  # fehlende Identitaet (localhost/stdio) -> Owner
    tenantId = store.resolveTenant(sub || internal)
    return tenantId || TENANT_REJECT
```

### 3.2 Einfuege-Position & Begruendung

- **Nach** dem `!config.multiTenant`-Kurzschluss (Flag aus = Single-Tenant = alles Owner; die
  Invariante darf nicht von einer Session abhaengen — siehe R5), **vor** der `sub`/`internal`-Aufloesung.
- Wenn `req.tenant` gesetzt ist, ist die Identitaet bereits durch eine **staerkere** Quelle verifiziert
  (signiertes Cookie + serverseitige, jederzeit invalidierbare DB-Session + aktiver Account). Es gibt
  keinen Grund, danach noch `store.resolveTenant` zu fragen — die DB-Session liefert die `tenantId`
  autoritativ. Ein nachgelagerter Einbau wuerde den Owner-Default (`server.js:82`) zwischenschalten —
  genau die Luecke.

### 3.3 Prioritaet `req.tenant` vor `req.auth`

`req.tenant` gewinnt. Begruendung:

- **Heute disjunkt:** keine Route setzt beide. Die Reihenfolge ist heute rein theoretisch.
- **Falls kuenftig beide** (jemand stapelt `webAuthMw` + `mcpAuth`): `req.tenant` ist die staerkere,
  Session-gebundene, jederzeit invalidierbare Identitaet; `req.auth` ist „nur" ein gueltiges JWT, dessen
  `sub` erst per `resolveTenant` nachgeschlagen wird. „`req.tenant` zuerst" ist sicherheits- **und**
  konvergenz-konform. Diese bewusste Prioritaet gehoert als Kommentar an die neue Zeile.

### 3.4 Session-Tenant direkt — KEIN zweiter Resolver (load-bearing)

Der Web-Pfad gibt **direkt** `req.tenant.tenantId` zurueck und schleift den Session-Tenant **nicht**
durch `store.resolveTenant`. Sonst entstuende ein zweiter Resolver, der bei einem Tenant **ohne**
`idpSubject` von der DB-Session **divergieren** koennte (R7). So wird `requestTenant` der **eine**
kanonische Resolver fuer beide Achsen — konsistent mit dem direkten `req.tenant.tenantId` in
Portal/Self-Service.

### 3.5 Konsumenten bleiben unveraendert korrekt (durchgeprueft)

`requireTenant(req,res)` (`server.js:94-101`) wrappt nur `requestTenant` und gatet `TENANT_REJECT -> 403`.
Da der neue Zweig dasselbe Vertrags-Tripel liefert (`OWNER_TENANT_ID` | konkrete `tenantId` |
`TENANT_REJECT`), bleibt `requireTenant` byte-identisch korrekt. Keine Aufrufstelle muss angefasst werden:

| Aufrufstelle | Effekt mit echtem Web-Tenant statt Owner |
|---|---|
| `/api/calls` (`668`) | REJECT -> 403; sonst KYC/Nummern/`outboundFrom`/Budget arbeiten mit echter `tenantId` statt Owner — die gewollte Korrektur. |
| `/api/calls/:id/cancel` (`777`), `/api/calls/:id` (`846`) | `tenantOwnsCall(call, requestTenant(req))` -> fremde Calls korrekt 404 statt Owner-Vollzugriff. |
| `/api/state` (`807`) | `isOwnerView` fuer Web-Nutzer korrekt `false` -> Owner-PII (`ownerNumber`) wird nicht geleakt. |
| `/api/tenant-data/export` (`857`), `/api/settings` (`866`), `/api/calendar` (`881`) | via `requireTenant` -> REJECT-Guard greift; sonst echter Tenant. |
| `/mcp`-Audit (`1047`) | `req.tenant` auf `/mcp` nie gesetzt -> neuer Zweig feuert nie -> Logzeile byte-identisch; `V1`-`V4` bleiben gruen. |

Einziger verhaltensaendernder Effekt: **Web-Nutzer != Owner mehr.**

### 3.6 Test-Seam: warum eine Extraktion noetig ist (verifiziert)

`requestTenant` ist **nicht exportiert**, und ein **bloss nachgeruesteter `export` reicht nicht**:
`src/server.js` ruft auf Modulebene `app.listen(config.port, …)` (`server.js:1106`) und
`attachMediaBridge` (`1126`) auf — **ein Import von server.js startet also einen HTTP-Server**. Genau
deshalb laden alle Tests server.js als **Kindprozess** (`spawn`, `test/helpers.js:306,330`), nie per
Import. Ein nackter Export waere damit keine saubere Unit-Naht.

**Empfehlung:** den **reinen Resolver** (`requestTenant` + die Helfer `internalIdentity`/`isLocalSocket`
+ die Konstanten `OWNER_ID`/`ANON_IDENTITY`/`TENANT_REJECT`, soweit gemeinsam genutzt) in ein **kleines,
seiteneffektfreies Modul** (z.B. `src/request-tenant.js`) ziehen und in server.js importieren. Das ist
**ein Move, kein Rewrite**, haelt den `req.auth`-Block byte-identisch und macht die Funktion ohne
server.js-Boot unit-testbar. Es ist exakt das Repo-Muster (`makeSelfServiceRoutes`, `makeAccounts`,
`webAuth`/`adminOnly` wurden aus server.js herausgezogen, um in-process testbar zu sein — G5
„denselben Handler testen, keine Replik").

> Bewertete Alternative (verworfen): reiner Integrationstest **ohne** Extraktion. Geht nicht ohne Replik
> der Logik (G5-Verstoss), da requestTenant nicht importierbar ist; und der sicherheitskritischste Fall
> **W2** (leere `tenantId`) ist ueber echtes `webAuthMw` gar **nicht** herstellbar (siehe R2). Eine volle
> Server-Spawn-Variante (C) verstoesst zudem gegen die Konvention „pglite NIE mit Server-Spawn mischen".

---

## 4. Pre-Mortem-Risiken

| # | Risiko | Warum es entstehen koennte | Gegenmassnahme / Akzeptanz | Vom Fix gedeckt? |
|---|---|---|---|---|
| **R1** | Cross-Tenant-Leak durch falsche Prioritaet `req.tenant` vs `req.auth` | Heute disjunkt; Risiko zukunftsgerichtet, falls jemand `webAuthMw`+`mcpAuth` stapelt | `req.tenant` MUSS Vorrang haben (staerkere, invalidierbare DB-Session). Bewusster Kommentar an der Zeile. | **Ja** — req.tenant-Zweig steht vor dem req.auth-Block. |
| **R2** | Fail-closed-Luecke: `req.tenant` gesetzt, aber `tenantId` falsy/leer | theoretisch geloeschter Tenant trotz Cookie; leerer DB-Wert | `req.tenant.tenantId \|\| TENANT_REJECT`. **`\|\|`, NICHT `??`** — `??` liesse `""` durch. `tenantId` ist `t_<sub>` (immer truthy String, nie `0`/`""`), `webAuthMw` kann heute kein falsy `tenantId` setzen (geloeschter Tenant -> JOIN leer -> `acct=null` -> 401, kein `req.tenant`). Defense-in-Depth gegen kuenftige Aenderungen. | **Ja** — `\|\| TENANT_REJECT` ist korrekt & ausreichend. |
| **R3** | MCP-Identitaets-Pfad beeintraechtigt | versehentliche Aenderung am `req.auth`-Block | Auf `/mcp` laeuft nur `mcpAuth`, kein `webAuthMw` -> `req.tenant` nie gesetzt -> neuer Zweig feuert dort nie. Zeilen `80-84` bleiben textuell unveraendert. `V1`-`V4` als Regressionsgate. | **Ja**, solange der req.auth-Block unveraendert bleibt. |
| **R4** | Spoofing von `req.tenant` durch externen Client (Header/Body/Query) | Client-kontrollierte Eingabe koennte `req.tenant` befuellen | `grep` belegt: `req.tenant =` nur in `web-auth.js:372` (serverseitig, nach DB-Verifikation) + Test-Helfer. Kein Code befuellt `req.tenant` aus `req.body/query/headers`; Express populiert es aus nichts Client-Kontrolliertem (`{tenant:...}` im Body landet unter `req.body.tenant`). | **Ja** — Fix liest `req.tenant` nur, kein neuer Eingabepfad. Zukunfts-Akzeptanz: Grep-/Lint-Guard „nur web-auth.js setzt `req.tenant`". |
| **R5** | Reihenfolge `config.multiTenant`-Check vs `req.tenant`-Zweig | Stuende der Web-Zweig vor dem Flag-Check, kaeme bei Flag **aus** ein echter Tenant statt Owner -> Bruch der „Flag aus = byte-identisch"-Invariante | `if (!config.multiTenant) return OWNER_TENANT_ID` MUSS **zuerst** stehen. Semantisch: Flag aus = Single-Tenant, Session ignoriert. | **Ja** — Flag-Check an Position (1). **Load-bearing, in Test W3 fixiert.** |
| **R6** | Suspended/geloeschter Tenant im Cookie-Zeitfenster (Stale-Session) | Status aendert sich, Cookie noch gueltig | `webAuthMw` prueft pro Request `acct.status==='active'` (`web-auth.js:369`) + `invalidated_at` (`363`); suspend invalidiert alle Sessions -> `req.tenant` wird gar nicht gesetzt. requestTenant darf den Status **nicht** doppelt pruefen. | **Ja** (implizit — kein `req.tenant` im Suspend-Fall). |
| **R7** | Doppel-Resolver-Divergenz (Session-Tenant durch `resolveTenant` geschleift) | Wuerde requestTenant den Web-Tenant ueber `store.resolveTenant` aufloesen, divergiert es bei Tenant ohne `idpSubject` | Web-Zweig gibt **direkt** `req.tenant.tenantId` zurueck, kein zweiter Lookup. | **Ja** — direkter Return. **Load-bearing.** |

---

## 5. Test-Strategie

### 5.1 Seam-Entscheidung

**Primaer (A):** reinen Resolver in `src/request-tenant.js` extrahieren (siehe 3.6) -> deterministische
Unit-Tabellentests mit Mock-`req`. `config.multiTenant` per direkter Mutation des importierten
`config`-Objekts setzen (etabliertes Muster, z.B. `config.twilioNumber=""` in
`i9-self-service.test.js`). Vorteil: deckt insbesondere **W2** (leere `tenantId`) ab, das anders nicht
herstellbar ist; testet Prioritaet (R1) & Reihenfolge (R5) exakt; keine HTTP/DB-Infra.

**Ergaenzend (B):** **ein** schlanker Integrationstest nach `i9-self-service.test.js`-Muster (pglite +
`makeAccounts`/`makeSessions` + echte `webAuth` + `signValue` + Wegwerf-Express-App), der eine
`requestTenant`/`requireTenant`-Route hinter echtem `webAuthMw` mountet — als Realitaets-Anker fuer
W1 (echter Cookie -> echter Tenant) und den 403-Reject-Pfad. **pglite und Server-Spawn NIE in derselben
Datei mischen** (Lehre p6a-Stall).

**Regressionsgate:** `V1`-`V4` in `test/request-tenant.test.js` unveraendert (Spawn-Muster, belegt den
unberuehrten MCP-Pfad).

### 5.2 Konkrete neue Testfaelle (Web-Pfad)

| ID | Eingabe (mit `config.multiTenant=true`, sofern nicht anders) | Erwartet | Prueft |
|---|---|---|---|
| **W1** | `{ tenant: { tenantId: "B" } }` | `=== "B"` (nicht Owner, nicht Reject) | Kern-Fix, R1 |
| **W2a** | `{ tenant: { tenantId: "" } }` | `=== TENANT_REJECT` | R2 (`\|\|`, fail-closed) |
| **W2b** | `{ tenant: {} }` (tenantId undefined) | `=== TENANT_REJECT` | R2 |
| **W3** | `{ tenant: { tenantId: "B" } }`, aber `config.multiTenant=false` | `=== OWNER_TENANT_ID` | R5 (Flag-Check zuerst) |
| **W4** | `{ tenant: { tenantId: "B" }, auth: { sub: "sub-c" } }` | `=== "B"` (req.tenant gewinnt) | R1 (Prioritaet) |
| **W5** (Negativkontrolle) | `{}` (kein tenant/auth, nicht localhost) | `=== OWNER_TENANT_ID` | Bestand: Kein-Identitaet-Fall unveraendert |

**Integration (B), optionaler E2E-Anker:** `W1-int` echter aktiver Cookie -> Route scoped auf `t_<sub>`,
nicht Owner; `WR-int` Reject -> **403** via `requireTenant`. (W2 bleibt Unit-only: echtes `webAuthMw`
kann keine leere `tenantId` erzeugen.)

**Regression (MUST gruen, unveraendert):** `V1` Flag aus -> owner; `V2` bekannter sub -> B;
`V3` unbekannter sub -> reject; `V4` Token ohne sub -> owner.

---

## 6. Phasenplan — Einstufung: NORMAL

**Begruendung NORMAL:** Die Logikaenderung ist ein einziger, lokal begrenzter, vorangestellter Zweig in
**einer** Funktion, ohne Aenderung an irgendeinem Konsumenten und ohne Schema-/Wiring-/Migrationsanteil.
Der Vertrag (`OWNER | tenantId | TENANT_REJECT`) bleibt erhalten. Die Komplexitaet liegt fast vollstaendig
im Test-/Regressionsnachweis, nicht in der Implementierung -> wenige Phasen.

### Phase 1 — Resolver-Extraktion + Kernaenderung
- **Ziel:** Reinen Resolver nach `src/request-tenant.js` ziehen (seiteneffektfrei, Import statt Boot) und
  den `req.tenant`-Zweig **vor** der req.auth-Logik einfuegen; fail-closed (`|| TENANT_REJECT`);
  Flag-Kurzschluss + gesamter req.auth-Block byte-identisch; Doc-Kommentar (`server.js:68-77`) um
  Web-Zweig + Prioritaetsbegruendung ergaenzen.
- **Betroffene Dateien:** `src/request-tenant.js` (neu), `src/server.js` (Import statt Inline-Funktion;
  ggf. `internalIdentity`/`isLocalSocket`/Konstanten mitziehen oder gemeinsam re-exportieren).
- **Parallelisierbar:** **Nein** — Grundlage fuer Phase 2.
- **Akzeptanz:** alle Kriterien aus §2; gesamte Bestandssuite gruen (insb. `V1`-`V4`, alle `/api/*`- und
  `/mcp`-Tests, Self-Service-Tests); kein veraendertes Laufzeitverhalten ausser „Web-Nutzer != Owner".

### Phase 2 — Tests (neue Vektoren + Regression)
- **Ziel:** (a) Web-Pfad fail-closed & ohne Owner/Cross-Tenant beweisen, (b) MCP-/Owner-/Reject-Pfad
  ohne Regression.
- **Betroffene Dateien:** neue Unit-Tests fuer den extrahierten Resolver (W1-W5; Seam A); **ein**
  Integrationstest nach `i9`-Muster (W1-int/WR-int; Seam B, separate Datei); `test/request-tenant.test.js`
  (V1-V4) unveraendert als Gate.
- **Parallelisierbar:** **Ja** — Unit-Tests (A), Integrationstest (B) und das V1-V4-Gate sind in
  getrennten Dateien/Mustern unabhaengig schreibbar; alle drei haengen aber an Phase 1.
- **Akzeptanz:** W1-W5 + W1-int/WR-int gruen; V1-V4 byte-identisch gruen; `clean-code-reviewer`-Verdikt
  SAUBER.

### Phase 3 (optional, nur bei Bedarf)
- **Ziel:** Falls die Extraktion in Phase 1 als zu invasiv bewertet wird, minimale Fallback-Naht
  (z.B. `requestTenant`/`requireTenant` ausschliesslich fuer Tests aus einem schlanken Hilfsmodul
  exportieren) — KEINE vollstaendige Architekturumstellung.
- **Betroffene Dateien:** `src/request-tenant.js` bzw. Testdatei.
- **Parallelisierbar:** Nein (haengt an Phase-1/2-Erkenntnis).
- **Akzeptanz:** kein veraendertes Laufzeitverhalten; alle Tests gruen; keine neue Owner-/Cross-Tenant-
  Oberflaeche.

---

## 7. Zusammenfassung der load-bearing Entscheidungen

1. **Reihenfolge:** `!config.multiTenant` (Owner) -> `req.tenant` (`|| TENANT_REJECT`) ->
   req.auth/internalIdentity-Block (unveraendert). Flag-Invariante (R5) zuerst, dann staerkste Identitaet
   (R1), MCP-Pfad zuletzt & byte-identisch (R3).
2. **`|| TENANT_REJECT`, nicht `??`** — fail-closed gegen leere `tenantId` (R2).
3. **Session-Tenant direkt aus `req.tenant.tenantId`**, nicht erneut durch `store.resolveTenant` (R7).
4. **Seam:** reinen Resolver nach `src/request-tenant.js` extrahieren (Import von server.js startet sonst
   `app.listen`); Unit-Tests (A) als Primaerabdeckung inkl. W2 (anders nicht erzeugbar), ein
   i9-Integrationstest (B) als Anker; V1-V4 als Regressionsgate.

### Relevante Dateien
- `src/server.js` (`78-85`, `94-101`, `1047`, `1106`)
- `src/web-auth.js` (`350-379`)
- `src/auth.js` (req.auth-Form)
- `src/self-service-routes.js`
- `test/request-tenant.test.js` (V1-V4-Gate)
- `test/i9-self-service.test.js` (pglite+webAuth+Wegwerf-App-Muster)
- `test/helpers.js` (`306,330` — Spawn statt Import)
