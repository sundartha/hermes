# Phase A — Single-Origin-Deployment (app.sundartha.com)

**Entscheidung (Owner bestaetigt 2026-06-27):** A1 (Gateway serviert alles) + Produkt auf
`app.sundartha.com`, Marketing bleibt Static auf `sundartha.com`.

## Verifizierter Live-Stand (curl + Render-MCP, NICHT geraten)

- `app.sundartha.com` -> CNAME -> Gateway `vodafone-agent.onrender.com`; SSL ok; `/healthz` 200;
  `/` 302 -> `/auth/login`; WorkOS-`redirect_uri` schon = `app.sundartha.com/auth/callback`. ✅
- `app.sundartha.com/api/self-service/state` -> **401** (Route live, auth-gated). ✅
- `app.sundartha.com/app` -> **"Cannot GET /app"** (Gateway baut/serviert apps/web NICHT). ❌
- Gateway-Live-Konfig (Render-MCP, weicht von render.yaml ab!): autoDeploy=**yes**(commit),
  buildCommand=**`npm install`**, healthCheckPath=leer, plan=free. -> Service ist NICHT sauber
  Blueprint-synct; render.yaml ist NICHT die Quelle der Wahrheit fuer dieses Service.
- `sundartha.com`/`www` -> Static `hermes-web`; `sundartha.com/app` -> 200 (laedt, aber relative
  `/api` 404 -> kaputt). Static PUBLIC_GATEWAY_URL = `https://vodafone-agent.onrender.com`.

## Einziger verbleibender Bruch

Der Gateway baut + serviert das apps/web-Astro-Build nicht. Serving-Code existiert
(`src/server.js:339-357`, Flag `WEB_DIST_DIR`); `routes.js` verlangt `PUBLIC_GATEWAY_URL`
(fail-closed); `config.js:443` = **Boot-Refusal**, wenn `WEB_DIST_DIR` gesetzt aber kein
`dist/index.html` -> ORDERING: erst bauen, dann WEB_DIST_DIR.

## Aenderung (3 Teile)

1. **Gateway buildCommand** (Dashboard, da nicht blueprint-synct):
   `npm install && npm --prefix apps/web ci && PUBLIC_GATEWAY_URL=https://app.sundartha.com npm --prefix apps/web run build`
   (PUBLIC_GATEWAY_URL inline = nur Build-Zeit, kein Runtime-Env.)
2. **Gateway env** `WEB_DIST_DIR=apps/web/dist` — **ZULETZT** (via Render-MCP), erst nach
   erfolgreichem Build mit (1).
3. **Static `hermes-web`** (Polish, nicht blockierend): `/app/*` -> Redirect auf
   `https://app.sundartha.com/app`; Static `PUBLIC_GATEWAY_URL` -> `https://app.sundartha.com`
   (Marketing-Funnel-Links auf die App-Domain).

## buildFilter / W0 (Empfehlung)

`apps/web/**` aus den Gateway-`ignoredPaths` entfernen, damit App-Aenderungen
auto-deployen. Kosten: ein reiner Marketing-Edit redeployt den Gateway (Blast-Radius klein:
Live=Budget-Engine, turn-basiert -> max. ein verworfener Turn, kein Realtime-Call). Voll-
Wiederherstellung von W0 (Build-Split / feinere Pfad-Filter) = dokumentiertes Folge-Ticket.

## Safe staged Apply-Sequenz

1. Owner: Gateway-Build-Command (1) im Dashboard setzen -> Manual Deploy. WEB_DIST_DIR noch
   LEER -> Serving aus -> byte-identisch, kein Risiko. Deploy gruen abwarten.
2. Ich (MCP): `WEB_DIST_DIR=apps/web/dist` setzen -> finaler Deploy aktiviert Serving.
3. Verifizieren (unten). 4. Static-Polish (3). 5. render.yaml -> upstream pushen (konvergieren),
   ERST nach gruener Verifikation (sonst Partial-Sync-Boot-Risiko).

## Erwartetes Ergebnis (deterministisch) + Verifikation — STATUS 2026-06-27

- [x] `/app` -> **301 -> /app/**, `/app/` -> **200** Astro-App-Shell ("Hermes — App"),
      Funnel-Link = `https://app.sundartha.com/auth/login` (same-origin), `/_astro/*.css` -> 200.
- [x] `/` (Root) -> **200** Marketing-Index (vorher 302 -> /auth/login).
- [x] `/api/self-service/state` ausgeloggt -> **401** (Route auth-gated; vorher 404).
- [x] Chrome EINGELOGGT (bestehende Session): `/app/` zeigt echten State ("Account awaiting
      activation" + Plaene) statt "Something went wrong". Netzwerk-Trace:
      `GET app.sundartha.com/api/self-service/state -> 403` (Cookie faehrt mit = authentifiziert,
      Tenant pending), `GET .../billing/status -> 200`. **same-origin bewiesen.**
- [x] Gateway durchgehend telefonie-faehig: `/healthz` 200, kein Boot-Refusal, `/auth/login` 302 WorkOS.
- [x] Marketing-Funnel `sundartha.com` zeigt im "Sign in" schon auf `app.sundartha.com/auth/login`.

## OFFEN (klein, nicht blockierend fuer Phase A)
- [ ] Static-Polish: `sundartha.com/app` liefert noch das alte kaputte Frontend (200, relative
      /api -> 404). Defensiv: hermes-web Redirect-Regel `/app/*` -> `app.sundartha.com/app`.
- [ ] S2 (Nummer nach Abo sichtbar) = Phase C; braucht aktives Test-Mode-Abo.
- [ ] render.yaml dokumentiert (unten); Service ist dashboard-managed -> NICHT blind nach
      upstream pushen (andere Divergenzen autoDeploy/healthCheck/MULTI_TENANT wuerden zurueckschlagen).
