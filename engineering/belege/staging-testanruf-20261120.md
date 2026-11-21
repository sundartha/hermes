# Staging-Testanruf A-6ZNH9Y, 20.11.2026 ~10:20

## Ergebnis: Vorprüfung nicht bestanden -> KEIN Anruf gestartet.

Vorprüfung "führt Staging PR 5510 (Merge 19.11. 19:55Z, 3672f610) und 5515 (Merge 19.11. 22:23Z, 20541927) aus?" nicht belegbar:
- Kein Render-Schlüssel / keine Render-Umgebung auf diesem Server (~/.config/hermes fehlt). Kein ElevenLabs-Zugang.
- Staging-Adresse nirgends dokumentiert; geratene Hosts (staging.sundartha.com u.a.) liefern kein /healthz.
- GitHub kennt keine Staging-Deployments; letztes Deployment (Produktion) 75f5998a vom 19.11. 17:54Z, also VOR beiden PRs.
- Hermes-Staging-Werkzeug liefert Agentenstatus/Anrufliste, aber keinen Commit-Stand und nie das Transkript.
- Das Skript/Werkzeug, mit dem am 19.11. 22:37 das Transkript von 20:43 gelesen wurde, ist auf diesem Server nicht auffindbar.
- Anrufziel: Alle 25+ bisherigen Staging-Anrufe gingen an +49 173 7252163 (Antonios Handy); eine andere Gegenstelle ist nicht eingerichtet. Anruf dorthin ausdrücklich verboten.

## Prüfungen
1 Verpasster Anruf / Widget lädt nicht endlos: nicht prüfbar (kein Staging-Stand belegt, keine Test-Gegenstelle).
2 "Nächste Schritte" nach Anruf: nicht prüfbar (gleicher Grund).
3 Begrüßung/Gespräch gleich, kein sofortiges "ich kann dich nicht hören": nicht prüfbar (gleicher Grund; letzter bekannter Befund Antonio 19.11. 18:55: Problem besteht).

## Nötig zum Weiterkommen
(a) Staging-URL + /healthz-Zugriff oder Render-Lesezugang (Commit des laufenden Deploys), (b) eine Test-Gegenstelle/Prüfnummer, die nicht Antonios Handy ist, (c) Lesewerkzeug für Transkripte.
