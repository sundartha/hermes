# 06 Eingang, Fehlerweg und Synthese
Fehler: synthesizeDirectiveAudio fängt einen Wurf der Sprachsynthese nicht mehr; fällt der Speicher mitten im Anruf aus, bleibt eine unbehandelte Ablehnung zurück und der Anrufer hört Stille.
Herkunft: PR #2440 (Paket INB), Commit c5b84d6.
Fand ihn damals: unbekannt (Fund aus dem Betrieb/Anruftest; im PR prüfte die Betreuung Kopf 2aaea7b ohne BLOCKER).
Erwartet rot: test/anrufe/eingang-fehlerweg-ohne-synthese.test.js (stellt den Fehler über den Eingang her).
