# Spec AUTH-P5 — `internalOnly` + Audit-Ersatz

Autoritative Definition der Phase. Vorrang vor `PLAN-AUTH-GATE.md` (dort Abschnitt 7,
`### P5`). Was hier nicht steht, ist nicht Teil der Phase.

## Ziel 1: `internalOnly` vor sieben Routen

Neue benannte Middleware in `src/wiring/internal-only.js`:

```
isTrustedLocalCaller(req) ? next() : 403
```

`isTrustedLocalCaller` (`src/routes/_tenant.js`) ist dieselbe Vertrauensgrenze, die
AUTH-P3 bereits nutzt — **keine neue Trust-Idee**, und sie wird an genau EINER Stelle
formuliert (G5).

Sie kommt vor diese **sieben** Routen:

| Route | Datei |
| --- | --- |
| `POST /api/calls` | `src/routes/api-calls.js` |
| `POST /api/calls/:id/cancel` | `src/routes/api-calls.js` |
| `GET /api/calls/:id/consult` | `src/routes/api-calls.js` |
| `POST /api/calls/:id/consult/answer` | `src/routes/api-calls.js` |
| `GET /api/state` | `src/routes/api-read.js` |
| `GET /api/calls/:id` | `src/routes/api-read.js` |
| `GET /api/tenant-data/export` | `src/routes/api-read.js` |

**Warum `internalOnly` und nicht `webAuthMw` (Plan-Entscheidung 1, nicht neu aufrollen):**
ausschliesslicher Aufrufer dieser Routen ist der In-Process-MCP-Pfad; `apps/web` hat
keinen Treffer fuer `consult`. Eine Web-Session waere die falsche Sicherung fuer einen
Kanal, der nie einen Browser sieht.

**Ausserhalb des Umfangs, bewusst ausgelagert:** ein Werkzeug fuer den manuellen
DSGVO-Auskunftsweg gehoert nicht in diesen Plan (Merkposten `PLAN-TENANT-EXPORT.md`).
Hier passiert nur die Einstufung von `/api/tenant-data/export` — eine Zeile
Klassifikation, kein Ersatzwerkzeug.

## Ziel 2: Audit-Ersatz — abgelehnte Anfragen werden sichtbar

Heute schreibt **nur** das Basic-Auth-Gate `audit("auth_failed", ...)`. Faellt es in P7,
verschwindet der einzige Meldeweg fuer abgewiesene Zugriffe. Deshalb schreiben ab dieser
Phase **`webAuthGateMiddleware`, `adminOnlyMiddleware` und `internalOnly`** im
Ablehnungszweig ebenfalls `audit("auth_failed", req, ...)`.

### W9 — der Fehler, den man hier machen kann, per Test ausschliessen

`util.audit` loggt `action`, `req.ip` und `details`. Das Gate uebergibt heute
`path=${req.path}` — **`req.path` traegt keinen Query-String**, also leakt heute nichts.
Eine Neuimplementierung mit `req.originalUrl` wuerde den OAuth-`code` (`/auth/callback`)
und die `session_id` (`/api/billing/checkout-return`) mitloggen. Das waere ein Verstoss
gegen Absolute Regel 4.

**Pflichttest:** der Audit-Eintrag einer abgelehnten Anfrage mit
`?session_id=XYZ&code=ABC` enthaelt **weder `XYZ` noch `ABC`**.

### H11 — Grund-Token, PII-frei

`auth_failed` bekommt einen groben Grund: `reason=no_session` / `expired` / `not_admin` /
`not_local`. Ohne ihn erzeugt die 1-Stunden-Session-TTL ohne Rolling ein Dauerrauschen,
in dem ein echter Angriff untergeht. Die Token sind eine **feste, benannte Menge** — kein
freier Text, keine Nutzerdaten, keine Pfade mit Parametern.

## Was sich am Routen-Inventar aendert (im SELBEN Commit, H10)

1. `src/route-policy.js`: `AUTH_MIDDLEWARE_NAMES` bekommt **`internalOnly`** dazu (P1 hat
   das ausdruecklich vorgesehen: "`internalOnly` (P5) wird ebenfalls benannt"). Die
   sieben Routen fallen aus `GATE_ONLY_ROUTES` — sie klassifizieren ab jetzt als `AUTH`.
2. `test/route-auth-inventory.test.js`: `ROUTE_FINGERPRINT` bleibt **unveraendert** (die
   Routen existieren weiter). Der Test, der die Anwesenheit der benannten Middlewares im
   Graph prueft, deckt `internalOnly` mit ab.
3. `scripts/probe-auth.sh`: **die Tabelle bleibt unveraendert.**

### Zu Punkt 3 — hier ist der Plantext ungenau, und das gehoert festgehalten

Der Plan sagt unter H10, die Erwartung fuer `/api/state` wechsle in P5 "von 401 (Gate)
auf 403 (`internalOnly`)". **Am gemessenen Verhalten der Probe stimmt das nicht.** Das
Basic-Auth-Gate ist in `src/app.js` **vor** allen `/api`-Routern gemountet; eine
Anfrage **ohne** Credentials — und genau so laeuft die Probe, das ist ihr Sinn — wird vom
Gate mit 401 beantwortet, bevor `internalOnly` ueberhaupt laeuft.

Der 403 wird erst sichtbar, wenn (a) jemand **mit** gueltigen Basic-Credentials von
aussen anfragt, oder (b) das Gate in P7 faellt. Fuer die Probe heisst das: die sieben
Zeilen bleiben `sitzung | 401 | gate`, und **P7** dreht sie auf 403. Wer sie in dieser
Phase auf 403 setzt, macht die Probe rot, ohne dass ein Defekt vorliegt — genau die
Geste, die H10 verhindern will.

Der 403 wird deshalb **im Test** nachgewiesen, nicht in der Live-Probe (siehe Abnahme).

## Abnahme (maschinell)

1. Externer Request (gesetzter `X-Forwarded-For`) auf `/api/state`,
   `/api/tenant-data/export` und `/api/calls/:id/consult` -> **403**, und zwar **ohne**
   sich auf das Basic-Auth-Gate zu verlassen (im Spawn-Test ist kein
   `DASHBOARD_PASSWORD` gesetzt — der Test misst damit wirklich `internalOnly`).
2. In-Process-Aufruf (Loopback ohne `X-Forwarded-For`) -> unveraendert **200**; der
   MCP-Tool-Pfad bleibt bedient.
3. **Ein** Audit-Eintrag pro Ablehnung, je Middleware einer, mit dem passenden
   `reason`-Token.
4. Secret-Leak-Test: Ablehnung mit `?session_id=XYZ&code=ABC` -> Audit-Eintrag enthaelt
   weder `XYZ` noch `ABC`.
5. `npm test` gruen. Rot-vor-Fix: `internalOnly` testweise auf `next()` gedreht -> genau
   die neuen 403-Tests werden rot. Mutation zuruecknehmen.

## Nicht-Ziele (bindend)

- **Kein** Anfassen von `src/wiring/auth-gate.js` (P7).
- **Kein** `webAuthMw`/`adminMw` vor Betreiber-Routen (P6) — nur der Audit-Zweig dieser
  beiden Middlewares wird ergaenzt.
- `/api/tenant-data/export` bekommt **`internalOnly`**, nicht `webAuthMw`
  (Plan-Entscheidung 1).
- **Keine** neue Env-Variable, **kein** neues Flag, **keine** neue Dependency.
- **Kein** Ersatzwerkzeug fuer den DSGVO-Auskunftsweg.

## Risiko, das benannt gehoert (Pre-Mortem)

Ein Jahr spaeter, die Entscheidung war falsch: `internalOnly` hat in Produktion **alles**
abgewiesen, weil hinter Render auch der interne Verkehr `X-Forwarded-For` traegt — die
MCP-Tools liefern seitdem Fehler statt Daten, und weil die 403 sauber aussieht, hat es
niemand als Ausfall gelesen.

Diese Annahme traegt bereits AUTH-P3; P5 macht sie zum **Gate**. Gegenmassnahme:
der In-Process-Pfad wird per Test gepinnt, und der Bericht nennt das Abbruchsignal
ausdruecklich — **MCP-Tools in claude.ai liefern Fehler statt Daten -> sofortiger
Rollback**. Zusaetzlich hilft der neue Audit-Eintrag: ein `reason=not_local` auf einer
MCP-Route ist im Render-Log genau der Beleg, den man dann sucht.
