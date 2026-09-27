# T2-07 — Transport: Rate-Limit je Mandant statt je IP (T-28)

Branch `phase/openai-t2-07-rate-limit-per-tenant`, Commit `d3237b2`. Basis: master
`e8a0120` (T2-01..T2-06, T2-23 bereits gemergt). Umfang: **nur T-28**.

## 1. Was NICHT erfuellt ist

- **Zwei Review-Befunde stehen weiterhin offen**, obwohl der Commit-Titel
  "Restrisiko dokumentiert + Drossel-Pruefung entdoppelt" nahelegt, beide seien erledigt:
  1. **PLAN-SECURITY.md widerspricht dem eigenen Code (Befund safety/wichtig).** Der
     Kopf-Absatz (Zeile 5813f.) sagt weiterhin woertlich: "JEDER Ablehnungszweig ruft NACH
     dem unveraenderten Audit-Log den injizierten Zaehler." Tatsaechlich laeuft es seit der
     Nachbesserung umgekehrt (`src/auth.js:mitAblehnungsDrossel`, `src/middleware.js:
     pruefeAblehnungsDrossel`): erst der Zaehler, `auditFn` nur im ERLAUBTEN Zweig. Der
     korrekte Ablauf steht zwar weiter unten im Nachbesserungs-Absatz (Zeile ~5901), der
     Kopf wurde aber nicht nachgezogen — der Bericht (und ein Betreiber, der sich bei einer
     Incident-Analyse darauf verlaesst) faende dort weiterhin die falsche Aussage zuerst.
     Ich habe das gegen den Code geprueft (siehe Abschnitt 4) und bestaetige den
     Review-Befund als weiterhin zutreffend.
  2. **Token-/Legacy-Modus: Brute-Force-Bremse fuer `/mcp` weg, nirgends dokumentiert
     (Befund safety/wichtig).** Vor dieser Phase blockte der globale IP-Limiter jeden
     `POST /mcp` inkl. Token-Ratewersuche bei 120/min. Jetzt gilt fuer den statischen
     Token-/Legacy-Modus "erst pruefen, dann zaehlen" — ein falsches Bearer-Token zaehlt
     zwar weiter je IP, aber die Pruefung selbst (String-Vergleich) laeuft ungebremst vor
     dem Zaehlen; die einzige Bremse ist danach der Server-Durchsatz, nicht mehr 120/min.
     `grep -n "Brute-Force" PLAN-SECURITY.md` traf in diesem Diff **0** Zeilen — der
     Restrisiko-Abschnitt der Phase (siehe unten, "Bewusst getragene Restrisiken") erwaehnt
     dieses konkrete Risiko nicht, obwohl der Commit-Titel es als dokumentiert ausgibt. In
     Produktion entschaerft (dort laeuft OAuth, nicht Token-Modus), aber als Lueckenbeleg
     fuer Self-Hosting/Staging/Rueckfall nicht im Dokument.
- **Kein eigener Draht-Test fuer `insufficient_scope` UND Herkunftswache-Ablehnung
  KOMBINIERT** — beide Faelle sind je fuer sich einzeln bewiesen (MRL-m bzw. MRL-l), eine
  Kombination beider ist nicht Teil des Plans und fehlt entsprechend auch hier; nicht als
  Luecke zu werten, nur als Abgrenzung.
- T-27 (Hop-Fristen, Stundenlimit-Sperre) ist bewusst NICHT Teil dieser Phase (nur T-28
  gepinnt) — korrekt so dokumentiert, kein Bau-Defekt.

## 2. Was erfuellt ist, ID fuer ID

**T-28 — Rate-Limit auf `POST /mcp` je Mandant statt je IP.**

| Teilanforderung (Plan-Abnahme T2-07) | Beleg |
|---|---|
| Mandant A 3x 200, 4. 429 mit `Retry-After`, Mandant B von derselben IP 200 | `test/mcp-rate-limit.test.js:89` (MRL-a), gruen |
| 3 ungueltig signierte Tokens 401, 4. 429; gueltiges Token derselben IP danach 200 (erst pruefen, dann zaehlen) | MRL-b (`test/mcp-rate-limit.test.js:115`), gruen |
| 4 abgelaufene, gueltig signierte Tokens verschiedener sub, gleiche IP -> je 401, kein 429 | MRL-c (`:143`), gruen |
| dieselbe sub 4x abgelaufen -> 3x 401, 4. 429 | MRL-d (`:162`), gruen |
| eine Nicht-`/mcp`-Route bleibt je IP gedrosselt | MRL-h (`:269`), gruen |
| Token-Modus zaehlt je IP | MRL-i (`:298`), gruen |
| Kein Code liest `openai/subject` | `grep -rn "openai/subject" src/` traf 0 Treffer im Diff; Begruendung als Kommentar in `src/mcp-rate-limit.js:16-20` |
| Zaehler erst NACH dem Pruefergebnis, nur im Ablehnungszweig | `src/auth.js:mitAblehnungsDrossel`/`pruefeAblehnungsDrossel` (`src/middleware.js:369-374`) — ich habe die Aufrufreihenfolge im Diff gelesen: `pruefeAblehnungsDrossel` (Zaehler) laeuft zuerst, `auditFn()` erst danach im erlaubten Zweig |
| `insufficient_scope` (403, gueltige Signatur, zu wenig Scope) zaehlt je sub, nicht je IP | MRL-m (`:409`), gruen — Nachbesserung nach Review, war im urspruenglichen Bau eine Luecke (kein eigener Draht-Beweis), jetzt geschlossen |
| Herkunftswache (`createMcpOriginGuard`) laeuft am Zaehler nicht vorbei | MRL-l (`:374`), gruen — Nachbesserung nach Befund safety/blocker: Wache bekam denselben `ablehnungsDrossel` injiziert (`src/middleware.js:createMcpOriginGuard`, `src/routes/mcp.js:181`) |
| `auth_failed`-Zeilen unter einer Flut auf `FENSTER_LIMIT` begrenzt (keine Log-Flut) | MRL-n (`:434`), gruen — Nachbesserung nach Befund safety/wichtig |
| POST /mcp aus dem globalen IP-Limiter UND den globalen Body-Parsern genommen; Parser laufen jetzt HINTER `mcpAuth`+`mandantDrossel` | `src/app.js:isMcpPost`-Ausnahmen an beiden Middleware-Stellen; MRL-g (`:226`) beweist die Parser-Reihenfolge am Draht |
| Mandant EINMAL aufgeloest (INV-7) | `src/routes/mcp.js:mandantDrossel` ruft `requestTenant(req)` genau einmal, Handler liest `res.locals.scopedTenant` — im Diff geprueft, kein zweiter `requestTenant`-Aufruf im Handler |
| Funktionsname `mcpAuth` bleibt (Routen-Inventar-Test) | `makeMcpAuth(...)` gibt eine Funktion namens `mcpAuth` zurueck (`src/auth.js`); `test/route-auth-inventory.test.js` isoliert gruen mitgelaufen |

Fokus-Testlauf (isoliert, `NODE_ENV=test`, `--test-concurrency=4`, gegen den echten
`/mcp`-HTTP-Pfad, kein `npm test`-Wrapper dazwischen):
`test/mcp-rate-limit.test.js`, `test/auth-mcp-bypass.test.js`,
`test/openai-p6-challenge.test.js`, `test/route-auth-inventory.test.js` ->
**36 Tests, 36 pass, 0 fail, 0 "not ok"** (Log:
`.../scratchpad/logs-t2-07/t2-07-focused.log`, von mir selbst ausgefuehrt, nicht nur aus
den TATSACHEN uebernommen).

Voller Lauf (`npm test -- -- --test-concurrency=4`, von mir selbst separat und
unabhaengig vom Bau-Protokoll gestartet): **6350 Tests, 6349 pass, 1 fail** — deckt sich
mit der im Bau-Protokoll behaupteten Zahl (6349/1). Der eine Fehlschlag ("PAYMENT_ENABLED=
false: Minuten-Gate ist No-Op -> erreicht Originate (500)", Zeile 4155 im Log) liegt im
Zahlungs-/Minuten-Gate, nicht im Rate-Limit- oder Auth-Code dieser Phase — kein Treffer
unter den 14 MRL-Tests oder den drei Auth-/Inventar-Dateien. Log:
`.../scratchpad/logs-t2-07/t2-07-full.log`.

## 3. Beruehrte Pfade — vollstaendig oder nicht

Drei Auth-Modi fuer `/mcp`: **oauth**, **token**, **legacy/off**.

- **oauth**: vollstaendig abgedeckt — Erfolg (Mandant aufgeloest), Erfolg ohne Mandant
  (TENANT_REJECT/Stub-Fassade, zaehlt je sub), jeder Ablehnungsgrund (kein Token, Muell-
  Signatur, `ERR_JWT_EXPIRED`, `insufficient_scope`, JWKS-Fehler ueber den generischen
  Fehlerzweig), Herkunftswache. Alle mit Draht-Test.
- **token**: Erfolg und Ablehnung geprueft (MRL-i), zaehlt je IP wie vorher —
  ABER: die Pruefungsreihenfolge selbst (erst vergleichen, dann zaehlen) ist eine
  Abschwaechung gegenueber vorher (siehe Abschnitt 1, Punkt 2). Getestet ist das
  BEOBACHTBARE Verhalten (429 ab dem Limit), NICHT die Tatsache, dass die Vergleichsrate
  selbst nicht mehr gedeckelt ist — das laesst sich mit einem Fixed-Window-Zaehler-Test
  gar nicht zeigen, es ist eine strukturelle Aussage ueber den Codepfad.
- **legacy/off**: `off` zaehlt nirgends (kein Ablehnungszweig moeglich) — unveraendert.
  `legacy` teilt sich den token-Codepfad und damit dieselbe Abschwaechung.
- **Nicht-`/mcp`-Routen**: unveraendert im globalen IP-Limiter (MRL-h), nicht angefasst.
- **GET/DELETE/OPTIONS auf `/mcp`**: bleiben bewusst im globalen IP-Limiter (Plan-Vorgabe,
  im Code als Kommentar an `isMcpPost` und in PLAN-SECURITY.md festgehalten) — nur `POST
  /mcp` hat die neuen Zaehler.

Damit: der Punkt "Zaehler nach Pruefergebnis" ist auf OAuth vollstaendig sauber, auf
Token/Legacy nur im Sinne von "Ablehnung wird gezaehlt", nicht im Sinne von "die Pruefung
selbst ist weiterhin gedrosselt" — das ist der offene Punkt aus Abschnitt 1.

## 4. Was ein fremder Pruefer nachmessen sollte

- Ist die Behauptung in PLAN-SECURITY.md Zeile ~5813f. ("jeder Ablehnungszweig ruft NACH
  dem Audit-Log den Zaehler") mit dem tatsaechlichen Code in `src/auth.js`
  (`mitAblehnungsDrossel`) und `src/middleware.js` (`pruefeAblehnungsDrossel`)
  vereinbar — und woran siehst du das (Aufrufreihenfolge der beiden Funktionen im
  Code lesen, nicht nur den Text)?
- Ist im Token-/Legacy-Modus die Vergleichsrate (`safeEqual`) fuer `POST /mcp` noch durch
  irgendeinen Zaehler VOR dem Vergleich gedeckelt — und wo im Code steht das (oder eben
  nicht)?
- Zaehlt `ablehnungsDrossel` in `createMcpOriginGuard` wirklich denselben Prozess-Zaehler
  wie in `mcpAuth`, oder sind es zwei Instanzen (`src/app.js`: wird `makeMcpDrosseln`
  genau einmal pro Prozess aufgerufen und dasselbe Objekt an beide Stellen gereicht)?
- Liest irgendein Code-Pfad `_meta["openai/subject"]` oder ein Analogon davon fuer den
  Zaehler-Schluessel — `grep -rn "openai/subject\|_meta\[" src/mcp-rate-limit.js
  src/auth.js src/routes/mcp.js`?
- Laeuft `test/mcp-rate-limit.test.js` isoliert (`node --test --test-concurrency=4
  test/mcp-rate-limit.test.js`) tatsaechlich komplett gruen, insbesondere MRL-l, MRL-m,
  MRL-n (die drei Nachbesserungs-Tests)?
- Ist `RATE_LIMIT_PER_MIN` wirklich die einzige neue/geaenderte Env-Semantik (kein neuer
  Schluessel in `config.js`/`.env.example`/`render.yaml` fuer diese Phase) —
  `git diff master...HEAD -- src/config.js .env.example render.yaml`?

## 5. Owner-Punkte und Restrisiko

Konsolidiert nach der Owner-Regel (nur Deploy/Live-Messung/Render-Dashboard-Werte):
die eigentliche Live-Probe ("laufender Anruf, mehrere Minuten, kein 429 im ChatGPT
Developer Mode bzw. im Render-HTTP-Log auf `POST /mcp`") sowie der optionale Blick auf
`RATE_LIMIT_PER_MIN` im Render-Dashboard und die UNKNOWN-Frage, ob `req.ip` hinter dem
Hosting-Proxy die echte Client-IP ist — keiner davon ist eine Deploy-Vorbedingung, weil
kein gueltiger Aufrufer durch diese Phase strenger gedrosselt wird als vorher.

**Restrisiko in einem Absatz:** Die Kernidee der Phase (Mandant statt IP fuer erfolgreiche
`/mcp`-Aufrufe) ist sauber gebaut und mit 14 Drahttests belegt, inklusive zweier
Nachbesserungen (Herkunftswache-Umgehung, Log-Flut) aus der ersten Review-Runde. Offen
bleiben zwei bereits gemeldete, nicht behobene Punkte: die Dokumentation in
PLAN-SECURITY.md widerspricht an einer Stelle dem eigenen Code (operative Gefahr: ein
Betreiber unterschaetzt bei einer Incident-Analyse den Umfang eines Angriffs, weil er sich
auf eine falsche Audit-Log-Garantie verlaesst), und die Abschwaechung der
Token-/Legacy-Modus-Bremse ist nirgends im Sicherheitsdokument festgehalten (operative
Gefahr nur relevant bei Self-Hosting/Staging/Rueckfall auf Token-Modus, in der aktuellen
Produktion mit OAuth nicht wirksam). Beide sind Dokumentations-/Nachtrags-Luecken, keine
Code-Regressionen — der Code selbst verhaelt sich in allen getesteten Faellen wie
spezifiziert.

## Unabhaengige Verifikation (gewinnt gegen alles oben)

- Urteil des Laufs: PASS (PASS nur bei beiden Reviews PASS, allen IDs ja, keinem isoliert roten Test)
- Gemessener Commit: d3237b2; Tests (volle Suite, pass/fail): 6350/0
- Review-Urteile zuletzt: {"safety":"PASS","cleancode":"PASS"}
- Tabelle ID | erfuellt | Beleg | Luecke:

| ID | erfuellt | Beleg | Luecke |
|---|---|---|---|
| T-28 | ja | src/mcp-rate-limit.js:42-46 zaehlt POST /mcp je verifiziertem Mandanten statt je IP. Eigene Probe am Server (Limit 2): A 200,200,429, auch mit anderem openai/subject und anderer IP 429; B 200; Meta ohne Token 401. MRL-a..n 14/14 gruen | Live-Rest: nicht geprueft, ob req.ip hinter Render die echte Client-IP ist. Der Schluessel ist der Mandant aus dem Token statt openai/subject (per Design staerker). userAgent/userLocation stehen nirgends in src |

- Isoliert rot: []
- Offene Blocker:
  - safety/wichtig PLAN-SECURITY.md:5813: Der neue Sicherheitseintrag widerspricht dem Code an zwei Stellen. Z. 5813 sagt, jeder Ablehnungszweig rufe NACH dem unveraenderten Audit-Log den Zaehler. Z. 5856 nennt 'das bestehende auth_failed-Audit je Ablehnung' als Ersatz fuer eine 429-Logzeile. Seit der Nachbesserung (src/auth.js mitAblehnungsDrossel, src/middleware.js createMcpOriginGuard) laeuft aber zuerst der Zaehler, und auditFn wird nur im erlaubten Zweig aufgerufen. Ab dem Fenster entsteht fuer eine Ablehnung weder eine auth_failed-Zeile noch eine andere Logzeile. Der Nachbesserungs-Absatz weiter unten beschreibt es richtig, der Kopf ist nicht nachgezogen.
  - safety/wichtig src/auth.js:318: Im Token- bzw. Legacy-Modus (statisches MCP_AUTH_TOKEN) gilt jetzt 'erst pruefen, dann zaehlen'. Vorher blockte der globale IP-Limiter VOR der Auth jede Anfrage ueber 120/min, auch eine richtig geratene. Das war die in app.js kommentierte Brute-Force-Bremse. Jetzt geht ein korrektes Token immer durch, ein falsches bekommt ab dem Fenster 429. Der Angreifer liest am Status (429 = falsch, 200/403 = richtig) weiterhin jedes Ergebnis ab. Die Rate der Rateversuche je IP ist damit nur noch durch den Serverdurchsatz begrenzt, und Versuche ueber dem Fenster schreiben keine auth_failed-Zeile mehr. Fuer OAuth ist das richtig (Signaturen sind nicht ratbar, die Plan-Vorgabe gilt). Fuer den statischen Token ist es eine undokumentierte Abschwaechung; der PLAN-SECURITY-Eintrag erwaehnt Brute-Force nicht.
