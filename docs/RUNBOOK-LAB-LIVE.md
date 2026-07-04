# RUNBOOK: Lab -> Live (Marketing-Website `apps/web`)

Zweck: Design-/Content-Aenderungen an der Marketing-Site gefahrlos ausprobieren
(Labor) und erst nach Sichtpruefung bewusst live schalten. Der live
telefonierende Gateway-Prozess (`vodafone-agent`) ist von diesem Workflow
konstruktiv isoliert (buildFilter + autoDeploy:false + eigener Service).

## Services (Render, Stand 2026-07-03)

| Rolle | Service | Branch | URL | Deploy |
|---|---|---|---|---|
| Labor | `hermes-web-staging` (srv-d93r4jnlk1mc739s504g) | `staging` | https://hermes-web-staging.onrender.com | automatisch bei Push |
| Live | `hermes-web` (srv-d8tbfghkh4rs73bs63pg) | `master` | sundartha.com | MANUELL |

Das Labor traegt `X-Robots-Tag: noindex` (kein SEO-Leak) und spiegelt die
Live-CSP (`default-src 'self'; script-src 'self'; ...`) — was im Labor
funktioniert, funktioniert auch live; was die CSP blockt, faellt schon im
Labor auf. `PUBLIC_GATEWAY_URL` ist gesetzt (routes.js ist fail-closed,
ohne die Var bricht der Build ab).

## Workflow

1. **Im Labor arbeiten:** Aenderungen auf dem `staging`-Branch, fuer
   Website-Arbeit NUR unter `apps/web/`. Lokale Iteration:
   `npm --prefix apps/web run dev`.
2. **Staging pruefen:** `git push origin staging` -> Auto-Deploy.
   Sichtpruefung auf https://hermes-web-staging.onrender.com — Desktop,
   mobil, Browser-Konsole (CSP-Verstoesse erscheinen dort).
3. **Live schalten (bewusster, expliziter Schritt):**
   - `git checkout master && git merge staging && git push origin master`
   - Deploy ausloesen (autoDeploy ist live aus):
     `curl -X POST -H "Authorization: Bearer $RENDER_API_KEY" https://api.render.com/v1/services/srv-d8tbfghkh4rs73bs63pg/deploys`
     (Key: `.claude/settings.local.json` -> `env.RENDER_API_KEY`;
     alternativ Render-Dashboard -> Manual Deploy)
   - Live-URL komplett durchscrollen + Konsole pruefen.
4. **Rollback:** Render-Dashboard -> Deploys -> vorheriger Deploy ->
   Rollback (Sekunden). Danach Ursache im Code per `git revert` beheben.

## Leitplanken

- Auf `staging` fuer Website-Arbeit NUR `apps/web/**` anfassen. `src/**`
  gehoert nicht in diesen Workflow (eigener Branch/Task) — sonst schleppt
  der Live-Merge ungewollt Gateway-Aenderungen mit.
- Der Gateway-Service (`vodafone-agent`) wird ueber diesen Workflow NIE
  deployt — er telefoniert live; sein Deploy bleibt ein eigener,
  bewusster Vorgang (siehe render.yaml-Kommentare).
- CSP beachten: keine Inline-Skripte, kein `eval`. three.js/WebGL ist mit
  `script-src 'self'` kompatibel, solange alles gebundelt ist.
- `public/`-Assets werden nicht gehasht: bei Aenderungen Dateinamen
  versionieren und pfadgenaue Cache-Header mitziehen (Muster: Hero-Video
  in render.yaml).
