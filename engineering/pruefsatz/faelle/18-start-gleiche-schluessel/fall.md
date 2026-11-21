# 18 Start bei gleichen Schlüsseln
Fehler: Der Start wird nicht mehr verweigert, wenn HERMES_STATUS_TOKEN und HERMES_DEPLOY_TOKEN gleich sind (fatale Konfig-Befund fehlt).
Herkunft: PR #2856 (Paket F2676), Commit 97e4c53, Issue #2676 (abgeleitet).
Fand ihn damals: unbekannt (Auftrags-Skript; Anforderung kam aus dem Issue).
Erwartet rot: test/gemeinsam/start-verweigert-gleiche-schluessel.test.js.
