# Prompt fuer die naechste Session — Kosten-Vollstaendigkeit

> In eine FRISCHE Session einfuegen. Nichts davon ist ein Befund; alles ist eine Aufgabe.

---

Untersuche mit einem dynamischen Workflow, ob in Hermes jede Kosten-Art, die ein Anruf
verursacht, dem Tenant zugerechnet wird, der sie verursacht hat — und ob der Budget-Guard
sie sieht.

Die Frage dahinter ist eine Geschaeftsfrage, keine technische: **kann ein Nutzer heute mehr
telefonieren, als ihm abgerechnet wird?** Jede Kosten-Art, die anfaellt, aber nicht auf der
Achse landet, die das Gate liest, ist genau das. Am Ende will ich belastbar wissen, dass
ALLE Kosten beim Nutzer ankommen — nicht "im Wesentlichen", sondern vollstaendig und
nachgerechnet.

## Was am Ende stehen soll

1. Ein **Kosten-Inventar**: jede Kosten-Art, die ein Anruf (in- und outbound) und der
   laufende Betrieb erzeugen. Je Art: welcher Anbieter stellt sie in Rechnung, wo entsteht
   sie im Code, wird sie erfasst, wird sie bepreist, wird sie einem Tenant zugeordnet,
   landet sie auf der Achse, die `budgetExceeded` liest. Jede Zeile mit Fundstelle und mit
   einem Beleg (DB-Zeile, Provider-Record oder Rechnung) — nicht aus dem Code erschlossen.
2. Eine **Luecken-Liste**: jede Kosten-Art, bei der die Kette bricht, mit Groessenordnung.
   Ohne Groessenordnung ist eine Luecke nicht priorisierbar.
3. Ein **Strategie-Dokument in Phasen**, im Stil von `PLAN-KOSTEN-STEUERUNG.md`: Befund,
   Wurzel, Phasen mit Reihenfolge und Abhaengigkeiten, Pre-Mortem, Owner-Entscheidungen,
   Abnahmekriterien je Phase. NICHT implementieren — das entscheide ich nach dem Lesen.

## Vorgehen

- **Dynamischer Workflow**, mehrstufig: erst faecherfoermig finden (je Agent eine Achse —
  Provider-Abrechnung, Code-Buchungspfade, DB-Ist-Stand, Gate-Pfade), dann pro Befund
  adversarisch verifizieren (der Verifizierer versucht ihn zu WIDERLEGEN), dann
  synthetisieren. Ein Befund, der die Verifikation nicht ueberlebt, kommt nicht ins Dokument.
- **Clean-Code-Gate** und Safety-Review wie in `.claude/refs/`, auch fuer reine
  Untersuchungs-Artefakte: kein Dokument mit geratenen Zahlen.
- **Token-effizient**: der Lead liest keinen Code und bleibt duenn. Ergebnisse kommen als
  strukturierte Rueckgaben und als Datei unter `tasks/`, nicht als Rohtext in den Kontext.
- **Messen statt schliessen.** Jede Kosten-Behauptung braucht einen Beleg aus der echten
  Abrechnung oder der Prod-DB. Was sich nicht messen laesst, wird als "ungemessen"
  gefuehrt, nicht als "vernachlaessigbar".
- **Notizen und Bestandsdokumente sind Hinweise, keine Wahrheit.** `PLAN-SECURITY.md`,
  `PLAN-KOSTEN-STEUERUNG.md`, `tasks/*` und Memory-Eintraege koennen veraltet oder falsch
  sein. Was zaehlt, ist der Code und die Rechnung.

## Harte Regeln

- **Nur lesen.** Keine Code-Aenderung, kein Commit auf master, kein Deploy, kein
  schreibender Zugriff auf die Prod-DB, keine Env-Aenderung im Render-Dashboard.
- Keine Loeschung von Provider-Ressourcen.
- Secrets nie ausgeben, nie loggen, nie in ein Dokument schreiben — auch nicht gekuerzt.
- `CLAUDE.md` gilt unveraendert, insbesondere Absolute Regel 1.

## Werkzeuge, die du sonst neu suchen musst

Kein Befund, nur Zugang:

**Prod-DB** (`psql "$(cat ~/.config/hermes/db-url)"`). FORCE-RLS: ein naives `SELECT`
liefert 0 Zeilen. Die Policy auf `call` lautet
`tenant_id = current_setting('app.current_tenant', true)`; die Rolle hat kein `BYPASSRLS`
und `SET row_security = off` schlaegt fehl. Arbeitsweise: `SELECT id FROM tenant;`, dann je
Tenant `SET app.current_tenant = '<id>';` vor der Abfrage. Bei
`SSL connection has been closed unexpectedly`: meist die IP-Allowlist im Render-Dashboard,
nicht TLS.

**Telnyx-Abrechnung**: `GET https://api.telnyx.com/v2/detail_records`. `filter[record_type]`
ist PFLICHT (sonst HTTP 400, Code 10011), und `filter[date_range]` nimmt Presets wie
`last_24_hours` — die `gte`/`lte`-Form hat in der Praxis leere Mengen geliefert. Key aus
`.env` lesen, ohne ihn auszugeben.

**Render-Logs** ueber die Render-MCP-Tools; Gateway-Service `srv-d8m0fhflk1mc73bno570`,
Workspace `tea-d8m0b9jeo5us73cvasg0`.

**Ein durchgerechnetes Beispiel**: `call_ms8nfsbk7cck` (2026-07-31, outbound, ~40 s,
abgeschlossen und cost-getrued). Eignet sich, um Provider-Belege, `call`-Zeile,
`usage_event` und `usage` gegeneinander zu rechnen.

## Was NICHT Teil der Aufgabe ist

Preisgestaltung, Tarifmodelle, Margen. Die Frage ist ausschliesslich, ob wir die Kosten
vollstaendig erfassen und zuordnen — nicht, was wir dafuer verlangen.
