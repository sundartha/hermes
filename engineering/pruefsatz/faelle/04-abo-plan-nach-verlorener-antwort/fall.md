# 04 Abo-Plan nach verlorener Antwort
Fehler: Die direkte Abo-Anlage schickt metadata[plan_slug] nicht mehr an Stripe; geht die Antwort verloren, kann der Webhook den Plan nicht setzen und der Kunde bleibt ohne freigeschalteten Plan.
Herkunft: PR #2894 (Paket F2647), Commit 80462fd, Issue #2647 (abgeleitet).
Fand ihn damals: unbekannt; das Auftrags-Skript meldete beim Fix, ein Schutztest (NIE2) sei wirkungslos.
Erwartet rot: test/abrechnung/abo-plan-nach-verlorener-antwort.test.js.
