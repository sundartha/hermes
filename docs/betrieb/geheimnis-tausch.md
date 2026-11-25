# Geheimnis-Tausch

Prüfliste: Kennung G1 in `docs/betrieb/launch-pruefliste.md`. Ein Wert steht nur in `.env` (lokal), im Render-Dashboard, in den GitHub-Secrets oder bei dem Dienst, der ihn ausstellt oder braucht, nie im Repo, in Logs, Tickets oder Chats.

Wo die Namen stehen:

- Workflows und Skripte: `tools/geheimnisse.json`, Schlüssel `secrets`.
- Server: die als Geheimnis gekennzeichneten Schlüssel in `.env.example` und die von Hand gepflegten Einträge (`sync: false`) in `render.yaml`.

## Symptom

Ein Wert ist an einer fremden Stelle aufgetaucht (auch ein gitleaks-Fund), eine Person mit Zugriff scheidet aus, ein Wert läuft ab, oder ein Anbieter weist ihn ab.

## Prüfen

1. Alle Stellen sammeln, die den Wert brauchen: `git grep` nach dem Namen in `.github/workflows`, `src`, `render.yaml` und `.env.example`, dazu externe Dienste, denen der Wert hinterlegt wurde.
2. Den Kommentar zum Schlüssel in `.env.example` lesen: Mindestlänge, Gleichheit oder Verschiedenheit zu anderen Werten und Folgen eines Wechsels stehen dort.
3. Klären, ob der Anbieter alten und neuen Wert gleichzeitig gelten lässt.

## Beheben

1. Geplanter Tausch: neuen Wert beim Anbieter erzeugen (eigene Tokens selbst erzeugen), den alten noch gültig lassen.
2. Offengelegter Wert: sofort beim Anbieter sperren, auch wenn dadurch Funktionen ausfallen. Bei Gefahr für Kosten oder echte Anrufe zuerst `docs/betrieb/notruf-n1.md`.
3. Den neuen Wert an allen gesammelten Stellen eintragen. Render übernimmt ihn erst mit einem Deploy.
4. Für `HERMES_DEPLOY_TOKEN` gilt `docs/RUNBOOK-LAB-LIVE.md`, Schritt „Token wechseln“. Solange die beiden Stellen nicht übereinstimmen, wirken auch die Anrufpause-Aktionen in `.github/workflows/notfall.yml` nicht; der Kill-Switch `OUTBOUND_FROZEN` bleibt der Weg.
5. Prüfen: `/healthz` antwortet, und die Funktion, die den Wert nutzt, gelingt einmal nachweislich.
6. Den alten Wert beim Anbieter löschen und prüfen, dass er abgewiesen wird.

Schlägt eine Signatur- oder Anmeldeprüfung nach dem Tausch fehl, ist der eingetragene Wert zu korrigieren. Die Prüfung wird nie abgeschaltet oder umgangen.

## Probe

Antonio tauscht einmal ein Geheimnis auf der echten Umgebung nach dieser Seite und trägt Datum und Beleg (Lauf, Protokoll ohne Wert) selbst in die Prüfliste ein.

## Eskalieren

Besteht der Verdacht auf Missbrauch oder schlägt der Tausch fehl, die Bereitschaft über den Kontaktpunkt `bereitschaft` ansprechen (`docs/betrieb/bereitschaft.md`).
