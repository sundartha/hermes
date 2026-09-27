# E8: Angekuendigten Origin festschreiben (Produktions-Footgun)

Vierte Bau-Etappe. Sie macht aus dem angekuendigten Origin eine geprueft KONSISTENTE Angabe statt
einer zufaellig stimmenden: weicht die Token-Audience vom kanonischen `${publicUrl}/mcp` ab,
soll das VOR dem Start auffallen und nicht erst, wenn ein Client abgewiesen wird.

## Woher die Vorgabe stammt (in dieser Reihenfolge lesen)

1. `PLAN-OPENAI.md`, Abschnitt "### Etappe 8" - Umfang und die verbindliche Abnahme.
2. `tasks/openai-fix/S2-mcp-protokoll.md`, Punkt **A9**, und `tasks/openai-fix/S5-authorization-server.md`, Punkt **A3** (Produktions-Footgun) samt den Pre-Mortem-Nachbesserungen beider Specs.
3. `docs/RUNBOOK-LIVE-WERTE.md` - die gemessene Live-Lage, auf der diese Etappe aufsetzt.

## Bereits entschieden und bereits gemessen - nicht neu aufrollen

- **Owner-Entscheidung E-1: der Origin ist `https://app.sundartha.com`** (Tabelle in `PLAN-OPENAI.md`).
- **Gemessen (F-e, bewiesen):** `PUBLIC_URL` traegt diesen Wert live SELBST, er wird NICHT von
  `RENDER_EXTERNAL_URL` geerbt. Es ist also **kein Neutippen** noetig - der Betriebsschritt ist
  ein Soll-Ist-VERGLEICH, keine Aenderung.
- **Gemessen (F-b):** die wirksame Audience ist `https://app.sundartha.com/mcp`, also kanonisch.
  Ob `OAUTH_AUDIENCE` dabei leer ist oder genau diesen Wert traegt, ist von aussen nicht
  unterscheidbar - fuer diese Etappe folgenlos, weil BEIDE Faelle keinen Footgun-Befund ergeben
  duerfen. Genau das ist zu testen.

## Was gebaut wird

- `src/config.js`: ein Eintrag in der Produktions-Footgun-Liste, der bei
  `oauthAudience != ${publicUrl}/mcp` genau EINEN Befund liefert und die Variable `OAUTH_AUDIENCE`
  namentlich nennt.
- Die Fixture in `test/config-prod-footguns.test.js` und ein Fall in
  `test/boot-prod-footguns.test.js`.
- Doku-Nachzug in `.env.example`, `render.yaml` und `PLAN-SECURITY.md`.

## Pflicht: der Vergleich normalisiert BEIDE Seiten

Das ist die Nachbesserung aus dem S5-Pre-Mortem (PM-8) und der wichtigste Punkt dieser Etappe.
`publicUrl` ist im Bestand schraegstrich-normalisiert, `oauthAudience` ist es NICHT. Ein
live gemeinter Wert mit abschliessendem Schraegstrich (`.../mcp/`) darf KEINEN Befund und damit
keinen Boot-Abbruch ergeben - ein fehlschlagender Footgun bedeutet `exit(1)`: kein `app.listen`,
also auch **keine eingehende Telefonie**. Die Abnahme verlangt ausdruecklich: bei leerem UND bei
kanonischem Wert kein Befund, bei einem gemeinten `.../mcp/` kein Befund, bei echter Divergenz
genau ein Befund, der die Variable nennt.

## Was NICHT in diese Etappe gehoert

- **Die drei WorkOS-Dashboard-Einstellungen (S5 B1-B3) sind Owner-Handgriffe, kein Code.** Nicht
  bauen, nicht automatisieren, nicht per API setzen. Im Report als Owner-Aufgabe auflisten.
- **Der Env-Wert im Render-Dashboard ist ein Owner-Handgriff.** Laut Messung stimmt er bereits;
  es bleibt beim Vergleich. Kein Setzen, kein Deploy, kein Neustart.
- **Die Deploy-Haelfte der Abnahme ist hier nicht erfuellbar** und darf nicht vorgetaeuscht
  werden: "nach dem Deploy liefert `GET /.well-known/oauth-protected-resource` denselben Origin"
  und "ein echter Werkzeugaufruf des verbundenen Connectors antwortet wie vorher" sind
  Owner-Schritte NACH einem Deploy. Trage sie im Report als offene Nachweise ein, statt einen
  Test zu schreiben, der sie zu belegen behauptet.

## Harte Grenzen

- Kein Scope-Zuwachs: keine Aenderung an der Auth-Logik, an der Origin-Wache aus E5, an den
  Gates, an der Telefonie. Diese Etappe fuegt eine PRUEFUNG hinzu, sie aendert kein Verhalten im
  Normalfall.
- Keine neue Env-Variable. Kein Default, der den Footgun stillschweigend ueberspringt - eine
  Pruefung mit Ausschalter waere hier sinnlos, weil sie nur beim Start und nur in Produktion
  greift.
- Der Befundtext nennt die Variable, aber NIE ihren Wert (Konvention im Bestand: Footgun-Meldungen
  nennen Namen, keine Werte - sonst landet Konfiguration im Log).
- Keine absolute Regel aus CLAUDE.md aufweichen.

## Konventionen

ESM, kein Build-Step. Kommentare auf Deutsch ohne Umlaute. Neues Verhalten braucht einen Test -
hier drei Faelle: kein Befund bei leer, kein Befund bei kanonisch (inkl. Schraegstrich-Variante),
genau ein Befund bei Divergenz, plus der Kindprozess-Fall mit Exit 1.
