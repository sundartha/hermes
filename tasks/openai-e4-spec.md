# Etappe 4 — Mandantengrenze unabhaengig von `MULTI_TENANT` (Implementierungs-Spec)

**Grundlage:** `tasks/openai-fix/S4-mandantentrennung.md` (Schnitt) + `PLAN-OPENAI.md`
Abschnitt "Etappe 4 - Die Mandantengrenze (S4)" (Zeilen 138-145) samt den
Nachbesserungen 1-11 aus dem S4-Pre-Mortem und den Punkten 5/6 der Liste
"Nicht umsetzungsreif" (`PLAN-OPENAI.md:279-280`).

**Zielstand der Messung:** `master` **b901f4a**. Alle Zeilennummern, Zaehler und
Fingerprints in dieser Spec sind an DIESEM Stand gemessen, nicht aus S4 uebernommen —
S4 wurde auf `d054c95` geschrieben, seitdem sind die Etappen 1, 2, 3, 5, 7 und 8
gemergt und die Zeilen haben sich verschoben.

**Ein Commit.** A1+A2+A3 sind NICHT einzeln mergefaehig (S4-Pre-Mortem PM-2): jede
Teilmenge erzeugt einen Zustand, in dem das Leck offen ist, waehrend der Inventar-Test
gruen meldet. A1-A10 gehen zusammen in EINEN Commit.

---

## 0. Warum diese Etappe geparkt war — und was sie entparkt

Etappe 4 war blockiert durch die Feststellungsaufgabe **F-i**
(`PLAN-OPENAI.md:266`, `docs/RUNBOOK-LIVE-WERTE.md:30`): die Live-Werte der
Offenlegungs-Ausnahme waren nicht ablesbar. Die Wirkung war belegt (35 von 62
Anrufzeilen mit `callee_is_owner = true`), die Konfiguration nicht.

**Der Owner hat die Werte geliefert (Freigabe, ersetzt F-i):**

| Schluessel | Live-Wert |
|---|---|
| `OWNER_SELF_CALL_ENABLED` | **`true`** |
| `OWNER_SELF_CALL_TENANT_IDS` | **`t_user_01KX600834GCJFV9GTZQKWZMTH`** (genau EIN gepinnter Tenant) |

Damit ist belegt, was S4 nur vermuten konnte: die Allowlist nennt eine **echte
tenantId**, nicht `BOOTSTRAP_TENANT_ID` (`"owner"`, `src/store/defaults.js`). Das ist
die Voraussetzung, unter der die Etappe ueberhaupt bewertbar ist — und der Grund,
warum Abschnitt 2 dieser Spec der wichtigste ist.

Die uebrigen Vorbedingungen aus `PLAN-OPENAI.md:143` sind erfuellt:

| ID | Wert | Quelle |
|---|---|---|
| F-c | `MULTI_TENANT` live = **`true`** (BEWIESEN, SHA-256-Preimage des `configHash`) | `docs/RUNBOOK-LIVE-WERTE.md:24` |
| F-d / `MCP_AUTH` | **`oauth`** | `docs/RUNBOOK-LIVE-WERTE.md` (Messung 18.09.2026) |
| F-g | Anrufe ohne `tenant_id`: **0** (Spalte ist `NOT NULL`) | `PLAN-OPENAI.md:96-97` |
| F-f | haengende `active`-Anrufe: **0** | `docs/RUNBOOK-LIVE-WERTE.md:27` |

**Folge fuer den Live-Betrieb:** weil `MULTI_TENANT` live `true` ist, wird die Zeile,
die diese Etappe entfernt (`src/routes/_tenant.js:145`), im Live-Prozess **nie
ausgefuehrt**. E4 ist live ein No-op fuer die Aufloesung; sie aendert den DEFAULT
(lokal, Staging, frischer Service, Rollback). Das ist die tragende Aussage fuer beide
Fehlerrichtungen in Abschnitt 2 — sie ist vor dem Merge NEU zu messen (Abschnitt 7),
weil der Dienst dashboard-verwaltet ist und der Blueprint `false` sagt
(`render.yaml:689`).

---

## 1. Ist-Zustand am Stand b901f4a

`grep -rn "multiTenant" src/` — 11 Treffer, davon 5 in `src/routes/` (4 Code, 1 Kommentar):

| # | Stelle (b901f4a) | Flag AN | Flag AUS (Default) |
|---|---|---|---|
| 1 | `src/routes/_tenant.js:145` `if (!config.tenancy.multiTenant) return operatorChannelTenant(req);` | Rangfolge `req.tenant` (:146) -> `internalTenant` (:150) -> `req.auth.sub` (:152) | alles davon verworfen; Loopback ohne XFF -> `BOOTSTRAP_TENANT_ID`, extern -> `TENANT_REJECT` |
| 2 | `src/routes/api-read.js:70` `config.tenancy.multiTenant ? store.exportTenantData(tenantId) : s` | `/api/state` scopet `calls/actionItems/notifications` | Roh-State ALLER Mandanten |
| 3 | `src/routes/api-read.js:105` `config.tenancy.multiTenant && !tenantOwnsCall(...)` | fremder Call -> 404 | fremder Call -> 200 inkl. Transkript-Projektion |
| 4 | `src/routes/api-calls.js:379` `Boolean(call) && (!config.tenancy.multiTenant \|\| tenantOwnsCall(call, tenantId))` | Besitzpruefung an `:661` (consult), `:694` (consult/answer), `:719` (cancel) | immer `true` |
| 5 | `src/routes/_tenant.js:115` | reiner Kommentar (A4-Kompat-Hinweis) | — |

Ausserhalb von `src/routes/` (bleibt unangetastet): `src/config.js:1633` (Definition),
`:2295` (Namespace-Liste), `:2481` (`isSelfServiceLive`), `src/config-fingerprint.js:30`
(eine der sieben `configHash`-Achsen), `src/store/state-ops.js:816` (Kommentar, der den
unkonditionalen Inbox-Scope begruendet).

`src/routes/mcp.js` hat keinen Torschluss: `const scopedTenant = requestTenant(req)`
(`:85`) wird geloggt (`:86-92`) und als Profil-/Sprach-Schluessel benutzt (`:100`,
`:105`), aber NIE gegen `TENANT_REJECT` geprueft; `registerTools` laeuft trotzdem
(`:129`).

Seit Etappe 5 liegt VOR `mcpAuth` die Herkunftswache (`router.use("/mcp", createMcpOriginGuard(...))`,
`src/routes/mcp.js:64-73`). Sie ist fuer diese Etappe nur insofern relevant, als der
neue Torschluss **hinter** `mcpAuth` bleiben muss (Abschnitt 3, A4).

---

## 2. Absolute Regel 2 — die Offenlegungs-Ausnahme (der kritische Teil)

### 2.1 Wo genau E4 die `tenantId`-Eingabe aendert

Die Ausnahme haengt an `ownerSelfCallGranted` (`src/callee-is-owner.js:68-72`). Drei
Zutaten: `enabled`, `allowedTenantIds`, `tenantId` + `to === ownNumber`. **E4 fasst
genau eine davon an: `tenantId`** — und zwar an EINER Stelle:

> **`src/routes/_tenant.js:145`** (die Zeile, die A1 entfernt)

Von dort propagiert der Wert unveraendert durch drei Stationen:

```
src/routes/_tenant.js:145        requestTenant()  ← HIER aendert E4 die Eingabe
  -> src/telephony/outbound-gates.js:680   ctx.tenantId = requestTenant(ctx.req)
  -> src/routes/api-calls.js:443           resolveCallPrivacyFlags({ store, config, ctx })
  -> src/routes/api-calls.js:198           ownNumber = store.tenantPrivateNumber(ctx.tenantId)
  -> src/routes/api-calls.js:205-211       ownerSelfCallGranted({ to, ownNumber, tenantId: ctx.tenantId, ... })
  -> src/routes/api-calls.js:523           calleeIsOwner: calleeIsOwnerOfThisCall   (set-once am Datensatz)
```

Danach liest nur noch der Datensatz: `src/elevenlabs/outbound.js:701/1166/1293`,
`src/claude.js:482`, `src/consult/gate.js:42`, `src/store/pg.js:1618/2136`. Es gibt
**keinen zweiten Entscheidungspunkt** — und diese Spec schafft keinen.

**Nicht beruehrt:** die Inbound-Gegenrichtung `callerIsOwnerGranted`
(`src/routes/voice.js:328`). Ihre `tenantId` stammt aus dem Nummern-Record des
angerufenen Anschlusses, nicht aus `requestTenant`; ihre Schalter sind eigene
(`inboundOwnerGreetingEnabled` / `inboundOwnerGreetingTenantIds`). E4 fasst sie nicht
an, und keine Aenderung dieser Spec darf sie anfassen.

### 2.2 Richtung A — "scharf faellt ab" (der Owner hoert ploetzlich den Dritt-Satz)

**Was passiert waere:** nach E4 loest die Ausnahme fuer
`t_user_01KX600834GCJFV9GTZQKWZMTH` nicht mehr aus; der Owner bekommt auf seiner
eigenen hinterlegten Nummer den langen Dritt-Offenlegungssatz
("im Auftrag von ... wird zusammengefasst").

**Warum sie ausgeschlossen ist:**

1. Live ist `MULTI_TENANT=true` (F-c, BEWIESEN). Zeile `_tenant.js:145` ist im
   Live-Prozess toter Zweig — ihre Entfernung kann den aufgeloesten Wert nicht aendern.
   Der Live-Pfad ist heute schon: `/mcp` loest `req.auth.sub` -> `t_user_01KX…` auf
   (`_tenant.js:166`), reicht ihn als `X-Internal-Tenant` weiter
   (`src/mcp-tools.js`), und `requestTenant` gibt ihn am internen Hop direkt zurueck
   (`_tenant.js:150-151`). A1 aendert an keiner dieser vier Zeilen etwas.
2. Die 35 Live-Treffer `callee_is_owner=true` beweisen, dass genau dieser Pfad heute
   den gepinnten Wert liefert — der Beleg ist empirisch, nicht abgeleitet.
3. Die zweite Quelle fuer Richtung A ist **A4** (Torschluss auf `/mcp`): antwortet er
   faelschlich 403, ist nicht nur die Offenlegung betroffen, sondern der gesamte
   Connector (S4-Pre-Mortem PM-1). Deckung: `MCP_AUTH=oauth` ist gemessen UND wird vor
   dem Merge mit der unterscheidenden Probe neu belegt (Abschnitt 7, M1); zusaetzlich
   die Positiv-Kontrolle nach dem Deploy (Abschnitt 7, M4).
4. A1 darf `operatorChannelTenant` und die Reihenfolge ab `_tenant.js:146` NICHT
   anfassen (Verbot V3). Der identitaetslose Loopback-Pfad bleibt ueber `:165`
   vollstaendig erhalten — das ist der Pfad, auf dem die Bestands-OC-P1-Tests laufen.

**Test, der ihn faengt:** `E4-20` (Abschnitt 4) — gepinnte ECHTE tenantId,
`MULTI_TENANT` NICHT gesetzt, Request mit der Identitaet dieses Tenants, Ziel = dessen
hinterlegte Nummer -> `call.calleeIsOwner === true`. Rot heisst: der Owner wuerde den
Dritt-Satz hoeren. Zusaetzlicher Regressionsfang am anderen Ende der Achse: die
bestehenden OC-P1-Faelle (`test/oc-p1-owner-call-http.test.js:62-113`, Allowlist auf
`BOOTSTRAP_TENANT_ID` gepinnt, Betreiber-Kanal) muessen **unveraendert gruen** bleiben.

### 2.3 Richtung B — "inert wird scharf" (ein Dritter hoert den Pflichtsatz nicht)

**Was passiert waere:** nach E4 loest die Ausnahme fuer einen NICHT gepinnten Tenant
aus. Ein Dritter bekaeme einen KI-Anruf ohne den vollen Offenlegungssatz — Verstoss
gegen Art. 50 EU AI Act, der schwerere der beiden Faelle.

**Warum sie ausgeschlossen ist:**

1. A1 fasst die Allowlist-Pruefung nicht an. `tenantDarfAusloesen`
   (`src/callee-is-owner.js:57-61`) vergleicht strikt gegen
   `config.voice.ownerSelfCallTenantIds` (`src/config.js:1921`, `csvEnv`, einmal
   getrimmt/gesplittet). Fehlend / kein Array / leer -> `false`. Ein nicht gepinnter
   Tenant kann die Ausnahme nach E4 so wenig ausloesen wie davor.
2. Die Nummern-Bedingung bleibt: `to === store.tenantPrivateNumber(ctx.tenantId)` —
   also die Nummer **des aufgeloesten Tenants**, nicht irgendeine. Wer den gepinnten
   Wert vortaeuschen koennte, muesste zusaetzlich dessen hinterlegte Nummer treffen.
3. Die einzige Stelle, an der A1 die Menge der akzeptierten `tenantId`-Quellen
   erweitert, ist der In-Process-Header `X-Internal-Tenant` (`_tenant.js:150-151`):
   bei Flag AUS wurde er bisher eine Zeile vorher verworfen, nach A1 wird er gelesen.
   `trustedLocalHeader` (`:54-58`) nimmt ihn NUR von einem echten Loopback-Socket ohne
   `X-Forwarded-For` an. Hinter Render/Cloudflare traegt JEDER externe Request XFF —
   der Vektor ist rein host-lokal, seit `MULTI_TENANT=true` live ohnehin offen und als
   Topologie-Annahme bereits dokumentiert (S4 Blast Radius, PP-D7-08). **E4 vergroessert
   ihn live nicht**; er wird als akzeptiertes Bestandsrisiko benannt, nicht neu
   eingefuehrt.
4. Kein Client-Flag und kein MCP-Parameter entscheidet: der Aufrufer nennt nur `to`
   (`src/routes/api-calls.js:517-523`). Das bleibt so (Verbot V4).

**Tests, die ihn fangen:** `E4-21` (Abschnitt 4) — gepinnte ECHTE tenantId von Tenant A,
`MULTI_TENANT` nicht gesetzt, **Tenant B** ruft seine EIGENE hinterlegte Nummer an ->
`call.calleeIsOwner === false`. Und `E4-22` — derselbe Aufbau, aber Tenant B ruft die
hinterlegte Nummer von Tenant A an -> ebenfalls `false` (Ziel-Bedingung und
Allowlist-Bedingung sind zwei unabhaengige Riegel, beide muessen einzeln halten).

### 2.4 Was diese Spec ausdruecklich NICHT tut

- Sie weicht die Ausnahme nicht auf und baut sie nicht um. `src/callee-is-owner.js`
  wird **nicht angefasst** — keine Zeile.
- Sie schafft keine zweite Stelle, die dieselbe Frage beantwortet.
- Sie aendert keinen Wortlaut der Offenlegung (`LOCALES.<lang>.disclosure`) und keinen
  Owner-Prompt-Baustein (Pflicht-Rueckfall im Anrufmoment bleibt unveraendert).
- Sie laesst die fail-closed-Kette unveraendert: kein Treffer, fehlende Nummer,
  fehlender Tenant, nicht gepinnter Tenant, Praedikat-Fehler, Schalter aus, alter
  Datensatz ohne das Feld -> **volle Offenlegung**.

### 2.5 Beabsichtigte Konvergenz, benannt statt verschwiegen

In einer Umgebung OHNE gesetztes `MULTI_TENANT` (lokal, Staging, frischer Service) war
die Ausnahme bisher strukturell inert, weil `requestTenant` dort immer `"owner"` lieferte
und `"owner"` nicht in der Allowlist steht. Nach E4 verhaelt sich eine solche Umgebung
**genauso wie Live** — der gepinnte Tenant loest aus, alle anderen nicht. Das ist die
Absicht (eine Semantik statt zweier) und zugleich der Grund, warum `E4-20` existiert:
die Konvergenz muss bewiesen werden, nicht behauptet.

---

## 3. Aenderungen

Je Punkt: Datei — konkrete Aenderung — Abnahmekriterium.

### A0 — Entscheidung ohne Code: der Default wird NICHT umgedreht

`MULTI_TENANT` behaelt `fallback: false` (`src/config.js:1633`). Begruendung
unveraendert aus S4-A0: live steht der Wert ohnehin auf `true` (ein Flip aendert live
nichts), ein Flip liesse die Kopplung stehen, und `true` als Default wuerde
`isSelfServiceLive` (`src/config.js:2481`) einen Faktor kosten. Ein Boot-Riegel gegen
`MULTI_TENANT=false` wird NICHT gebaut (nach A1-A4 schwaecht der Wert nichts mehr).
**Abnahme:** `src/config.js:1633` unveraendert; `configHash` aus `/healthz` vor und
nach dem Merge identisch (dieselbe Env vorausgesetzt).

### A1 — `src/routes/_tenant.js`: Flag-Kurzschluss entfernen

- Zeile **145** loeschen (`if (!config.tenancy.multiTenant) return operatorChannelTenant(req);`).
- Den Rangfolge-Punkt (1) im Kommentarblock `:119-122` loeschen, die Punkte (2)/(3)
  zu (1)/(2) umnummerieren.
- Den A4-Kompat-Hinweis auf das Singleton `:113-115` loeschen.
- **Den `config`-Parameter entfernen** (Entscheidung zu `PLAN-OPENAI.md:280`):
  `export function makeTenantResolver({ store })`, dazu den Import
  `import { config as defaultConfig } from "../config.js";` (`:15`) loeschen und den
  DI-Vertrags-Kommentar `:11-14` kuerzen. Begruendung: nach A1 liest der Factory-Body
  `config` nicht mehr — ihn zu behalten waere toter Code (CLAUDE.md, hart verboten).
  Blast Radius der Entfernung ist klein und vollstaendig aufgezaehlt: `makeTenantResolver`
  wird in `src/` NUR von `makeRequestTenant` (`:210`, uebergibt kein `config`) und in
  `test/tenant-resolver-parity.test.js:110-111` (uebergibt ebenfalls kein `config`)
  aufgerufen. `src/server.js:79` nutzt `makeRequestTenant(store)` — unveraendert.
- **Nicht anfassen:** `operatorChannelTenant` (`:98-99`), die Reihenfolge ab `:146`,
  `isTrustedLocalCaller`, `trustedLocalHeader`, `requireTenant`, die Exporte.

**Abnahme:** `requestTenant` mit `auth.sub` eines geseedeten Tenants liefert dessen
`tenantId` auch ohne gesetztes `MULTI_TENANT`; ein identitaetsloser Loopback-Request
ohne XFF liefert weiter `BOOTSTRAP_TENANT_ID`; ein identitaetsloser Request MIT XFF
liefert weiter `TENANT_REJECT`. `node --check src/routes/_tenant.js` still.

### A2 — `src/routes/api-read.js:70`: unbedingt scopen

`const scoped = store.exportTenantData(tenantId);`. Kommentare `:57-61` und `:102-104`
auf den Flag-aus-Fall hin kuerzen (er existiert nicht mehr).
Belegt: `exportTenantData` liefert genau die drei Felder, die die Route aus `scoped`
liest (`calls`, `actionItems`, `notifications`). `settings`/`calendar`/`usage`/`agent`
kommen aus `tenantContext`/`usageOf`/`activeNumberFor` und sind bereits tenant-gebunden.
Kein neuer Store-Aufruf, keine neue Funktion.
**Abnahme:** ohne `MULTI_TENANT`-Override enthaelt `/api/state` als Tenant A keine
`call.id` von Tenant B.

### A3 — Besitzpruefungen entgaten

- `src/routes/api-read.js:105`: `if (!tenantOwnsCall(call, requestTenant(req))) return res.status(404).json({ error: "not found" });`
- `src/routes/api-calls.js:379`: `return Boolean(call) && tenantOwnsCall(call, tenantId);`
  (Kommentar `:374-377` entsprechend kuerzen).

Die vier Request-Pfad-Leser von `store.getCall` sind damit vollstaendig gedeckt:
`api-read.js:99`, `api-calls.js:659`, `:693`, `:718`. Die uebrigen Fundstellen sind
Provider-/Lebenszyklus-Pfade ohne Request-Tenant (`src/routes/voice.js`,
`src/telephony/call-termination.js`, `call-lifecycle.js`, `webhook-idempotenz.js`) —
dort wird KEIN Tenant-Argument erzwungen. Ein `getCall`-Export-Entzug ist ausdruecklich
NICHT Teil dieser Etappe (Scope).
**Abnahme:** ohne `MULTI_TENANT`-Override liefern `GET /api/calls/<B-id>`,
`GET /api/calls/<B-twilioSid>`, `GET /api/calls/<B-id>/consult`,
`POST /api/calls/<B-id>/consult/answer`, `POST /api/calls/<B-id>/cancel` je 404, und
B's Datensatz bleibt unveraendert (`context.key_facts` unberuehrt, `status` weiter
`active`).

### A4 — `src/routes/mcp.js`: Torschluss nach der Tenant-Aufloesung

Direkt nach `const scopedTenant = requestTenant(req);` (`:85`), also **innerhalb** des
bestehenden `router.post("/mcp", mcpAuth, …)`-Handlers und **nach** `mcpAuth`:

```js
if (scopedTenant === TENANT_REJECT) {
  audit("auth_failed", req, "path=/mcp grund=kein_tenant");
  return res.status(403).json({ error: "Keine Tenant-Zuordnung fuer diese Identitaet." });
}
```

- `TENANT_REJECT` aus `"../request-tenant.js"` importieren — dieselbe Import-Naht, aus
  der die Datei schon `ANON_IDENTITY` bezieht (`:32`). **Kein zweites Literal `"reject"`.**
- `audit` aus `"../util.js"` importieren (Praezedenz `src/auth.js:6`) — kein neuer
  DI-Parameter, `makeMcpRoutes({ config, store, requestTenant })` bleibt unveraendert
  (`src/app.js:444`).
- Wortlaut identisch zu `requireTenant` (`src/routes/_tenant.js:183`) — EIN Text.
- **Pflicht: als `if` IM Handler, nicht als Middleware vor `mcpAuth`.** Eine
  vorgelagerte Middleware wuerde (a) den unauthentifizierten Fall von 401 auf 403
  drehen und damit `scripts/probe-auth.sh:121` brechen, (b) den
  `WWW-Authenticate`-Header verschlucken und eine Neu-Autorisierung vom Client aus
  unmoeglich machen — genau der Aussperr-Fall, den Etappe 5 fuer die Origin-Wache
  ausdruecklich benannt hat.
- Der Block steht VOR `new McpServer` / `registerTools` (`:120`/`:129`).

**Abnahme:** `POST /mcp` mit gueltig signiertem Token, dessen `sub` keinem Tenant
zugeordnet ist -> HTTP 403, Body exakt
`{"error":"Keine Tenant-Zuordnung fuer diese Identitaet."}`, Antwort enthaelt kein
`"tools"`. Derselbe Request mit bekanntem `sub` -> 200 mit Werkzeugliste. `POST /mcp`
ohne Token -> unveraendert 401 mit `WWW-Authenticate`.

### A5 — Entscheidung: `/api/state` ohne Tenant bleibt 200 mit leeren Listen

(Schliesst `PLAN-OPENAI.md:279` (c) / S4-Pre-Mortem PM-6.)
`GET /api/state` nutzt weiterhin `requestTenant` (`api-read.js:64`), NICHT
`requireTenant`. Ein `TENANT_REJECT` ergibt also 200 mit leeren Listen statt 403.
**Bewusst akzeptiert**, mit Begruendung: `/api/state` ist `internalOnly`
(`src/wiring/internal-only.js`), der EINE von aussen erreichbare Weg dorthin ist `/mcp`
— und den schliesst A4 bereits mit 403, bevor irgendein Werkzeug laeuft. Ein Wechsel
auf `requireTenant` wuerde die Fehlerform aller lesenden MCP-Werkzeuge aendern, ohne
einen zusaetzlichen Fall zu decken. Die Kehrseite (`settingsFor` legt per `||=` einen
`reject`-Bucket im Spiegel an; nicht persistiert, `flush` iteriert `state.tenants`)
wird als Spiegel-Muell hingenommen.
**Abnahme:** Testfall `E4-12` pinnt dieses Verhalten ausdruecklich (Entscheidung statt
Schweigen).

### A6 — Entscheidung: Diagnose-Retention folgt derselben Achse

(Schliesst `PLAN-OPENAI.md:279` (a) / S4-Pre-Mortem PM-4.)
`diagnosticRetentionGranted` liest nach A1 `store.tenantPrivateNumber(ctx.tenantId)`
des **aufloesten** Tenants (`api-calls.js:198-204`). Sollwert, ausdruecklich gewollt:
ruft Tenant B seine eigene hinterlegte Nummer an, ist `call.diagnostic === true` fuer
B — und NICHT mehr fuer den Bootstrap-Tenant. Das ist dieselbe Konvergenz wie in 2.5
und live bereits der Zustand (`MULTI_TENANT=true`). `src/diagnostic-retention.js` wird
NICHT angefasst; die Entkopplung vom Offenlegungs-Schalter bleibt (sie ist dort
begruendet).
**Abnahme:** Testfall `E4-23`.

### A7 — Neue Testdatei `test/e4-mandantentrennung-default.test.js`

Siehe Abschnitt 4. Dateiname und Testnamen beginnen mit `E4-` — das trifft weder
`config.i18nCatalogPattern`
(`^(Charakterisierung )?(DID|E2E|FMT|GAP|LANG|LAW|MCP|ORIG|OUT|PAY|PROMPT|UI|VOICE|WEB|WORLD)-[0-9]`)
noch `config.abnahmePattern` (`^ABNAHME-[A-Z0-9]`), die Faelle bleiben also im
Regressionslauf `npm test`. **`MCP-`, `GAP-`, `ABNAHME-` als Namensanfang sind
verboten** (Lehre `catalog-id-prefix-misroutes-tests`: ein so benannter Test wandert in
den Gates-Lauf, wo Rot erlaubt ist — der Riegel waere wirkungslos).

### A8 — Inventar-Test mit Positiv-Kontrolle (in dieselbe Datei)

(Nachbesserung 4 des S4-Pre-Mortems, vom Plan uebernommen, `PLAN-OPENAI.md:140`.)
Liest **alle** `src/routes/*.js` von Platte (`fs.readdirSync`, nicht vier feste Pfade)
und behauptet 0 Vorkommen von `multiTenant`. Dazu zwingend eine **Positiv-Kontrolle**:
dieselbe Suchfunktion, auf eine praeparierte Zeichenkette angewandt, MUSS anschlagen —
sonst ist "nichts gefunden" von "sucht nichts" nicht unterscheidbar (Lehre
`pruefkommando-ohne-positiv-kontrolle`). Zusaetzlich die Bestands-Gegenprobe: die
Datei-Liste ist nicht leer (mindestens die vier geaenderten Dateien sind enthalten).
**Ausdruecklich KEIN Beweis der Trennung:** dieser Test ist ohne A1 erfuellbar
(PM-2) — das steht als Kommentar im Test.

### A9 — Bestandstests invertieren (keine Assertion abschwaechen)

| Datei:Zeile (b901f4a) | heute gepinnt | danach |
|---|---|---|
| `test/read-scope-tenant.test.js:200-223` | "Flag aus: Legacy-Call OHNE tenantId bleibt sichtbar … `/api/calls/:id = 200`" | Legacy-Call in `/api/state` unsichtbar, `/api/calls/call_legacy` -> 404; B-Call fuer den Owner unsichtbar |
| `test/api-read-parity.test.js:146-156` | `body.calls.length === 2` ("Flag aus -> ungefilterte Bestandsliste") | `=== 1` (nur `call_owner`; der Mock-`exportTenantData` filtert nach `tenantId`) |
| `test/api-read-parity.test.js:281-295` | "Flag aus: fremder Call -> 200" | 404, Body `{ error: "not found" }` |
| `test/request-tenant-unit.test.js:234-249` | "Selbst mit gesetztem auth/tenant kurzschliesst der Flag-Check zuerst"; `store.calls` leer | `auth.sub` -> abgeleiteter Tenant, `req.tenant` -> dessen `tenantId`; der Lookup FINDET statt |
| `test/request-tenant-unit.test.js:464-476` | `requireTenant` mit `tenant:{tenantId:"B"}` -> `BOOTSTRAP` | -> `"B"`, kein 403 |
| `test/tenant-resolver-parity.test.js:119-127` (3x, je Factory) | "Flag aus -> Owner (byte-identisch, kein Lookup)" | "bekannter sub -> tenantId, unabhaengig von jeder Env" |

Zusaetzlich, weil A1 den `config`-Parameter entfernt: der Helfer `withMultiTenant`
(`test/request-tenant-unit.test.js:29-38`, 21 Vorkommen;
`test/tenant-resolver-parity.test.js:23-33`, 8 Vorkommen) mutiert danach ein Feld, das
der Resolver nicht mehr liest. **Er ist zu entfernen und seine Aufrufe flach zu ziehen**
— ein Testname "Flag AN/AUS", der keinen Flag mehr faehrt, ist eine Luege im Riegel, und
der Helfer selbst ist toter Code (CLAUDE.md). Die Testnamen verlieren dabei den
Flag-Zusatz; keine Assertion wird entfernt oder abgeschwaecht.

Voraussichtlich gruen und NICHT anzufassen (im Lauf bestaetigen, nicht annehmen):
`test/auth-p3-bootstrap-fallback.test.js` (AUTH-P3-4/-5/-8 fahren den identitaetslosen
Pfad ueber `:165`), `test/api-read-parity.test.js:224-241` (Slice-Grenzen; der Mock
liefert `exportTenantData`-Listen derselben Laenge), `test/api-read-parity.test.js:243-255`
(`call_owner` gehoert dem Default-Tenant), `test/oc-p1-owner-call-http.test.js`
(Allowlist auf `BOOTSTRAP_TENANT_ID`, Betreiber-Kanal), `test/callee-is-owner*.test.js`,
`test/iel-b1-schalter.test.js`, `test/iel-b10-geheimnisse.test.js`.

### A10 — Doku

- **`PLAN-SECURITY.md`**: Eintrag "E4 — Mandantentrennung vom Flag entkoppelt" mit (a)
  der Aussage, dass RLS keine Anfrage-Grenze ist (`src/store/pg.js` hydriert alle
  Mandanten in EINEN Spiegel) und die Anwendungs-Filterung ab jetzt die einzige,
  unbedingte Grenze ist; (b) dem Torschluss auf `/mcp`; (c) der Notiz zu Regel 2 aus
  Abschnitt 2 dieser Spec inkl. der beiden ausgeschlossenen Richtungen; (d) dem
  akzeptierten Risiko aus 2.3 Punkt 3 (`X-Internal-Tenant` von jedem host-lokalen
  Prozess) und aus A5. Pflicht nach CLAUDE.md ("Bei sicherheitsrelevanten Aenderungen:
  `PLAN-SECURITY.md` aktualisieren").
- **`.env.example:312-314`**: Kommentar korrigieren — `MULTI_TENANT` steuert kein
  Tenant-Scoping mehr, nur noch Self-Service-Reife (`isSelfServiceLive`) und eine
  Achse des `configHash`. Der **Wert** `MULTI_TENANT=false` (`:315`) bleibt stehen.
- **`render.yaml:688-692`**: derselbe Kommentar-Korrektur-Satz. Der Blueprint-**Wert**
  bleibt unveraendert (A0; er weicht live ohnehin ab, `render.yaml:14-17`).
- **`docs/RUNBOOK-LIVE-WERTE.md`**: F-i von UNKNOWN auf die vom Owner gelieferten Werte
  stellen, mit Quelle "Owner-Angabe" (nicht "gemessen") und Datum.

---

## 4. Tests

Alle Faelle in `test/e4-mandantentrennung-default.test.js`. Aufbau: Spawn-Server
**ohne** `MULTI_TENANT` im `env`-Override (es gilt der `BASE_ENV`-Wert `"false"`,
`test/helpers.js:349`), `MCP_AUTH=oauth`, zwei geseedete Tenants mit `idpSubject`
(Muster `test/read-scope-tenant.test.js` + `test/am6-oauth-tenant.test.js`,
Test-IdP-Helfer aus `test/helpers.js:1250ff` wiederverwenden). Fuer die Anruf-Faelle
zusaetzlich `FAKE_ORIGINATE=true` und `ELEVENLABS_OUTBOUND_ENABLED=false` (Muster
`test/oc-p1-owner-call-http.test.js:33-37`) — **sonst waere es ein echter Anruf mit
echten Kosten (Absolute Regel 1).**

**Trennung (der eigentliche Blocker P0-7):**

| ID | Fall | Erwartung |
|---|---|---|
| `E4-10` | A liest `/api/state` | keine `call.id` von B enthalten, eigene enthalten |
| `E4-11` | Legacy-Call ohne `tenantId` | fuer A und B unsichtbar (`/api/state` und `/api/calls/:id` -> 404) |
| `E4-12` | `/api/state` mit `TENANT_REJECT`-Identitaet | 200, Listen leer (A5-Entscheidung, ausdruecklich gepinnt) |
| `E4-13` | `GET /api/calls/<B-id>` als A, ebenso ueber `twilioSid` | je 404 |
| `E4-14` | `GET /api/calls/<B-id>/consult` als A | 404 |
| `E4-15` | `POST /api/calls/<B-id>/consult/answer` als A | 404; B's `context.key_facts` unveraendert |
| `E4-16` | `POST /api/calls/<B-id>/cancel` als A | 404; B's `status` weiter `active` |
| `E4-17` | `POST /mcp`, gueltiges Token, `sub` ohne Tenant | 403, Body exakt der Wortlaut, keine `"tools"` im Body |
| `E4-18` | `POST /mcp`, gueltiges Token, bekannter `sub` | 200 mit Werkzeugliste (Positiv-Kontrolle zu `E4-17`) |
| `E4-19` | identitaetsloser Loopback ohne XFF | `/api/state` -> 200 mit den Bootstrap-Listen (Betreiber-Kanal unveraendert) |

**Absolute Regel 2 — die beiden Fehlerrichtungen (Pflicht):**

| ID | Fall | Erwartung | faengt |
|---|---|---|---|
| `E4-20` | `OWNER_SELF_CALL_ENABLED=true`, `OWNER_SELF_CALL_TENANT_IDS=<echte tenantId von A>` (NICHT `owner`), `MULTI_TENANT` ungesetzt; A ruft mit eigener Identitaet seine hinterlegte Nummer an | `call.calleeIsOwner === true` am Datensatz | **Richtung A** (scharf faellt ab -> Owner hoert den Dritt-Satz) |
| `E4-21` | derselbe Aufbau; **B** ruft **B's** hinterlegte Nummer an | `call.calleeIsOwner === false` | **Richtung B** (inert wird scharf -> Dritter ohne Pflichtsatz) |
| `E4-22` | derselbe Aufbau; **B** ruft **A's** hinterlegte Nummer an | `call.calleeIsOwner === false` | Richtung B, zweiter Riegel (Ziel-Bedingung unabhaengig von der Allowlist) |
| `E4-23` | derselbe Aufbau; B ruft B's hinterlegte Nummer an | `call.diagnostic === true` fuer B, der Datensatz gehoert B | A6-Sollwert (Diagnose-Retention folgt der echten Achse) |
| `E4-24` | Allowlist auf `<echte tenantId von A>`, Anruf ueber den **identitaetslosen Betreiber-Kanal** (Loopback ohne XFF -> `BOOTSTRAP_TENANT_ID`) | `call.calleeIsOwner === false` | Gegenprobe: der Bootstrap-Tenant erbt die Ausnahme nicht |

`E4-20` bis `E4-24` sind der Kern dieser Etappe. **Wird einer von ihnen rot, ist das
kein Testproblem, sondern ein Rechtsverstoss-Risiko — kein Merge.**

**Riegel:**

| ID | Fall | Erwartung |
|---|---|---|
| `E4-30` | Inventar ueber alle `src/routes/*.js` | 0 Vorkommen `multiTenant`; Datei-Liste nicht leer |
| `E4-31` | Positiv-Kontrolle desselben Suchcodes auf praeparierter Zeichenkette | schlaegt an |

---

## 5. Zwangspunkte und Zaehler (Ist -> Soll, gemessen an b901f4a)

| Zwangspunkt | Ist (b901f4a) | Soll nach E4 | Grund |
|---|---|---|---|
| `test/route-auth-inventory.test.js` `ROUTE_FINGERPRINT` (`:174-252`) | 66 Eintraege | **66 (unveraendert)** | E4 fuegt keine Route hinzu und entfernt keine; A4 ist ein `if` IM bestehenden Handler, keine neue Middleware und kein neuer Mount |
| `test/config-namespaces.test.js` `EXPECTED_TOTAL_KEYS` (`:208`) | 199 | **199 (unveraendert)** | kein neuer Env-Schluessel, kein entfernter; `src/config.js:2295` unveraendert |
| `test/config-namespaces.test.js` `EXPECTED_PRIMITIVE_LEAVES` (`:375`) | 185 | **185 (unveraendert)** | dito (199 − 7 Arrays − 7 nested Objekte) |
| `test/helpers.js` `BASE_ENV` | `MULTI_TENANT: "false"` (`:349`), `OWNER_SELF_CALL_ENABLED: "false"` (`:206`), `OWNER_SELF_CALL_TENANT_IDS: ""` (`:207`) | **unveraendert** | kein neuer Env-Schluessel -> keine BASE_ENV-Drift (Lehre `test-base-env-drift`). Die `MULTI_TENANT`-Zeile bleibt bewusst stehen: sie schuetzt weiter gegen `.env`-Leak in Spawn-Tests, auch wenn der Wert fuer die Trennung bedeutungslos wird |
| `scripts/probe-auth.sh` | 60 Tabellenzeilen; `sitzung\|POST\|/mcp\|401\|mcpauth` (`:121`) | **unveraendert** | A4 sitzt hinter `mcpAuth`; ein Request ohne Token erreicht ihn nie und bleibt 401. `test/probe-auth-table.test.js` (Abdeckungsregel gegen den Routen-Graph) bleibt gruen |
| `.env.example` | `MULTI_TENANT=false` (`:315`) + Kommentar (`:312-314`) | **Wert unveraendert, Kommentar korrigiert** (A10) | `test/iel-b1-schalter.test.js:238` prueft nur die Existenz der `OWNER_SELF_CALL_*`-Zeilen — unberuehrt |
| `render.yaml` | `MULTI_TENANT` (`:689`) + Kommentar (`:688-692`) | **Wert unveraendert, Kommentar korrigiert** (A10) | Blueprint bleibt der Divergenz-Befund; `test/prod-env.js` ist ein Register ohne Zaehler und wird NICHT angefasst |
| `/healthz` `configHash` (`src/config-fingerprint.js:30`) | Achse `multiTenant` vorhanden | **unveraendert** | A0: das Flag bleibt definiert und bleibt Achse; `test/gap-36-healthz-fingerprint.test.js` bleibt gruen |
| Testbestand `npm test -- --test-concurrency=4` | Baseline-Lauf auf `master` **vor** dem Bau messen und notieren | **>= Baseline** | kein stiller Verlust; die neue Datei erhoeht die Zahl |

> **WARNUNG — Zahlen VOR dem Merge noch einmal messen.** Jede Zahl oben ist am Stand
> b901f4a gemessen. Laeuft parallel eine andere Kette, sind die Zahlzeilen
> (`EXPECTED_TOTAL_KEYS = 199`, `EXPECTED_PRIMITIVE_LEAVES = 185`,
> `ROUTE_FINGERPRINT`-Liste) **identische Zeilen in zwei Branches** — Git fuehrt sie
> still und konfliktfrei zusammen, und das Ergebnis ist falsch, ohne dass ein
> Merge-Konflikt es meldet. Direkt vor dem Merge neu messen; ein Workflow-PASS ist
> keine Merge-Freigabe (Lehre `workflow-pass-is-not-merge-approval`,
> `sec-fix-chain-complete` "Merge-Falle: Zaehler neu messen").

---

## 6. Blast Radius

- **Quellcode:** 4 Dateien, 5 Code-Stellen + 1 Torschluss (`src/routes/_tenant.js:145`
  und `:15/:113-115`, `src/routes/api-read.js:70` und `:105`,
  `src/routes/api-calls.js:379`, `src/routes/mcp.js:85`).
- **Tests:** 1 neue Datei; 6 Bestandsfaelle in 4 Dateien invertiert; 2 Helfer
  (`withMultiTenant`) mit zusammen 29 Vorkommen entfernt.
- **Doku:** 4 Dateien (`PLAN-SECURITY.md`, `.env.example`, `render.yaml`,
  `docs/RUNBOOK-LIVE-WERTE.md`).
- **Aufrufer von `requestTenant`/`requireTenant`** (die Menge, die A1 beruehrt):
  `src/routes/api-read.js`, `api-calls.js`, `api-tenant-write.js`, `api-billing.js`,
  `api-inbox.js`, `routes/mcp.js`, `src/telephony/outbound-gates.js:680`.
- **Wirkung in der Gate-Kette:** `ctx.tenantId` ist nicht mehr per Flag auf Bootstrap
  gepinnt — `tenant_reject` (`outbound-gates.js:687-696`) feuert erstmals auch bei
  ungesetztem Flag, und Stundendecke, Pro-Ziel-Cap, Kostendecke und Reserve zaehlen auf
  die echte Achse. **Pro Tenant ist das Verschaerfung.** Die Gate-Kette selbst wird
  nicht angefasst (`test/outbound-gates-order.test.js` bleibt unveraendert, 18 Glieder
  in unveraenderter Reihenfolge).
- **Akzeptiertes Risiko (S4-Pre-Mortem PM-5, ehrlich benannt):** im **Aggregat** ist
  N x Tenant-Decke gegenueber einem geteilten Bootstrap-Topf eine Lockerung, weil die
  Plattform-Achse seit E10 nur noch Beobachtung ist (CLAUDE.md). Verbleibende
  Bremsklotze: Abo+KYC vor Outbound, `MAX_NUMBERS`, `MAX_NUMBERS_PER_TENANT`,
  `OUTBOUND_FROZEN`.
- **Akzeptiertes Risiko (2.3 Punkt 3):** `X-Internal-Tenant` von jedem host-lokalen
  Prozess ohne XFF. Bestand, live bereits offen, durch E4 nicht vergroessert.
- **Kein** neuer Env-Schluessel, **keine** Aenderung eines Live-Werts, **keine**
  DB-Aenderung, **kein** Backfill (F-g = 0 Anrufe ohne `tenant_id`, Spalte ist
  `NOT NULL`), **keine** neue Dependency, **kein** neuer Endpunkt, **keine** Aenderung
  an `src/route-policy.js` (`/mcp` bleibt in der Oeffentlich-Liste; die Auth-Lage wird
  strenger, nicht anders).

---

## 7. Messungen vor und nach dem Merge

| ID | Wann | Handgriff | Abbruchkriterium |
|---|---|---|---|
| **M1** | VOR dem Merge | `curl -si -X POST https://app.sundartha.com/mcp` | Body `{"error":"Kein Token"}` **plus** Header `WWW-Authenticate: Bearer resource_metadata=…` beweist `MCP_AUTH=oauth` (`src/auth.js:63-71`). Body `{"error":"unauthorized"}` **ohne** diesen Header beweist `token`/Legacy — dann ist **A4 Merge-Blocker** und die Modus-Umstellung eine eigene Owner-Entscheidung. Der Status allein unterscheidet die Modi NICHT. |
| **M2** | VOR dem Merge | `configHash` aus `GET /healthz` gegen die lokal nachgerechneten sieben Achsen (`src/config-fingerprint.js:25-35`) | Reproduziert der Live-Hash nicht mehr den Kandidaten mit `multiTenant=true`, ist die Praemisse aus Abschnitt 0 gefallen -> **kein Merge**, neu bewerten (Methode: `docs/RUNBOOK-LIVE-WERTE.md:24`) |
| **M3** | VOR dem Merge | `npm test -- --test-concurrency=4` auf `master` als Baseline; Testzahl notieren | ohne Baseline ist "keine Tests verloren" nicht pruefbar. **Immer mit `--test-concurrency=4`** (Lehre `sec-testbank-parallel-race`) |
| **M4** | NACH dem Deploy | EIN echter Werkzeugaufruf aus dem verbundenen Client (`get_my_number` oder `check_inbox`) mit erwartetem Inhalt | **Positiv-Kontrolle fuer A4.** "`/mcp` ohne Token weiter 401" ist KEIN Beleg — das waere auch dann gruen, wenn A4 jeden authentifizierten Request 403t. Ohne M4 gilt A4 als unbelegt |
| **M5** | NACH dem Deploy | `GET /api/self-service/state` weiter 401 (Self-Service unveraendert gemountet) | ein 404 dort hiesse: `isSelfServiceLive` ist gekippt |
| **M6** | NACH dem Deploy | EIN Owner-Testanruf auf die eigene hinterlegte Nummer; `call.calleeIsOwner` am Datensatz pruefen | **Regel-2-Abnahme am lebenden System.** `false` heisst Richtung A ist eingetreten -> sofort Rollback |

**Rollback-Kriterium:** tritt M4 oder M6 nicht ein, wird der Merge-Commit revertiert
(ein Commit, ein Revert — das ist der Grund fuer die Ein-Commit-Regel). Deploy laeuft
ueber den Upstream (Memory `deploy-repo-split`); `git push origin` macht nichts live.

---

## 8. Verifikation (Abnahme der Etappe)

1. `for f in src/routes/_tenant.js src/routes/api-read.js src/routes/api-calls.js src/routes/mcp.js; do node --check "$f"; done` — keine Ausgabe.
2. `grep -rn "multiTenant" src/routes/` — 0 Treffer.
3. `node --test test/e4-mandantentrennung-default.test.js` — gruen, inkl. `E4-20` bis `E4-24`.
4. `node --test test/request-tenant-unit.test.js test/tenant-resolver-parity.test.js test/auth-p3-bootstrap-fallback.test.js test/read-scope-tenant.test.js test/api-read-parity.test.js test/oc-p1-owner-call-http.test.js` — gruen.
5. `npm test -- --test-concurrency=4` — gruen, Testzahl >= M3-Baseline.
6. `npm run test:gates` — Zaehler nicht schlechter als vor der Etappe (darf rot sein, aber nicht roter).
7. Smoke lokal: `PORT=3999 SKIP_TWILIO_SIGNATURE_CHECK=true npm start`, dann
   `curl -s localhost:3999/healthz` = 200 und `curl -s localhost:3999/api/state` = 200
   mit den Bootstrap-Listen (Betreiber-Kanal unveraendert). **Ueber `localhost`, nicht
   ueber die LAN-IP** (Lehre `local-loopback-bypasses-auth-gate`).
8. M1-M6 aus Abschnitt 7 abgearbeitet und im Phasen-Report belegt.

---

## 9. Verbote

- **V1 — kein Scope-Zuwachs.** Nur A1-A10. Kein `getCall`-Export-Entzug, kein Umbau der
  Store-Schicht, keine Datenzugriffsschicht `getCallFor`, kein Rename und keine
  Entfernung von `MULTI_TENANT`, kein Boot-Riegel gegen `MULTI_TENANT=false`, keine
  Entruempelung der ~40 Tests, die `MULTI_TENANT: "true"` explizit setzen.
- **V2 — keine Aufweichung absoluter Regeln.** `src/callee-is-owner.js` wird nicht
  angefasst. Kein Gate entfernt, aufgeweicht oder per Default umgangen. Die
  pro-Tenant-Kostendecke, `OUTBOUND_FROZEN`, Denylist/Land-Gate/Stundenlimit,
  Max-Gespraechsdauer und die Provider-Signaturpruefung bleiben unveraendert.
- **V3 — `operatorChannelTenant`, `isTrustedLocalCaller`, `trustedLocalHeader` und die
  Reihenfolge ab `_tenant.js:146` bleiben unveraendert.** A1 entfernt genau eine Zeile
  Logik.
- **V4 — keine zweite Wahrheit.** Kein Client-Flag, kein MCP-Parameter, kein
  KI-Ermessen ueber das Praedikat; keine zweite Stelle, die "ist das ein Owner-Anruf?"
  beantwortet; kein zweites Literal `"reject"`; EIN Wortlaut fuer die
  Tenant-Ablehnung.
- **V5 — kein `eslint-disable`, kein uebersprungener Test, kein `--no-verify`, kein
  Anheben eines Altlast-Pins** in `eslint-legacy-exceptions.json`
  (`test/check-staged-suppressions.test.js`, "Altlast-Ratsche").
- **V6 — kein Push, kein Merge ohne die Messungen aus Abschnitt 7.** Produktion nur
  **lesend** (M1, M2, M5 sind read-only; M4/M6 sind der bewusst freigegebene
  Positiv-Beleg). Keine DDL, kein Backfill, keine Aenderung im Render-Dashboard aus der
  Umsetzung heraus.
- **V7 — Testnamen beginnen nicht mit einer Katalog-Kennung** (`MCP-`, `GAP-`,
  `PROMPT-`, `ABNAHME-`, …), sonst wandert der Riegel in einen Lauf, in dem Rot
  erlaubt ist.

---

## 10. UNKNOWN / offen

1. **Produktfrage, nicht Teil dieser Etappe:** soll ein gueltiges Token ohne
   Tenant-Zuordnung ueber `/mcp` automatisch provisioniert werden statt 403 zu
   bekommen? Owner-Entscheidung **E-5** (`PLAN-OPENAI.md:60-66`) ist auf 403
   (fail-closed) entschieden; diese Spec baut genau das. Sie blockiert nur die Aussage
   "die Integration ist fuer Fremdnutzer benutzbar".
2. **UNKNOWN:** ob die gelieferte tenantId `t_user_01KX600834GCJFV9GTZQKWZMTH` in der
   Produktions-DB einen Datensatz mit gesetzter `privateNumber` traegt, wurde fuer
   diese Spec **nicht** gelesen (Prod-Lesezugriff nicht Teil des Auftrags; der
   Sandbox-Classifier blockt Prod-Reads aus Subagenten, Lehre
   `classifier-blockt-testanrufe`). Die Aussage haengt nicht daran: die 35 Live-Treffer
   `callee_is_owner=true` beweisen, dass Allowlist, Schalter und hinterlegte Nummer zum
   Zeitpunkt dieser Anrufe alle drei gepasst haben. M6 belegt es nach dem Deploy direkt.
3. **UNKNOWN:** ob `OWNER_SELF_CALL_TENANT_IDS` live GENAU diesen einen Eintrag traegt
   oder weitere. Der Owner hat einen genannt; die Spec behandelt die Liste als
   "mindestens dieser eine". Fuer beide Fehlerrichtungen ist das folgenlos — die
   Allowlist-Semantik aendert sich nicht, nur ihr Inhalt, und der Inhalt ist nicht Teil
   dieser Etappe.
4. **UNKNOWN:** der Live-Wert von `MULTI_TENANT` ist ueber den `configHash` bewiesen,
   aber der Dienst ist dashboard-verwaltet — der Wert kann sich zwischen Messung und
   Merge aendern. Deshalb M2 unmittelbar vor dem Merge.
