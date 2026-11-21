# 03 Kündigungsstand, gleiche Sekunde
Fehler: Der Stripe-Abgleich des Kündigungsstands prüft nach dem await (Stripe-Abfrage) nicht mehr, ob der Tenant das Abo noch hält, und schreibt dann den Stand einer fremden/alten Subscription (Wettlauf bei Ereignissen derselben Sekunde).
Herkunft: PR #2252 (Paket F009), Commit 99ca526, Issue #2246 (aus Phase abgeleitet).
Fand ihn damals: KI-Prüfer, BLOCKER P16 (webhook.js:406, Schreiben nach await ohne erneute Halter-Prüfung), im Review an Kopf 32e2654.
Erwartet rot: test/abrechnung/stripe-webhook.test.js (nur, wenn der Test den Wettlauf nachstellt – sonst unbekannt).
