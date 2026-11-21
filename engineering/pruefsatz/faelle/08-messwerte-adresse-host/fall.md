# 08 Messwerte-Adresse nach Host
Fehler: Die OTLP-Zieladresse wird per Regex statt per URL-Zerlegung beurteilt; "http://127.0.0.1@evil.example" oder "https://user:pw@…" gelten dann als sicher (Zugangsdaten/Host-Täuschung).
Herkunft: PR #2562 (Paket B3b), Commit a51d5fc, Issue #2535.
Fand ihn damals: unbekannt (KI-Prüfer/Review; beim Fix blieben zwei äquivalente Mutanten übrig, von Antonio am 03.11. akzeptiert).
Erwartet rot: test/gemeinsam/messwerte-gehen-an-otlp.test.js.
