# Sicherheitslücken melden

Bitte melde eine Sicherheitslücke in Hermes nicht als öffentliches Issue, sondern vertraulich über GitHub: [Sicherheitslücke melden](https://github.com/sundartha/hermes/security/advisories/new) (im Repo unter „Security“, dann „Report a vulnerability“). Die Meldung sehen nur du und die Verantwortlichen von Sundartha.

Ergebnisse eines beauftragten Pentests kommen auf demselben Weg herein, je Lücke eine Meldung.

## Was danach passiert

1. Wir prüfen die Meldung und legen die Schwere fest. Wird die Lücke ausgenutzt oder ist sie ohne Anmeldung leicht auszunutzen, schalten wir die betroffene Funktion sofort ab. Ist sie mit Folgen für Daten, Anrufe oder Kosten ausnutzbar, beheben wir sie binnen 30 Tagen, sonst binnen 90 Tagen.
2. Den Fix bauen wir im Verborgenen. Rückfragen stellen wir dir in der Meldung.
3. Sobald der Fix ausgeliefert ist, veröffentlichen wir den Sicherheitshinweis. Bis dahin steht über die Lücke nichts öffentlich im Repo.

## In English

Please do not open a public issue. Report vulnerabilities privately via GitHub's [“Report a vulnerability”](https://github.com/sundartha/hermes/security/advisories/new). We fix exploitable issues with impact on data, calls or costs within 30 days and all others within 90 days, and publish the advisory once the fix is live.
