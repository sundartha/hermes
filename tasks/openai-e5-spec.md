# E5: Origin-Pruefung auf /mcp, mit Notventil

Fuenfte Etappe der OpenAI-Sanierung. Sie schliesst ein MUSS der MCP-Spezifikation (T-06): ein
HTTP-MCP-Server muss den `Origin`-Header pruefen und fremde Herkunft mit 403 abweisen. Ohne das
kann eine beliebige Webseite im Browser des Nutzers Requests an `/mcp` schicken (DNS-Rebinding).

## Woher die Vorgabe stammt (in dieser Reihenfolge lesen)

1. `tasks/openai-fix/S2-mcp-protokoll.md` - das vollstaendige Spec. Fuer DIESE Etappe gelten die
   Punkte **A1 bis A8**. Der Betriebsschritt **A9 gehoert NICHT hierher** (das ist Etappe 8).
2. Im selben Spec BEIDE Pre-Mortem-Abschnitte ("## Pre-Mortem" und "## Pre-Mortem - zweiter,
   unabhaengiger Durchgang"). Ihre Nachbesserungen 13-20 sind Teil dieser Vorgabe, nicht
   Anregung. Insbesondere die Zeilenkorrektur `CONFIG_NAMESPACES.safety` = `src/config.js:2252`
   (beide frueheren Angaben waren falsch - selbst nachpruefen).
3. `PLAN-OPENAI.md`, Abschnitt "### Etappe 5" - dort steht die verbindliche Abnahme, Punkt fuer
   Punkt. Sie ist lang und praezise; jeder Punkt ist zu erfuellen.

## Bereits entschieden - nicht neu aufrollen

**Owner-Entscheidung E-4 (Tabelle in `PLAN-OPENAI.md`): die Wache bekommt ein Notventil.**
Bauform: `MCP_ORIGIN_ENFORCE` als `enforce !== false` - ohne Eintrag ist die Pruefung SCHARF, man
muss aktiv `false` setzen, um sie zu loesen. Praezedenz im Repo: `csrfEnforce`
(`src/config.js:1937-1943`) existiert ausdruecklich als Rueckfall gegen genau diesen
Aussperr-Fall. Das ist KEINE abgeschaltete Sicherung im Sinne von CLAUDE.md, sondern ein
Notventil mit scharfem Default - so und nicht anders bauen.

**Owner-Entscheidung E-1: der Origin ist `https://app.sundartha.com`.** Die Allowlist folgt dem
gesetzten `PUBLIC_URL`, wird also nicht hart verdrahtet.

## Pflicht-Auflage aus dem Pre-Mortem

Die Verifikationstabelle MUSS die Betriebsfolge ausdruecklich benennen: die Wache antwortet 403
VOR `mcpAuth`, ein Origin-sendender Client sieht dann nie den `WWW-Authenticate`-Header
(`src/auth.js:66-73`), der der einzige Zeiger auf den Authorization Server ist - eine
Neu-Autorisierung vom Client aus ist damit unmoeglich. Genau deshalb existiert das Notventil.
Die Zeile "fremder Origin ohne Token -> 403" allein genuegt NICHT.

## Bekanntes Deploy-Risiko, das im Report zu benennen ist

Die Abnahme enthaelt einen Boot-Assert, der `OAUTH_AUDIENCE` gegen `${PUBLIC_URL}/mcp` prueft.
Die LIVE-Werte beider Variablen sind derzeit UNKNOWN (Feststellungsaufgaben F-b und F-e, noch
offen). Baue den Assert wie spezifiziert, aber:
- beide Seiten des Vergleichs normalisieren (fuehrender/abschliessender Schraegstrich), damit ein
  live gemeintes `.../mcp/` NICHT zu einem Boot-Abbruch fuehrt - das ist Nachbesserung aus dem
  S5-Pre-Mortem (PM-8) und gilt hier genauso;
- im Report ausdruecklich festhalten, dass vor einem Deploy die Live-Werte gelesen werden muessen,
  weil ein fehlschlagender Assert `exit(1)` bedeutet: kein `app.listen`, also auch keine
  eingehende Telefonie.

## Harte Grenzen

- Kein Scope-Zuwachs: A9 (das Festschreiben von `PUBLIC_URL`) gehoert NICHT hierher, ebenso keine
  Aenderung an der Auth-Logik selbst, an den Gates, am Store, an der Telefonie.
- Keine absolute Regel aus CLAUDE.md aufweichen. Die Wache ist eine ZUSAETZLICHE Sicherung; sie
  darf keine bestehende ersetzen oder abschwaechen. Verhalten OHNE `Origin`-Header bleibt
  byte-identisch zu vorher - Server-zu-Server-Aufrufe senden keinen Origin.
- Die Allowlist bleibt eine Allowlist: kein Praefix-Match, kein Fuzzy, kein Wildcard, und im
  Zweifel abweisen. Eine Allowlist, die bei unbekannter Eingabe durchlaesst, ist fail-open.
- Der abgewiesene Origin wird NIE roh geloggt - nur der Host, wie in der Abnahme gefordert.
- Neue Env-Variable heisst: Eintrag in `src/config.js`, in `.env.example`, Pruefung von
  `render.yaml`, UND eine Zeile in `test/helpers.js` `BASE_ENV` - fehlt die letzte, leckt die
  echte `.env` in die Spawn-Tests.

## Konventionen

ESM, kein Build-Step. Kommentare auf Deutsch ohne Umlaute. Neues Verhalten braucht einen Test;
hier ist es eine eigene Testdatei, die jede Zeile der Abnahme abdeckt - auch die
Negativ-Faelle (`Origin: null`, abweichender Port, Gross-/Kleinschreibung, `OPTIONS`).
