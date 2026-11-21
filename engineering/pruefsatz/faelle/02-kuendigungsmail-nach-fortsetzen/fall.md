# 02 Kündigungsmail nach Fortsetzen
Fehler: Die Kündigungsbestätigung geht auch dann raus, wenn der Kunde die Kündigung vor dem Versand schon zurückgenommen hat (cancelAtPeriodEnd === false wird nicht mehr geprüft).
Herkunft: PR #2235 (Paket F007), Commit 21535c0, Issue #2197 (aus Phase F-2197 abgeleitet).
Fand ihn damals: unbekannt (der KI-Prüfer meldete am PR nur eine SOLLTE-Lücke zu Audit/Log je Sweep).
Erwartet rot: test/312k-p5-cancellation-mail.test.js.
