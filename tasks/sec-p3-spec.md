# SEC-P3 — Ergaenzung zum Phasenabschnitt in PLAN-SEC-FIX.md

ERGAENZT `PLAN-SEC-FIX.md` -> "SEC-P3 — Eingabegrenzen + CSRF". Ersetzt ihn nicht.

## Betriebsfakt, ohne den die Herkunftspruefung falsch gebaut wird

**Die App laeuft SINGLE-ORIGIN.** `render.yaml` (Phase A, 2026-06-27): der Gateway baut UND
serviert `apps/web`; Dashboard-Shell und `/api/*` liegen unter EINEM Origin
(`app.sundartha.com`). Die Marketing-Site `sundartha.com` ist eine getrennte statische Site,
auf der `/api` gar nicht existiert (404).

Folge: die vier zu schuetzenden Routen (`settings`, `private-number`, `subscribe`, `cancel`)
sitzen hinter `webAuthMw` und werden ausschliesslich aus der gleich-origin App-Shell
aufgerufen. Eine Herkunftspruefung ist hier machbar, ohne legitime Aufrufer zu brechen —
aber nur, wenn sie den ECHTEN Origin dieses Deployments kennt und nicht einen geratenen.

**Bevorzugte Richtung (nicht vorgeschrieben, aber begruendungspflichtig, wenn abgewichen
wird):** die Pruefung vergleicht den Host des `Origin`-Headers mit dem Host, unter dem der
Request tatsaechlich hereinkam. Das ist ohne jede Konfiguration in jedem Deployment richtig —
lokal, Render-Interndomaene, Kundendomaene — und hat damit keinen Fehlkonfigurations-Ausgang.
Eine gepflegte Liste erlaubter Origins hat ihn: sie ist genau einmal falsch und das Dashboard
ist tot.

## Pre-Mortem (Pflicht nach CLAUDE.md)

Ein Jahr spaeter, dieser Fix hat Schaden angerichtet. Was ist passiert?

1. **Die Herkunftspruefung hat das eigene Dashboard ausgesperrt.** Die Liste erlaubter
   Origins kannte die produktive Domaene nicht (oder eine Domaenen-Aenderung zog sie nicht
   nach). Jede Zustandsaenderung antwortet 403; kein Kunde kann mehr etwas einstellen,
   kuendigen oder buchen. Deshalb der Absatz oben.
2. **Die Laengengrenze hat internationale Namen verstuemmelt.** Eine Inhaltspruefung, die
   auf ein lateinisches Zeichen-Alphabet setzt, verwirft `Zoë`, `Müller`, kyrillische,
   arabische, chinesische Namen. Das Produkt ist ausdruecklich WELTWEIT ausgelegt
   (`en` als Weltdefault). **Eine Zeichen-Allowlist ist verboten.** Was zulaessig ist:
   eine LAENGE (in Zeichen, nicht Bytes) und das Verwerfen von Steuerzeichen und
   Zeilenumbruechen — genau die, mit denen sich eine Prompt-Struktur aufbrechen laesst.
3. **Die Grenze wurde geprueft, nachdem geschrieben wurde.** Die Antwort ist 400, der Wert
   steht trotzdem im Store. Die Abnahme verlangt ausdruecklich BEIDES: Status 400 UND
   Store unveraendert.
4. **Die Pruefung landete auf einer Route, die keinen Origin bekommt.** Anbieter-Webhooks
   (`/voice/*`), `/mcp` und Server-zu-Server-Aufrufer senden keinen Origin. Der Abschnitt
   sagt es schon, hier steht der Grund: eine fail-closed-Variante bricht genau diese
   Aufrufer — und bei `/voice` heisst das: eingehende Anrufe sterben. **Fehlender Origin ->
   weiterhin 200. Ein FREMDER Origin -> 403.**
5. **Die Grenze traf Freitextfelder, die gar nicht in den Prompt laufen**, und lehnte
   legitime lange Eingaben ab (z.B. ein Briefing). Der Auftrag lautet: Felder, die in einen
   Prompt laufen. Welche das sind, ist am Code zu ERMITTELN und im Plan zu benennen — nicht
   zu raten und nicht pauschal ueber alle Strings zu ziehen. Verschiedene Felder duerfen
   verschiedene Grenzen haben.

## Randbedingungen

- **Kein Backfill noetig.** Es gibt keine Fremdkunden; alle aktiven Konten sind wir
  (Lehre `no-existing-customers-premise`). Die Grenze gilt auf dem SCHREIBWEG. Bestehende
  laengere Werte duerfen beim LESEN nicht plötzlich werfen — das waere ein Ausfall, kein Schutz.
- **Jede neue Env-Variable** (`CSRF_ENFORCE`, `AGENT_NAME_MAX_LEN` oder wie sie am Ende
  heissen) wird in `src/config.js` zentralisiert, in `.env.example` dokumentiert, in
  `render.yaml` geprueft UND neutral in `BASE_ENV` (`test/helpers.js`) gepinnt — sonst leakt
  die echte `.env` in jeden Spawn-Test (Lehre `test-base-env-drift`).
- **Neue oeffentliche Ausnahmen gibt es nicht.** Wird eine Route beruehrt, die in
  `src/route-policy.js` steht, bleibt ihr Eintrag korrekt — `test/route-auth-inventory.test.js`
  ist das Gate dafuer.
- Die Fehlerantwort nennt den Grund, aber verraet nichts: kein Echo des abgelehnten Wertes,
  keine Liste erlaubter Origins in der Antwort.

## Abnahme (aus dem Abschnitt, unveraendert, hier nur zusammengezogen)

1. 20.000 Zeichen in `agentName` -> **400** mit Laengenfehler **und** Wert im Store
   unveraendert.
2. Fremder `Origin` auf `settings`, `private-number`, `subscribe`, `cancel` -> **403** und
   kein Zustandswechsel.
3. **Fehlender** `Origin` -> weiterhin **200**.
4. Positiv-Kontrolle, sonst misst der Test eine tote Route: der EIGENE Origin kommt auf
   denselben Routen normal durch (200 + Zustandswechsel).
5. Zusaetzlich aus Pre-Mortem 2: ein Name mit Umlauten und ein Name in nicht-lateinischer
   Schrift, beide innerhalb der Laenge, werden AKZEPTIERT und unveraendert gespeichert.
