# SEC-P5 — Ergaenzung zum Phasenabschnitt in PLAN-SEC-FIX.md

ERGAENZT `PLAN-SEC-FIX.md` -> "SEC-P5 — Web-Haertung". Ersetzt ihn nicht.

## Vom Lead nachgesehen: welche Oberflaeche was braucht

- **Die statische Marketing-Site ist bei `script-src` schon sauber.** `render.yaml:749/750`
  setzt `default-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none';
  base-uri 'self'; object-src 'none'` — kein `'unsafe-inline'`. Dort fehlt nur HSTS.
- **`'unsafe-inline'` sitzt im GATEWAY** (`securityHeaders`, serverseitig). Das ist die
  Stelle, die der Auftrag meint.
- **Die Kopplung ist bestaetigt:** `test/headers.test.js` pinnt heute woertlich
  `assert.match(csp, /script-src 'self' 'unsafe-inline'/)`. Ohne Umschreiben im SELBEN Commit
  ist die Regressionsbank rot.
- **`style-src` ist NICHT im Auftrag.** Dort steht `'unsafe-inline'` ebenfalls, bleibt aber —
  der Abschnitt nennt ausdruecklich nur `script-src`. Kein Mitnehmen "bei der Gelegenheit".

## Diese Kette deployt NICHT — was die Abnahme dadurch heisst

Die Ausgangsmessung wurde von aussen an den DEPLOYTEN Oberflaechen gemacht. Nach dieser Phase
ist der Code richtig, die Live-Header sind es erst nach einem Deploy. Die Abnahme ist deshalb
**lokal** zu fahren (Server starten, Header an den betroffenen Routen lesen) und die
Aussenmessung der drei Oberflaechen als Owner-Schritt NACH dem Deploy im Kettenstand zu
vermerken. Nichts wird gepusht, nichts deployt.

Fuer die statische Site gilt zusaetzlich der Lab-Live-Weg aus `CLAUDE.md` — auch dessen
Ausfuehrung ist Owner-Sache, nicht Teil dieser Phase.

## Pre-Mortem (Pflicht nach CLAUDE.md)

1. **Die App-Shell ist weiss.** `'unsafe-inline'` faellt weg, aber der Astro-Build liefert
   Inline-`<script>`-Bloecke — jeder davon wird jetzt vom Browser verworfen. In Tests faellt
   das NICHT auf: ein `fetch` prueft Header, kein Browser fuehrt die Seite aus. **Das ist der
   wahrscheinlichste und teuerste Ausgang dieser Phase.** Der Beweis muss deshalb sein: die
   Seiten werden tatsaechlich geladen und es gibt NULL CSP-Verstoesse. Sind Inline-Skripte
   vorhanden, ist die Antwort Hash oder Nonce — **nicht** der Rueckfall auf `'unsafe-inline'`.
2. **HSTS ist schwer rueckholbar.** `max-age >= 15552000` plus `includeSubDomains` weist
   Browser an, JEDE Subdomain ein halbes Jahr lang nur noch ueber HTTPS anzusprechen — auch
   eine, die es heute nicht kann. Ein Fehler hier laeuft nicht mit dem naechsten Deploy aus,
   sondern erst, wenn der Browser des Nutzers die Angabe vergisst. Vor dem Setzen gehoert
   deshalb benannt, welche Subdomains es gibt und ob alle HTTPS sprechen.
3. **Halbe Cookie-Umbenennung.** `__Host-`-Praefix verlangt `Secure`, `Path=/` und KEIN
   `Domain=`. Wird der Name an einer Stelle geaendert und an einer anderen (Abmeldung,
   Sitzungspruefung, Tests, ein etwaiger zweiter Leser) nicht, ist der Auth-Pfad kaputt statt
   sicherer. Der Plan muss ALLE Leser des heutigen Namens auflisten, bevor er umbenennt.
4. **Lokale Anmeldung ueber die LAN-Adresse ist tot.** `Secure` heisst: der Browser sendet und
   setzt das Cookie nur ueber HTTPS. `http://localhost` lassen Browser durchgehen,
   `http://192.168.x.x` NICHT — genau der Weg, den die Bestandslehre
   `local-loopback-bypasses-auth-gate` fuer den Auth-Rauchtest vorschreibt. Entweder wird das
   als bewusster Preis benannt, oder der Praefix haengt am Protokoll (produktiv IMMER
   `__Host-`). Raten gilt nicht.
5. **Alle Sitzungen enden.** Das ist im Plan als Preis akzeptiert und der Grund, warum die
   Phase spaet steht — hier nur als Erinnerung, dass es beim Deploy jemanden trifft.

## Abnahme (aus dem Abschnitt, lokal gemessen)

1. `strict-transport-security` vorhanden, `max-age >= 15552000`, mit `includeSubDomains`.
2. `script-src` ohne `'unsafe-inline'` UND ohne `'unsafe-eval'`.
3. Set-Cookie-Name beginnt mit `__Host-`, traegt `Secure` und `Path=/`, KEIN `Domain=`.
4. `test/headers.test.js` ist im selben Commit auf den neuen Soll-Zustand umgeschrieben —
   nicht geloescht, nicht aufgeweicht.
5. Aus Pre-Mortem 1: ein Beleg, dass die ausgelieferten Seiten unter der neuen CSP ohne
   Verstoss laufen. Ein Header-Test allein genuegt hier ausdruecklich NICHT.
