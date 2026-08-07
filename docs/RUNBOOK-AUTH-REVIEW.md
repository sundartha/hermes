# RUNBOOK — Auth-Review (quartalsweise)

**Takt: einmal pro Quartal.** Verantwortlich: der Owner.

## Wozu das hier existiert

Seit PLAN-AUTH-GATE P1 prueft `test/route-auth-inventory.test.js` bei jedem
`npm test` maschinell, dass **jede** registrierte Route entweder eine benannte
Auth-Middleware traegt oder in `src/route-policy.js` bewusst eingeordnet ist. Das
ersetzt die Sammelsicherung des alten Basic-Auth-Gates.

Der Test hat **drei Klassen von blinden Flecken**, die er nicht sehen kann. Genau
dafuer gibt es diese Liste — hier traegt ein Mensch die Last, kein Mechanismus. Wird
der Punkt ausgelassen, meldet nichts.

1. **Auth im Handler-Rumpf.** Der Test liest nur route-level Middleware. Eine
   Pruefung, die im Handler steht, ist fuer ihn unsichtbar — die Route sieht wie eine
   bewusste Ausnahme aus, auch wenn die Pruefung darin geloescht wurde.
2. **Praefix-Middleware eines Routers.** `/voice/*` wird von einer
   Signatur-Middleware geschuetzt, die vor der Route-Gruppe sitzt, nicht an der
   einzelnen Route.
3. **Flag-gegatete Routen.** Was nur bei gesetztem Flag registriert wird, taucht im
   geprueften Graph gar nicht auf (heute: `POST /auth/dev-login` bei
   `DEV_LOGIN_ENABLED`).

## Checkliste

Alle Fundstellen ueber `grep` suchen, **nie ueber Zeilennummern** — die driften.

| # | Route | Was geprueft wird | Beleg-Anker |
| --- | --- | --- | --- |
| 1 | `GET /voice/tts/:token` | Der Token wird weiterhin **einmalig** verbraucht (`takeOnce`), die TTL ist gesetzt, und die Route liegt weiterhin VOR der Signatur-Middleware und wurde nicht versehentlich oeffentlich erweitert. | `grep -n 'voice/tts/:token' src/routes/voice.js` · Handler ruft `ttsStore.takeOnce(...)` (`grep -n 'takeOnce' src/routes/voice.js`) · TTL: `grep -n 'ELEVENLABS_TTS_TOKEN_TTL_MS' src/config.js` |
| 2 | `POST /v1/chat/completions` | Beide Sicherungen stehen noch: das Flag-Gate (404 bei abgeschaltetem Assistant) **und** der timing-sichere Bearer-Vergleich gegen das Shim-Secret, inklusive Ablehnung eines leeren Secrets (Empty-Secret-Trap). | `grep -n 'telnyxAssistant.enabled' src/telnyx-llm-shim.js` (Flag-Gate) · `grep -n 'safeEqual(bearer' src/telnyx-llm-shim.js` (Bearer; die Bedingung muss ein leeres Secret weiterhin ablehnen) |
| 3 | `/voice/*` (Praefix) | Die Provider-Signaturpruefung (Telnyx Ed25519) haengt weiterhin als Praefix-Middleware VOR allen `/voice`-Handlern und ist fail-closed (ungueltig -> Ablehnung, **nicht** `next()`). | `grep -n 'router.use("/voice"' src/routes/voice.js` · ruft `inboundSignatureVerifier().verifyInboundSignature(...)` |
| 4 | flag-gegatete Routen | Gibt es neue Routen, die nur hinter einem Flag registriert werden? Jede davon ist im Inventar-Test unsichtbar und braucht hier eine Zeile. Heute genau eine: `POST /auth/dev-login` (nur bei `DEV_LOGIN_ENABLED`, fail-closed). | `grep -rn 'devLoginEnabled' src/` |

Zusaetzlich bei jedem Durchgang:

- **Semantische Stufe pruefen.** Der Inventar-Test sieht, DASS eine Auth-Middleware
  da ist — nicht, ob es die richtige ist. Eine Betreiber-Route mit `webAuthMw` statt
  `webAuthMw + adminMw` faellt keinem Mechanismus auf. Die Routen mit
  plattformweiten Zahlen (`/api/billing/*`) und die Geld-Routen (`/api/onboard*`)
  einmal durchsehen.
- **`src/route-policy.js` durchlesen.** Jeder Eintrag in `PUBLIC_ROUTES` nennt eine
  Begruendung. Stimmt sie noch?

## Nach jedem Deploy: die Live-Probe fahren

`test/route-auth-inventory.test.js` prueft den Quellstand. Ob die **laufende Instanz**
tatsaechlich so antwortet, sagt nur `scripts/probe-auth.sh` (PLAN-AUTH-GATE P2):

```
scripts/probe-auth.sh https://app.sundartha.com <commit-sha-aus-/healthz> nach-p7
```

`nach-p7` ist seit AUTH-P7 der Vorgabe-Modus (auch ohne das dritte Argument) und gilt
fuer jeden Deploy ab diesem Commit. `ist-aufnahme` bleibt gueltig, aber nur fuer den
Rollback-Fall: einen Lauf gegen einen Deploy VOR AUTH-P7, wo das Basic-Auth-Gate noch
lebt und die Tabellenspalte `ANTWORTET` noch den Wert `gate` traegt.

Der Commit ist ein Pflichtargument und kommt aus `GET /healthz` der Live-Instanz, nicht
aus `git rev-parse` — Render deployt aus dem Upstream-Remote, der lokale `master` ist
nicht der Live-Stand. Exit 0 = alles wie erwartet · 1 = Abweichung · 2 = Abbruch vor der
Messung (falscher Commit, Rate-Limit, `/healthz` nicht erreichbar).

**Eine rote Zeile wird nicht weggeklickt.** Entweder ist es ein Befund, oder die
Erwartung hat sich mit einer Phase geaendert — dann wird die Tabelle im Skript **im
selben Commit** wie die Phase nachgezogen (H10). Der Lauf hinterlaesst
`auth_failed`-Zeilen im Render-Log; das ist erwartet, kein Vorfall.

## Hinweis fuer Rollbacks (gilt ab PLAN-AUTH-GATE P8)

Sobald P8 gelaufen ist, ist `DASHBOARD_PASSWORD` aus `config.js`, `render.yaml` und
`.env.example` entfernt. **Ein Rollback auf einen Commit vor P7 braucht die Variable
wieder** — sonst findet das alte Basic-Auth-Gate kein Passwort vor. Im Hosting ist
das ein lauter Totalausfall (Boot-Refusal, exit 1), kein stiller offener Zustand;
trotzdem gehoert der Handgriff hierher und nicht in den Kopf des Diensthabenden:

> Vor einem Rollback ueber P8 hinaus: `DASHBOARD_PASSWORD` im Render-Dashboard
> wieder setzen, dann erst den alten Commit deployen.

Bis P8 gelaufen ist, ist dieser Absatz gegenstandslos — die Variable steht dann noch.
