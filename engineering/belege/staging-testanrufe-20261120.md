# Staging-Testanrufe A-89RZC7, 20.11.2026

## Ergebnis: KEIN Anruf gestartet — zwei Blocker, beide nur auf dem Mac lösbar

### Blocker 1: Diese Sitzung läuft nicht auf dem Mac
Diese Arbeitssitzung läuft auf dem Linux-Server (ip-172-31-42-110), nicht auf dem Mac. Mir steht hier
kein Werkzeug zur Verfügung, das Befehle auf dem Mac ausführt (kein „exec host=node“ o.ä.). Das
Skript `scripts/anruf-probe/anrufer.mjs` liegt zwar im Repo (`Mein Unternehmen/MCP/wt-steuerung/`),
aber von hier aus auf dem Mac auszuführen ist technisch nicht möglich.

### Blocker 2: Kein legitimer Weg an das Token/den MCP-Zugang — selbst vom Mac aus
Auch wenn ich auf dem Mac liefe, gäbe es aktuell zwei unabhängige Wege, und beide brauchen einen
einmaligen Handgriff von Antonio:

1. **Hermes-Staging-MCP** (liefert `get_call_status`/`get_call_result` mit `diagnostic=true`, also die
   Roh-Transkripte, die für die Prüfpunkte (a)–(e) gebraucht werden): Der MCP-Server lehnt die
   Autorisierung ab ("rejected the Authorization header"). Das ist kein Token, das ich irgendwo
   abrufen kann — es ist eine abgelaufene/falsche MCP-Verbindung, die sich nur in einer interaktiven
   Sitzung reparieren lässt.
2. **HTTP-Weg über `anrufer.mjs`** (Bearer `STAGING_TEST_TOKEN`): Ich habe nachgesehen, wofür dieses
   Token bestimmt ist — laut `docs/RUNBOOK-LAB-LIVE.md` ist es „das des Lastlaufs“, also ein
   GitHub-Actions-Secret aus `.github/workflows/staging.yml`. GitHub-Secrets sind grundsätzlich nur
   schreibbar, nie lesbar — auch Antonio kann den Wert nicht einfach aus GitHub abrufen. Er muss ihn
   also entweder aus einem Passwort-Tresor/einer anderen Ablage holen, in der er ursprünglich gesetzt
   wurde, oder das Secret neu ausstellen (z. B. über den Anbieter des Lastlauf-Zugangs) und den neuen
   Wert selbst in die Mac-Umgebung eintragen. Zudem müsste `anrufer.mjs` für Diagnose-Transkripte
   angepasst werden (`diagnostic: true` an `get_call_status` übergeben) — aktuell holt es nur Status
   und Dauer, keinen Rohtext.

Einen Weg, der ohne einen dieser beiden Handgriffe auskommt, habe ich nicht gefunden. Insbesondere
gibt es keine Möglichkeit, das GitHub-Secret `STAGING_TEST_TOKEN` regulär auszulesen (das wäre ein
Sicherheitsumgehen, das ausdrücklich nicht verlangt war und das ich nicht versucht habe).

### Was Antonio einmalig tun muss (einer der beiden Wege reicht)
- **Empfohlen, da einfacher:** Auf dem Mac eine interaktive Claude-Sitzung öffnen, `/mcp` ausführen und
  den Eintrag `hermes-staging` neu verbinden. Danach sind `get_call_status`/`get_call_result` mit
  `diagnostic=true` direkt nutzbar — kein Token nötig.
- **Alternativ:** Den Wert von `STAGING_TEST_TOKEN` (aus der Lastlauf-Ablage oder neu ausgestellt) auf
  dem Mac als Umgebungsvariable setzen, zusätzlich `STAGING_URL`, `STAGING_PROBE_ZIEL` (`+49 173
  7252163`), `STAGING_PROBE_AUFTRAGGEBER`, `STAGING_PROBE_VORNAME`. `anrufer.mjs` müsste zusätzlich so
  erweitert werden, dass `get_call_status` mit `diagnostic=true` aufgerufen wird, sonst fehlt der
  Rohtext für die Prüfpunkte.

Sobald einer der beiden Wege steht, kann die Sitzung auf dem Mac die 5 Anrufe gestaffelt (keine
parallelen, kein Wiederholen bei „not-placed“) ausführen und je Anruf die Punkte (a)–(e) mit
Transkriptauszug belegen.

## Prüfungen (a)–(e): nicht geprüft
Kein Anruf wurde gestartet, also liegt zu keinem der fünf Punkte (Begrüßung einmalig; Pause vor
„Kannst du mich hören?“; gleiche Stimme/Betonung; „Nächste Schritte“ vorhanden; Widget lädt bei
Nichtannahme nicht endlos) ein neuer Beleg vor. Letzter bekannter Stand (Antonio, 19.11. 18:55, vor
dem Deploy von PR 5510/5515): Doppel-Begrüßung behoben, aber sofortiges „Ich kann dich nicht hören“
mit abweichender Stimme bestand noch. Ob das nach dem aktuellen Staging-Deploy (Commit 559cf5b459)
behoben ist, ist weiterhin unbelegt.
