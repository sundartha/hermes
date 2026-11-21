# 01 zweite Kündigung
Fehler: Kündigen/Fortsetzen schickt Stripe bei jedem Richtungswechsel denselben Idempotenz-Schlüssel und läuft ohne Sperre je Tenant; ein zweites Kündigen nach dem Fortsetzen wird von Stripe als Wiederholung der ersten Anfrage beantwortet und wirkt nicht.
Herkunft: PR #2278 (Paket F008), Commit 972bd86, Issue #2234 (Nummer aus Phase F-2234 abgeleitet).
Fand ihn damals: unbekannt (Fund im Issue #2234); die Auftrags-Skript-Prüfung beanstandete nur den Lint am neuen Test.
Erwartet rot: test/312k-p3-self-service-cancel.test.js (Fall (j) des Issues: Kündigen → Fortsetzen → Kündigen).
