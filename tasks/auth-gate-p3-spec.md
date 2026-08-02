# Spec AUTH-P3 — Bootstrap-Fallback fail-closed

Autoritative Definition der Phase. Vorrang vor dem Umbrella-Dokument
`PLAN-AUTH-GATE.md` (dort Abschnitt 7, `### P3`). Was hier nicht steht, ist nicht Teil
der Phase.

## Warum diese Phase existiert (die Wurzel)

Der Tenant-Resolver bindet eine **fehlende** Identitaet an den Bootstrap-Tenant
(`BOOTSTRAP_TENANT_ID`, `src/store/defaults.js`): `requestTenant` in
`src/routes/_tenant.js` faellt bei fehlender Identitaet auf den Owner-Tenant zurueck,
und bei `MULTI_TENANT=false` tut eine zweite Stelle dasselbe **unkonditional**.

Anonym = Owner. Empirisch reproduziert (PLAN-AUTH-GATE Abschnitt 1): ohne das
Basic-Auth-Gate liefert `POST /api/calls` eine 200 und originiert einen **echten
Anruf**. Solange dieser Boden offen ist, ruht jede Folgephase auf nichts — deshalb
liegt P3 **vor** P5 und zwingend **vor** P7 (Gate-Wegfall).

Das Gate verdeckt den Zustand heute: extern kommt 401 zurueck, bevor der Resolver
ueberhaupt laeuft. Diese Phase aendert deshalb **kein von aussen sichtbares Verhalten**
am heutigen Deploy — sie zieht den Boden ein, auf dem P7 stehen wird.

## Ziel

Der Bootstrap-Fallback gilt nur noch fuer den **genuin lokalen In-Process-Aufrufer**.

An **beiden** Stellen in `src/routes/_tenant.js` (der `MULTI_TENANT=false`-Zweig und der
Fallback in `requestTenant`) gilt sinngemaess:

```
isTrustedLocalCaller(req) ? <bisheriger Bootstrap> : TENANT_REJECT
```

`isTrustedLocalCaller` (dieselbe Datei) ist die **bereits vorhandene und
security-reviewte** Vertrauensgrenze: echtes Loopback **UND** kein `X-Forwarded-For`.
Es kommt **keine neue Trust-Idee** hinzu — die vorhandene wird an der letzten Stelle
angewandt, an der sie fehlt. Wer hier eine zweite Vertrauensquelle einfuehrt (Header,
Env-Flag, IP-Liste), hat die Phase verfehlt.

## Pflichtschritt VOR der Umsetzung: Konsumenten-Enumeration

Der Plan sagt ausdruecklich: der MCP-Pfad ist belegt, aber es wird **nicht** behauptet,
alle Konsumenten zu kennen. Die Enumeration ist **Teil dieser Phase**, nicht ihre
Voraussetzung.

Zu enumerieren, vollstaendig und mit Fundstelle (Symbol, nicht Zeilennummer):

1. jeder Aufrufer von `requestTenant` und `requireTenant` (je Route),
2. alles unter `scripts/`, das die eigene REST-API ruft,
3. `src/mcp-tools.js` (ruft die eigene API in-process ueber localhost),
4. Tests, die ohne Identitaet gegen tenant-gebundene Routen fahren.

Ergebnis der Enumeration gehoert in den Bericht. Ein Konsument, der still stirbt, ist
ein Blocker.

## Legitime Aufrufer, die NICHT mitsterben duerfen

- **MCP-Tools** (`src/mcp-tools.js`) rufen die eigene REST-API in-process ueber
  localhost — echtes Loopback ohne `X-Forwarded-For`, also weiterhin `true`. Sie reichen
  `X-Internal-Tenant` nur `if (scopedTenant)` mit; der Pfad **ohne** Header
  (stdio/Single-Operator) muss genau ueber `isTrustedLocalCaller` weiterleben.
- Die Spawn-Tests fahren ueber `127.0.0.1` ohne Proxy-Header und bleiben damit
  vertrauenswuerdig. Wenn ein Bestandstest trotzdem kippt, ist das ein **Befund** und
  wird einzeln begruendet — nicht durch Abschwaechen der Assertion erledigt.

## Abnahme (maschinell, alles als Test)

1. Externer Request (gesetzter `X-Forwarded-For`) auf `/api/state` -> **403**, und zwar
   **auch bei entferntem Gate** (im Test also ohne `DASHBOARD_PASSWORD` bzw. an der
   Middleware vorbei — der Test darf sich nicht auf das Gate verlassen, sonst misst er
   die falsche Sicherung).
2. In-Process-Aufruf (Loopback, kein `X-Forwarded-For`) unveraendert **200**.
3. Je ein Test fuer `MULTI_TENANT=false` **und** `MULTI_TENANT=true`.
4. `npm test` gruen.
5. Rot-vor-Fix: die neue Bedingung testweise wieder auf den alten Fallback drehen ->
   genau die neuen Tests werden rot. Mutation zuruecknehmen.

## Nicht-Ziele (bindend)

- **Kein** Entfernen oder Anfassen des Basic-Auth-Gates (`src/wiring/auth-gate.js`) —
  das ist P7.
- **Kein** `internalOnly` (P5), **kein** Loeschen toter Routen (P4), **kein**
  `webAuthMw`/`adminMw` vor Betreiber-Routen (P6).
- **Keine** Aenderung an `src/route-policy.js` und **keine** an der Erwartungstabelle in
  `scripts/probe-auth.sh`: P3 aendert am heutigen Deploy kein von aussen sichtbares
  Verhalten (das Gate antwortet weiterhin zuerst). Wer die Tabelle anfasst, hat entweder
  das Verhalten geaendert (dann ist es ein Befund) oder unnoetig gearbeitet.
- **Keine** neue Env-Variable, **kein** neues Flag, **keine** neue Dependency.
- **Keine** Aenderung an `src/store/defaults.js` (`BOOTSTRAP_TENANT_ID` bleibt).

## Risiko, das benannt gehoert (Pre-Mortem)

Ein Jahr spaeter, die Entscheidung war falsch: die MCP-Tools sind still gestorben, weil
`isTrustedLocalCaller` in Produktion **nicht** greift (Render terminiert TLS und leitet
weiter — auch interner Verkehr traegt dort `X-Forwarded-For`). Dann liefert der
Connector Fehler statt Daten, und zwar erst nach dem Deploy.

Gegenmassnahme in dieser Phase: der In-Process-Pfad wird **im Test** nachgewiesen (nicht
nur behauptet), und der Bericht nennt ausdruecklich, unter welcher Annahme der
Loopback-Pfad live vertrauenswuerdig bleibt. Abbruchsignal live: MCP-Tools in claude.ai
liefern Fehler statt Daten.
