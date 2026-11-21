# 09 Testumbau-Messmenge
Fehler (Werkzeug, nicht Produkt): messmenge() bildet nicht mehr die Vereinigung aus alten und neuen Tests; Dateien, die nur im alten Stand gemessen wurden, zählen als entfernt.
Herkunft: PR #3005 (Paket TFM), Commit 92fef45, Issue #3004.
Fand ihn damals: eine Messung (USN t2) zeigte falsche Entfernt-Zahlen; Mutationsprüfung ist hier nicht belegt.
Erwartet rot: test/werkzeuge/auftrag-testumbau-messmenge.test.js (liegt in test/werkzeuge/).
