# Hermes

Autonomer Telefon-KI-Agent: Telnyx Voice, Claude (Haiku) als Gespraechs-Gehirn, MCP-Server.
Node.js (ESM), Express, kein Build-Step, kein TypeScript.
Multi-Tenant, JSON- oder Postgres-Store, OAuth/OIDC-Auth.
Nimmt echte Anrufe an und loest echte Anrufe/SMS aus (Kosten!), speichert Gespraechs-Transkripte.

Hermes ist ein persoenlicher KI-Telefonassistent, der Inbound-Anrufe entgegennimmt (Nachrichten,
Termine) und Outbound-Anrufe im Auftrag des Besitzers fuehrt (z.B. Friseurtermin vereinbaren).
Steuerbar ueber ein Web-Dashboard und als MCP-Connector direkt aus Claude.
**Vision: ein Produkt, das diesen Assistenten Millionen Menschen zugaenglich machen soll.**
Der Dienst laeuft oeffentlich erreichbar (Render) und telefoniert mit echten Menschen.
Deshalb gilt erst recht bei Millionen-Skala: Sicherheits- und Kosten-Gates haben Prioritaet vor Features.
Naming: **Hermes** = Produkt/Agent (so nennt sich der
Assistent), **Sundartha** = Firma dahinter (`sundartha.com`).
Repo-Verzeichnis, Render-Service, Brand-URL und einige Env-/Pfadnamen tragen aber noch
`vodafone-agent`; der Infra-/URL-Cutover (Track B) steht separat aus und ist nicht Teil normaler Tasks.

## Absolute Regeln

Alles, was Calls, SMS, Auth oder Budget-Gates beruehrt, gilt automatisch als nicht-trivial.
1. **SAFETY-GATES**: die per-Tenant-Verifikation als Outbound-Permit (Abo+KYC) und der globale
   Kill-Switch `OUTBOUND_FROZEN`, Denylist/Land-Gate/Stundenlimit, **die
   pro-Tenant-Kostendecke**, Max-Gespraechsdauer und die Provider-Signaturpruefung (Telnyx
   Ed25519, fail-closed) duerfen NIEMALS entfernt, aufgeweicht oder per Default umgangen werden.
   Neue Endpunkte, die Calls/SMS ausloesen koennen, brauchen dieselben Gates.
   (`ALLOWED_NUMBERS` ist seit dem outbound-p3-Cutover wirkungslos — der
   Key wird nicht mehr gelesen, s. `.env.example` und `src/config.js`.
   Die statische Allowlist ist NICHT das Gate, das hier geschuetzt wird.)
   `SKIP_TWILIO_SIGNATURE_CHECK` bleibt trotz des Namens: der Schalter ist der **globale**
   `/voice`-Bypass (`routes/voice.js`), kein Twilio-Schalter, und `boot-guard.js` haengt daran.
   Ein Rename ist eine eigene Entscheidung.
   **Owner-Entscheidung 2026-07-30 (E10): `MAX_BUDGET_EUR` ist KEIN geschuetztes Gate mehr.**
   Die pro-Tenant-Kostendecke sperrt weiterhin BEIDE Richtungen, Inbound eingeschlossen.
   Ohne dieses Gate kann eingehender Verkehr die Tenant-Decke unbegrenzt ueberziehen.
   Nicht ohne ausdrueckliche Owner-Entscheidung anfassen.
2. **OFFENLEGUNG**: Der Offenlegungssatz bei Outbound-Calls (`disclosureSentence`) bleibt
   fest verdrahtet als allererster Satz — kein KI-Ermessen, kein Setting, das ihn abschaltet.
   **Owner-Entscheidung 2026-08-20 (OC): der Offenlegungssatz entfaellt bei einem Anruf an die eigene
   hinterlegte Nummer des anrufenden Tenants — und NUR dort; die KI-Kennzeichnung entfaellt dabei NICHT.**
   Die Ausnahme ist ENG und fail-closed.
   Nimmt dort jemand anderes ab, muss der erste Satz trotzdem sagen, dass eine KI spricht.
   **Pflicht-Rueckfall im Anrufmoment:** stellt sich im Gespraech heraus, dass am Apparat
   nicht der Auftraggeber ist, spricht der Agent SOFORT den vollstaendigen Offenlegungssatz
   (Wortlaut aus `LOCALES.<lang>.disclosure`) und fuehrt das Gespraech im Dritt-Modus weiter.
   **Was NICHT erlaubt ist und nie erlaubt wird:** kein Client-Flag und kein MCP-Parameter entscheidet
   darueber (der Aufrufer nennt nur `to`, den Rest entscheidet der Server); kein KI-Ermessen ueber das
   Praedikat (das Praedikat ist rein, das Modell sieht nur das Ergebnis); kein Setting, das die
   Offenlegung fuer Dritte abschaltet; keine zweite Stelle, die dieselbe Frage noch einmal beantwortet.
   **Preis, bewusst akzeptiert:** die hinterlegte eigene Nummer ist heute Format- und
   land-validiert, aber NICHT eigentums-verifiziert (`normalizePrivateNumber`,
   `src/store/state-ops.js:2127-2136`), und sie ist ueber `POST /api/self-service/private-number`
   von JEDEM eingeloggten Tenant setzbar (`src/self-service-routes.js:401`, nur `webAuthMw`).
   Wer eine fremde Nummer hinterlegt, erreichte damit einen
   KI-Anruf ohne den vollen Offenlegungssatz an einen Dritten.
   Deshalb ist die Ausnahme zusaetzlich an eine ausdrueckliche Tenant-Allowlist gebunden:
   ein nicht gepinnter Account kann sie nicht ausloesen, egal was er eintraegt.
   Die Besitz-Verifikation ist als Launch-Blocker in Issue #605 eingetragen.
   Wird der Eintrag dort geschlossen, ohne dass die Verifikation
   gebaut ist, ist DIESE Ausnahme zurueckzunehmen — nicht der Eintrag.
3. **AUTH FAIL-CLOSED**: Neue Endpunkte sind **standardmaessig** hinter einer authentifizierten
   Identitaet — Browser-Session (`webAuthMw`, fuer Betreiber-Routen zusaetzlich `adminMw`)
   oder, fuer den In-Process-MCP-Pfad, `internalOnly` (`isTrustedLocalCaller`).
   Jede Ausnahme (wie `/voice`, `/mcp`, `/healthz`, `/api/plans`) braucht eine eigene
   Absicherung, eine Begruendung im Feld `reason` **und** einen Eintrag in der Oeffentlich-Liste
   (`src/route-policy.js`); ohne beides schlaegt `test/route-auth-inventory.test.js` fehl.
   Credential-Vergleiche timing-sicher (`safeEqual`).
4. **SECRETS**: Nur ueber `.env` (lokal) bzw. Render-Dashboard.
   Niemals committen, niemals loggen, niemals in API-Responses oder MCP-Tool-Ausgaben leaken.
5. **AUDIO**: Audio laeuft NIEMALS durch MCP — nur Transkripte/Status.

## Befehle

```
Start:        npm start              (Gateway + Dashboard + MCP-HTTP)
MCP (stdio):  npm run mcp
Setup-Check:  npm run check
Tests:        npm test               (Regressionsschutz, MUSS gruen sein - rot heisst: etwas ist kaputt)
Launch-Gates: npm run test:gates     (i18n-Launch-Testkatalog, DARF rot sein - rot heisst: offener Produktbefund vor dem Start)
Syntax:       node --check src/server.js
Lokal testen: PORT=3999 SKIP_TWILIO_SIGNATURE_CHECK=true npm start  + curl
```

Test-Suite: `node:test` ohne zusaetzliche Dependencies, Tests in `test/*.test.js`.

Ein Test muss rot werden, wenn sich für einen Kunden oder Angerufenen etwas falsch verhält,
und er darf nicht rot werden, wenn nur Code umgebaut, umbenannt oder Text umformuliert wird.
Erlaubt sind Verhaltenstests über den echten Eingang (MCP-Werkzeug, HTTP-Route, Anbieter-Webhook),
reine Fachlogik als Tabelle von Eingabe und erwartetem Ergebnis, ein Vertragstest für die
Werkzeugliste und je Fehlerbehebung ein Test, der den Fehler vorher reproduziert.

## Referenzen

- `README.md` — Setup, Engines, bewusste Vereinfachungen/Abweichungen
- `.env.example` — alle Env-Variablen mit Erklaerung
- Env-Variablen immer in `src/config.js` zentralisieren UND in `.env.example`
  dokumentieren; fuer Render zusaetzlich `render.yaml` pruefen
- `render.yaml` — Render-Deployment (Blueprint)

Vor Website-Arbeit `docs/RUNBOOK-LAB-LIVE.md` lesen.
