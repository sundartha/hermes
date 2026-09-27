# T2-19 – Abschlussbericht: Support-Seite Website (nur staging/Labor)

Branch `phase/openai-t2-19-support-page-website`, Commit `78110e1`, Umfang laut Auftrag: **nur O-7**.

## 1. Was diese Phase NICHT erfuellt

- **Kein Push, kein Deploy, keine Pruefung im Labor.** Die Kette pusht nie (Auftragsregel).
  Alles, was mit `hermes-web-staging`/`hermes-web` tatsaechlich zu sehen ist – Auto-Deploy,
  `curl https://hermes-web-staging.onrender.com/support`, Browser-Konsole ohne CSP-Verstoss,
  mobile Ansicht – ist **ungeprueft** und liegt beim Owner (Abschnitt 5).
- **Kein Kontaktformular, kein Telefon, kein Chat, keine Reaktionszeit/SLA.** Bewusst nicht
  gebaut: dafuer verlangt OpenAI nichts, es gibt keinen Beleg im Code/Rechtstext, und eine externe
  Quelle wuerde die Produktions-CSP (`default-src 'self'`) brechen.
- **Keine Selbstbedienungs-Loeschung/-Export, kein serverseitiger Connector-Widerruf.** Gibt es im
  Produkt nicht (waere Backend-Arbeit ausserhalb O-7). Die Seite sagt das ehrlich: Loeschung/Auskunft
  nur per E-Mail.
- **"Anruf abbrechen" fehlt bewusst.** `cancel_call` hat Vorbehalte (Datensatz vs. tatsaechliche
  Leitung), die sich auf einer Support-Seite nicht ehrlich in einem Satz darstellen lassen –
  deshalb ausgelassen statt verkuerzt/irrefuehrend behauptet.
- **Rechtstexte nicht angefasst.** `src/data/legal/*.json` und `/kuendigen` sind unveraendert,
  nur verlinkt (Rechtstext-Inhalt = Owner).
- **Kopf-/Fussband der Website bleibt deutsch, auch auf der englischen Support-Seite** ("So
  funktioniert's", "Registrieren", "Datenschutz" …). Das ist Bestand, nicht Teil von O-7, und wurde
  nicht angefasst.
- **`docs/RUNBOOK-LAB-LIVE.md` wurde nicht korrigiert**, obwohl beim Lesen zwei Abweichungen
  aufgefallen sind (Abschnitt 4/5): Das Runbook sagt `git push origin`, tatsaechlich ist laut
  Projekt-Wissen `upstream` das Deploy-Repo; und es nennt den Gateway "konstruktiv isoliert", waehrend
  `render.yaml` `apps/web` im selben Build-Schritt wie den Gateway baut. Eine Korrektur des Runbooks
  liegt ausserhalb `apps/web/**` und wurde bewusst nicht vorgenommen (Owner-Hinweis statt Fix).
- **Abweichung von der Pfad-Vorgabe im Plan:** Plan T2-19 sagt "Branch von `staging`, kein Merge
  auf `master`". Der Lead hat stattdessen gepinnt: Branch von `master`, lokaler Merge auf `master`.
  Diese Phase folgt der Lead-Pinnung, nicht dem Plan-Text – das Labor bleibt trotzdem Pflicht, weil
  die Kette nie pusht.

## 2. Was sie erfuellt – ID O-7

**Primaerquelle, woertlich:** developers.openai.com/plugins/deploy/submission ("Final checklist"):
> "Privacy policy, terms, support, and website URLs are public and match the publisher identity."

Anforderungstext (`tasks/openai-audit/00-openai-anforderungen.md:102`) fasst das als:
> "Pflicht-URLs im Listing: Website, Support-URL, Privacy-Policy-URL, Terms-URL – oeffentlich und
> zur Publisher-Identitaet passend."

Gebaut, mit Beleg:

| Teilanforderung | Beleg |
|---|---|
| Oeffentliche Support-Seite existiert | `apps/web/src/pages/support.astro` (neu, 131 Zeilen); Build erzeugt `dist/support/index.html` (gemessen, s. Abschnitt 3) |
| Indexierbar in Produktion | `dist/support/index.html` enthaelt **kein** `name="robots"`-Meta (gemessen per `grep`); der Test `"Support-Seite: indexierbar, kanonisch, ..."` in `apps/web/test/pages.test.js` prueft genau das und ist Teil der 216 gruenen Tests. Das Labor selbst setzt `noindex` **per HTTP-Header**, nicht im HTML (`docs/RUNBOOK-LAB-LIVE.md:15`) – die gebaute Seite ist also produktionsseitig indexierbar, das Labor unterscheidet sich nur durch den Header, den ein Deploy dort setzt. |
| Kanonisch, zur Publisher-Identitaet passend | Gebauter canonical-Link: `https://sundartha.com/support/` (gemessen). Sitemap-Eintrag `apps/web/public/sitemap.xml` neu: `<url><loc>https://sundartha.com/support</loc></url>`. |
| Im Footer verlinkt | `apps/web/src/layouts/Hermes.astro` (App-Shell-Footer) und `apps/web/src/pages/index.astro` (Marketing-Footer + mobiles Menue) tragen je einen neuen `<a href="/support">Support</a>`. Test `"jede oeffentliche Seite verlinkt /support"` prueft das ueber alle `PUBLIC_PAGES` und ist gruen. |
| Kontaktangabe stammt aus dem Bestand, keine erfundene Adresse | Support-Seite nutzt `kontakt@sundartha.com` – dieselbe Adresse wie Impressum (`imprint.de.json:18`) und AGB (`terms.de.json:34`). Kein Telefon, keine SLA: Test-Regex `UNBACKED_PROMISE` (24/7, SLA, Frist-Angaben, Telefonnummer) prueft das mit **Positiv-Kontrolle** (eigener Test bestaetigt, dass die Regex auf Beispieltexte anschlaegt) gegen den sichtbaren Text der gebauten Seite. |
| Keine erfundene Funktion | Der "Transkript im Kundenbereich"-Passus trägt einen Vorbehalt, der im Text der Seite selbst steht und per Regex `PROVIDER_RETENTION_NOTE`/`TRANSCRIPT_DELETION_NOTE` erzwungen wird: das Wortprotokoll wird im eigenen System nach der Zusammenfassung geloescht (Kommentar verweist auf `src/telephony/call-finish.js` `purgeTranscript`), der Gespraechs-Plattform-Anbieter loescht **nicht** automatisch (Beleg: `privacy.de.json` Abschnitt "Speicherdauer", vom Betreiber am 20.09.2026 an der Live-Konfiguration gemessen laut Notiz in dieser Datei – ich habe diese Messung selbst nicht nachvollzogen, nur die Textquelle gelesen). |
| Keine interne Kennung auf der Seite | Regex `INTERNAL_ID` (T2-\d+, OW-[A-Z], O-\d+, N-\d+, H-\d+) mit Positiv-Kontrolle, geprueft gegen den sichtbaren Text der gebauten Seite. Eigene Sichtpruefung des Quelltexts: keine solche Kennung im sichtbaren Markup gefunden. |
| Kein neuer externer Host, CSP unveraendert | `support.astro` bindet kein Inline-Script/-Style und keine fremde Quelle ein (Kommentar im Kopf der Datei nennt das als Bedingung). Eigene Messung: `grep -o 'https\?://[a-z0-9.-]*' dist/support/index.html` liefert nur `sundartha.com` (Canonical/OG) und `vodafone-agent.onrender.com` (Login-Link, `<a href>`, kein Script-/Style-Tag). Test `"Support-Seite: keine Quelle oder kein Link auf einen fremden Host"` erlaubt genau diese zwei Hosts (Publisher-Domain + Gateway-Host aus `LOGIN_URL`) und ist gruen. |
| `apps/web`-Build gruen | Eigener Lauf `PUBLIC_GATEWAY_URL=... npm run build` in `apps/web`: **12 Seiten gebaut, 0 Fehler**, `/support/index.html` in der Liste. Log: `scratchpad/logs-t2-19/verify-web-build.log`. |
| `apps/web`-Tests gruen | Eigener Lauf `npm test` in `apps/web`: **216/216 bestanden, 0 fehlgeschlagen**. Log: `scratchpad/logs-t2-19/verify-web-test.log`. |

**Zusaetzlich (Lead-Notiz, HermesDemo/hermes-scroll):** Die Demo auf `/` und `/so-funktionierts`
nannte `get_transcript`/`get_calendar` und einen Kalender-Eintrag, die es im MCP-Server nicht mehr
gibt. Ich habe die Ist-Werkzeugnamen direkt in `src/mcp-tools.js` (grep auf
`prepare_call`/`place_call`/`list_calls`/`get_call_result`) gegen die Demo-Texte geprueft: das
gebaute HTML nennt jetzt `prepare_call · place_call · list_calls · get_call_result`, keinen
Kalender-Eintrag und kein Dashboard-Transkript-Versprechen mehr (`apps/web/src/components/
HermesDemo.astro`, `apps/web/src/scripts/hermes-scroll.js`). Eigene Messung:
`grep -rn "get_transcript|get_my_number|get_calendar" apps/web/src` liefert **0 Treffer**
(Abnahmekriterium aus dem Plan erfuellt). Test `"Demo nennt nur heutige Werkzeuge, ..."` mit
Positiv-Kontrolle ist gruen.

Lead-Notiz war an einer Stelle sachlich unpraezise: sie behauptete, die Demo nenne
`get_transcript`/`get_my_number`; tatsaechlich standen dort `get_transcript`/`get_calendar` –
`get_my_number` kam in `apps/web` nie vor. Der Plan-Text (nicht die Lead-Notiz) hatte hier recht.

## 3. Beruehrte Pfade und Vollstaendigkeit

| Datei | O-7 erfuellt? |
|---|---|
| `apps/web/src/pages/support.astro` (neu) | ja – Kernstueck, s. Abschnitt 2 |
| `apps/web/src/layouts/Hermes.astro` | ja – Footer-Link im Kundenbereich |
| `apps/web/src/pages/index.astro` | ja – Footer-Link + mobiles Menue auf der Marketingseite |
| `apps/web/public/sitemap.xml` | ja – neuer `<url>`-Eintrag |
| `apps/web/src/components/HermesDemo.astro` | zusaetzlich (Lead-Notiz, s.o.), nicht O-7 selbst |
| `apps/web/src/scripts/hermes-scroll.js` | zusaetzlich (dieselbe Nachziehung fuer den DE-Laufzeit-Umschalter) |
| `apps/web/test/pages.test.js` | Testabdeckung fuer beides |

Alle vier fuer O-7 relevanten Pfade sind konsistent (Footer-Link auf allen oeffentlichen Seiten,
Sitemap-Eintrag, Seite selbst) – per Test durchgesetzt, nicht nur behauptet.

## 4. Was ein fremder Pruefer nachmessen sollte

- Ist `dist/support/index.html` nach `npm run build` (mit `PUBLIC_GATEWAY_URL` gesetzt) vorhanden,
  und enthaelt sie **kein** `name="robots"`-Meta? (`grep -o 'name="robots"[^>]*' dist/support/index.html`)
- Traegt der canonical-Link `https://sundartha.com/support/`, und steht `https://sundartha.com/support`
  (ohne Schraegstrich) in `apps/web/public/sitemap.xml`?
- Verlinken alle in `apps/web/test/pages.test.js` unter `PUBLIC_PAGES` gelisteten Seiten `/support`
  im gebauten HTML?
- Enthaelt der sichtbare Text der Support-Seite eine Frist, "24/7", eine Telefonnummer oder ein
  SLA-Versprechen – oder eine interne Kennung (`T2-\d+`, `O-\d+`, `OW-[A-Z]`, `N-\d+`, `H-\d+`)?
- Verweist die gebaute Seite (Attribute `src=`/`href=`) auf einen anderen Host als
  `sundartha.com` und den Host aus `PUBLIC_GATEWAY_URL`/`LOGIN_URL`?
- Steht auf der Seite eine Aussage ueber Transkripte im Kundenbereich, ohne den Vorbehalt, dass
  der Gespraechs-Plattform-Anbieter das Gespraech separat speichert und nicht automatisch
  loescht – und stimmt dieser Vorbehalt mit dem Wortlaut in `apps/web/src/data/legal/privacy.de.json`
  (Abschnitt "Speicherdauer") ueberein?
- Liefert `grep -rn "get_transcript\|get_my_number\|get_calendar" apps/web/src` wirklich 0 Zeilen,
  und stimmen die in `HermesDemo.astro`/`hermes-scroll.js` genannten Werkzeugnamen mit den
  tatsaechlichen Namen in `src/mcp-tools.js` ueberein?
- Laeuft `npm test` in `apps/web` tatsaechlich mit 216 bestandenen und 0 fehlgeschlagenen Tests,
  und `npm run build` mit 12 gebauten Seiten inklusive `/support/index.html`?
- Sind Rechtstexte (`src/data/legal/*.json`, `/kuendigen`) im Diff dieser Phase unveraendert?
- Ist `disclosureSentence`/`src/claude.js`/die Prompt-/Tool-Texte des MCP-Servers im Diff dieser
  Phase unveraendert (byte-gleich zu `master`)?

## 5. Owner-Punkte und Restrisiko

- **Labor (Weg A, nur Website):** `git fetch upstream && git checkout -b web-support
  upstream/master && git cherry-pick <T2-19-Commit(s) von master>` (vorher `git show --stat`
  pruefen: nur `apps/web/**` betroffen), dann `git push upstream web-support:staging`
  (Fast-Forward). Erwartet: Auto-Deploy von `hermes-web-staging`;
  `https://hermes-web-staging.onrender.com/support` liefert 200; Footer-Link "Support" auf
  Start- und Unterseiten sichtbar; Browser-Konsole ohne CSP-Verstoss; die Demo auf `/` zeigt
  `prepare_call` und die Bestaetigung in der Karte; mobil lesbar.
- **Live:** `git push upstream web-support:master` (Fast-Forward), danach `hermes-web` manuell
  im Render-Dashboard deployen. **Warnung:** jeder Push auf `upstream master` kann laut
  `render.yaml` auch den Gateway-Service deployen, weil `apps/web` dort im selben Build-Schritt
  gebaut wird und der Build-Filter das Frontend nicht ausschliesst; ein Push des lokalen `master`
  nach `upstream` bringt zusaetzlich alle unveroeffentlichten Backend-Commits dieser Kette live.
  Das ist eine bewusste Entscheidung (Weg B: Website erst zusammen mit der ganzen Kette live), kein
  Versehen dieser Phase.
- **Messung nach dem Live-Deploy:** `curl -sI https://sundartha.com/support` -> 200 und **kein**
  `X-Robots-Tag: noindex`; `curl -s https://sundartha.com/support | grep -c 'name="robots"'` -> 0.
  Danach diese URL als Support-URL im OpenAI-Formular eintragen.
- **Publisher-Identitaet:** Der bei OpenAI hinterlegte Name muss zu "Sundartha"/Impressum passen.
  Das Impressum traegt noch `[OFFEN]`-Platzhalter (vollstaendiger Firmenname, Anschrift,
  Telefonnummer) – Rechtstext-Inhalt ist Owner-Sache.
- **Runbook-Korrektur (optional, ausserhalb dieser Phase):** `docs/RUNBOOK-LAB-LIVE.md` sagt
  `git push origin`, tatsaechlich deployt laut Projekt-Wissen `upstream`; und es nennt den Gateway
  "konstruktiv isoliert", was `render.yaml` widerspricht. Beides wurde nur festgehalten, nicht
  korrigiert, weil ausserhalb `apps/web/**`.

**Restrisiko in einem Absatz:** Der Code-Anteil dieser Phase ist eng, belegt und durch gruene
Tests mit Positiv-Kontrollen abgesichert (Build 12/12, Tests 216/216, kein externer Host, keine
interne Kennung, keine unbelegte Zusage) – das Risiko, dass die Seite selbst etwas Falsches
behauptet, ist damit klein. Das groessere Restrisiko liegt ausserhalb des Codes: die Seite geht
erst mit einem manuellen Owner-Deploy live, und dieser Deploy kann laut `render.yaml` ungewollt
auch den Gateway-Service mitziehen, weil das Runbook den Build als "isoliert" beschreibt, was die
Config nicht bestaetigt. Wer dem Runbook folgt, ohne diesen Punkt zu kennen, riskiert einen
unbeabsichtigten Backend-Deploy beim Versuch, nur die Website zu aktualisieren.

## Unabhaengige Verifikation (gewinnt gegen alles oben)

- Urteil des Laufs: PASS (PASS nur bei beiden Reviews PASS, allen IDs ja, keinem isoliert roten Test)
- Gemessener Commit: 78110e1; Tests (volle Suite, pass/fail): 6733/0
- Review-Urteile zuletzt: {"safety":"PASS","cleancode":"PASS"}
- Tabelle ID | erfuellt | Beleg | Luecke:

| ID | erfuellt | Beleg | Luecke |
|---|---|---|---|
| O-7 | true | apps/web/src/pages/support.astro:36-131 neu; Build ergibt support/index.html ohne noindex, kanonisch auf sundartha.com/support, 'Hermes is provided by Sundartha', kontakt@sundartha.com, Links /datenschutz /agb /impressum; Sitemap:12; web-Tests 216/0 | Live-Rest offen, nur beim Owner messbar: Labor-Deploy, Pruefung auf hermes-web-staging, manueller Deploy von hermes-web, Support-URL im OpenAI-Formular eintragen. Die Terms-/Privacy-Seiten gibt es verbindlich nur auf Deutsch. |

- Isoliert rot: []
- Offene Blocker:
- (keine)
