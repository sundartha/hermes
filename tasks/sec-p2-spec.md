# SEC-P2 — Ergaenzung zum Phasenabschnitt in PLAN-SEC-FIX.md

ERGAENZT `PLAN-SEC-FIX.md` -> "SEC-P2 — Lieferkette". Ersetzt ihn nicht.

## Vom Lead frisch gemessen (nicht erneut ermitteln, nur pruefen ob es noch stimmt)

```
npm audit --omit=dev                      -> 8 Verwundbarkeiten (5 moderat, 3 hoch)
npm audit --omit=dev --audit-level=high   -> EXIT 1   (Zielzustand: EXIT 0)
nodemailer installiert 7.0.13, Fix = 10.0.1 (breaking, nur ueber --force)
qs / express: Fix OHNE --force verfuegbar
package.json engines: node >=22 <23 ; .nvmrc: 22
nodemailer@10.0.1 engines: node >=20.0.0   -> VERTRAEGLICH, kein Node-Sprung noetig
nodemailer-Aufrufstellen: src/smtp-mail.js, src/mail-boot-probe.js, src/mail/ports.js,
  src/wiring/web-login.js, test/mail-adapter-selection.test.js, test/mail-boot-probe.test.js
```

**`.github/dependabot.yml` ist BEREITS versioniert** (Commit `423a54d`). Der Abschnitt nennt
sie als unversioniert — das ist ueberholt. Hier ist nichts mehr zu tun; die Datei nicht
anfassen, nicht neu committen.

## Pre-Mortem (Pflicht nach CLAUDE.md)

Ein Jahr spaeter, die Anhebung hat Schaden angerichtet. Was ist passiert?

1. **Der Mailpfad ist still verstummt.** nodemailer 10 hat eine Signatur geaendert, der
   Aufruf wirft in einem `catch`, das Mail ohnehin als "best effort" behandelt — Anrufer
   bekommen keine Zusammenfassung mehr, das Double-Opt-in des Newsletters bestaetigt nie.
   Niemand merkt es, weil ein nicht gesendetes Mail keinen Alarm ausloest. **Deshalb genuegt
   "npm test gruen" hier NICHT.** Es braucht den Beleg, dass der Sendepfad noch betreten und
   durchlaufen wird.
2. **`express-rate-limit` wurde mit angehoben und aendert die IP-Achse.** Genau darauf
   arbeiten unser Limiter UND `isTrustedLocalCaller` — das `ip-address`-Advisory sitzt auf
   dieser Achse. Eine geaenderte Vertrauensgrenze ist ein AUTH-Defekt, kein Kosmetikum.
3. **`npm audit fix` hat den halben Baum bewegt.** Ein Lockfile-Diff ueber hunderte Pakete
   ist nicht pruefbar; man tauscht ein bekanntes Risiko gegen ein unbekanntes.
4. **Der Dienst startet nicht mehr.** Auf Render faellt das erst im Deploy auf, und der
   Deploy ist genau das, was diese Kette nicht macht — also muss der Start lokal belegt sein.

## Vorgehen, hart getrennt

**Zwei Commits, nicht einer.**

1. **Commit 1 — nicht-brechend:** `npm audit fix` OHNE `--force`. Danach die Verschiebung im
   Lockfile benennen (welche Pakete, von wo nach wo). Wird dabei `express-rate-limit` oder
   irgendetwas auf der IP-Achse bewegt, gehoeren die Testdateien zu Limiter und
   `isTrustedLocalCaller` ausdruecklich in den gefahrenen Satz (Pre-Mortem 2).
2. **Commit 2 — der nodemailer-Major, allein:** `nodemailer@^10`. Vorher die
   Migrationshinweise des Anbieters lesen und die vier genannten Aufrufstellen dagegen
   pruefen. Was sich an der Aufrufform aendert, wird angepasst; was gleich bleibt, wird
   nicht angefasst.

Verboten: `npm audit fix --force` als Pauschalmassnahme (der nodemailer-Sprung wird gezielt
gemacht, nicht ueber `--force` erraten). Keine NEUE direkte Abhaengigkeit. `apps/web` hat
0 Verwundbarkeiten und ein eigenes Lockfile — nicht anfassen.

## Der Rauchtest, differentiell (die Abnahme sagt "belegt am Log, nicht behauptet")

Die Reihenfolge ist nicht optional, sonst belegt die Messung nichts (Lehre
`bench-must-reproduce-defect`):

1. **ZUERST auf dem unveraenderten Stand messen:** Server lokal starten und den real
   konfigurierten Adapter (`selectMailer`) EINE Zustellung versuchen lassen. Ergebnis
   festhalten — Erfolg ODER Fehlerklasse (welcher Fehler, an welcher Stelle). Ohne echte
   SMTP-Zugangsdaten ist ein Fehler das ERWARTETE Ergebnis; er ist der Messwert, nicht das
   Problem.
2. **Dann nach der Anhebung dieselbe Messung.** Gleiches Ergebnis oder gleiche Fehlerklasse
   = bestanden. Eine ANDERE Fehlerklasse (z.B. `TypeError` statt Verbindungsfehler) ist ein
   Blocker — das ist genau Pre-Mortem 1.
3. **Zusaetzlich Boot-Beleg:** der Server startet mit den neuen Abhaengigkeiten und
   `/healthz` antwortet (Pre-Mortem 4).

Beide Messwerte gehoeren in `smokeNote`, knapp: was gemessen, vorher/nachher.

## Abnahme (aus dem Abschnitt, praezisiert)

- `npm audit --omit=dev --audit-level=high` -> **Exit 0**. Verbleibende MODERATE Befunde sind
  zulaessig; sie werden NICHT ueber weitere brechende Spruenge gejagt, sondern gezaehlt und
  benannt.
- Die betroffenen Testdateien gruen (die volle Suite faehrt der Lead).
- Rauchtest vorher/nachher wie oben.

## Abgrenzung

Keine Aenderung an Anwendungslogik, ausser dort, wo die neue nodemailer-Aufrufform sie
erzwingt. Kein Refactoring "bei der Gelegenheit". Keine Aenderung an Safety-Gates, am
Offenlegungssatz oder an der Signaturpruefung.
