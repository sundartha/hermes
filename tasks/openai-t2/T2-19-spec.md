# T2-19 Spec - Support-Seite Website (nur staging/Labor)

Stand: 2026-09-27. Umfang: GENAU O-7 (+ vom Lead zusaetzlich gepinnt: HermesDemo-Werkzeugnamen).
Basis: master `f096103`. Branch `phase/openai-t2-19-support-page-website`,
Worktree `/private/tmp/claude-501/-Users-antonio-Mein-Unternehmen-MCP-vodafone-agent/bd9573f0-5514-4611-89e2-53dd73e46bd1/scratchpad/wt-t2-19`.
Diese Datei bleibt UNGETRACKT im Haupt-Arbeitsbaum.

## Arbeitsplatz (bereits angelegt)

- `node_modules` (Root) ist per Symlink verbunden.
- ZUSAETZLICH angelegt: `apps/web/node_modules` -> Symlink auf `<Haupt-Checkout>/apps/web/node_modules`
  (apps/web hat eine eigene Lockfile; ohne diesen Link baut nichts). Folge: der Vite-Cache
  (`node_modules/.vite-<outDir>`, astro.config.mjs) liegt im Haupt-Checkout. Deshalb NIE zwei
  Website-Builds gleichzeitig (Haupt-Checkout + Worktree) fahren.
- Beide Symlinks NIE committen (`git status` vor jedem Commit; Dateien einzeln adden).
- Build braucht `PUBLIC_GATEWAY_URL` (fail-closed, `apps/web/src/lib/routes.js`), z.B.
  `PUBLIC_GATEWAY_URL=https://app.sundartha.com npm --prefix apps/web run build`.

## Baseline (gemessen im Worktree, vor jeder Aenderung)

- `npm --prefix apps/web run build`: rc 0, "11 page(s) built".
- `npm --prefix apps/web test`: `tests 209 / pass 209 / fail 0`.
- `npx eslint apps/web/src/scripts/hermes-scroll.js apps/web/test/pages.test.js apps/web/src/lib/legal.js`: 0 Befunde.
- stdio `tools/list` (echter Kindprozess `node src/mcp-server.js`, Temp-DATA_DIR):
  `prepare_call place_call get_call_status get_call_result cancel_call get_agent_number list_calls check_inbox list_action_items get_agent_status` (10).
- `grep -rn "get_transcript\|get_my_number\|get_calendar" apps/web/src` -> genau 2 Treffer:
  `HermesDemo.astro:39` und `:69` (jeweils `get_transcript` und `get_calendar`; `get_my_number` kommt NICHT vor).

## OpenAI-Anforderung (Primaerquelle, woertlich, abgerufen 2026-09-27)

- https://developers.openai.com/plugins/deploy/submission, Abschnitt "Prepare required materials":
  "Plugin name, short description, long description, logo, category, website, support URL, privacy policy URL, and terms URL."
- dieselbe Seite, "Complete the form" -> "Info":
  "Website, support, privacy, and terms URLs: Use public URLs that match the publisher and disclose relevant data handling."
- dieselbe Seite, "Final checklist":
  "Privacy policy, terms, support, and website URLs are public and match the publisher identity."
- Nur als Kontext (O-8, NICHT im gepinnten Umfang): https://developers.openai.com/plugins/app-guidelines,
  "Developer verification": "You must provide customer support contact details where end users can reach you for help."
  und "Keep this information accurate and up to date."

Daraus folgt fuer O-7 genau: eine OEFFENTLICHE Support-URL auf der Domain des Publishers
(sundartha.com = Sundartha), die Kontaktdaten nennt. OpenAI verlangt KEINE Reaktionszeit, kein
Telefon, kein Formular - also bauen wir nichts davon.

## Belegte Fakten fuer den Seitentext (jede Aussage der Seite muss hierauf zurueckfuehren)

| Aussage | Beleg |
|---|---|
| Kontakt `kontakt@sundartha.com` | bereits oeffentlich: `apps/web/src/layouts/Hermes.astro:16`, `src/pages/index.astro:40`, `src/data/legal/imprint.de.json:18`, `privacy.de.json:10/46/58` |
| Anbieter ist Sundartha | Footer `Hermes.astro:85` "© Sundartha", Impressum |
| Keine Selbstbedienung fuer Auskunft/Loeschung; dafuer E-Mail | `src/routes/api-read.js:110-119` (Export nur `internalOnly`, "Loeschung (Art. 17) hat KEINEN Endpunkt - nur Script"), `scripts/erase-tenant.js` (Betreiber), Datenschutz `privacy.de.json` ("Einen Selbstbedienungs-Weg zur Löschung gibt es im Dienst nicht. Wende dich für Auskunft und Löschung an kontakt@sundartha.com.") |
| Abrechnungsdaten bleiben fuer gesetzliche Fristen | `privacy.de.json` (gleicher Abschnitt) |
| Vertrag kuendigen: Kundenbereich oder E-Mail | `apps/web/src/pages/kuendigen.astro` (oeffentlich), Route `POST /api/self-service/billing/cancel` (`src/self-service-routes.js:963`, webAuthMw), Client `apps/web/src/lib/api.js:171` |
| Anrufe mit Zusammenfassung + Transkript im Kundenbereich | `apps/web/src/components/app/CallsIsland.astro:65-68`, `apps/web/src/lib/render.js` (`callSummary`, `transcriptFrom`) |
| Connector trennen = Einstellung im KI-Programm (Host) | Host-seitig; KEINE serverseitige Widerrufs-Route fuer MCP-Zugriff vorhanden (`grep -rn revoke src` trifft nur Newsletter-Einwilligung `self-service-routes.js:548`, Billing/DB). Darum nur generisch formulieren, KEINE Menuepfade von ChatGPT/Claude nennen |
| Ein laufender Anruf endet NICHT durch Trennen des Connectors | Anruf laeuft auf der Telefonie-Seite, `/mcp` ist zustandslos (`src/routes/mcp.js`); Ende ueber Max-Dauer/Gespraechsende |
| Rechtstexte verbindlich auf Deutsch | `apps/web/src/lib/legal.js:143-149` `legalFooterLinks` (Rueckfall auf `BINDING_LEGAL_LANGUAGE`), aktuell keine EN-Fassung gebaut |

NICHT behaupten (kein Beleg bzw. nur mit Vorbehalt wahr): Reaktionszeit/SLA/"24/7", Telefon-Support,
Chat, Formular, Daten-Export/Loeschung per Knopf, Transkripte selbst loeschen, "Anruf abbrechen"
(`cancel_call` traegt bewusst Vorbehalte Datensatz vs. Leitung, s. `CANCEL_CALL_DESCRIPTION`),
Konto loeschen per Knopf, Preise.

## Schritte

### 1. Neue Seite `apps/web/src/pages/support.astro` (EN)
- Layout: `import Hermes from "../layouts/Hermes.astro"`, `<Hermes lang="en" title="Support — Hermes by Sundartha" description="...">`,
  KEIN `noindex`-Prop (Produktion muss indexierbar sein; das Labor setzt noindex per Header).
- Stil wie `kuendigen.astro` (vorhandene Klassen `doc-title`, `doc-lead`, `doc-block`, `sheet__card`,
  `step`, `doc-note`), KEIN Inline-Style, KEIN `<script>`, keine externe Ressource.
- Inhalt (Englisch, nur die Fakten aus der Tabelle oben; Formulierungsvorschlag, darf gestrafft, aber
  nicht geglaettet werden - kein Vorbehalt faellt weg):
  1. Lead: "Hermes is provided by Sundartha. If you need help with Hermes, email us at kontakt@sundartha.com." (mailto-Link)
  2. "Get help": per E-Mail; bei einem bestimmten Anruf Datum/Uhrzeit nennen. Keine Frist.
  3. "Your calls": Zusammenfassung und Transkript jedes Anrufs im Kundenbereich (Link `LOGIN_URL` aus `../lib/routes.js`).
  4. "Disconnect Hermes from ChatGPT or Claude": den Hermes-Connector in den Connector-/App-Einstellungen des
     jeweiligen KI-Programms entfernen. Vorbehalte PFLICHT: (a) ein bereits laufender Anruf wird dadurch nicht
     beendet; (b) bei uns gespeicherte Daten werden dadurch nicht geloescht -> Abschnitt 5.
  5. "Access or delete your data": kein Selbstbedienungs-Weg in Hermes; Auskunft/Kopie und Loeschung per E-Mail
     an kontakt@sundartha.com; Abrechnungsdaten bleiben fuer die gesetzlichen Aufbewahrungsfristen; Details in der
     Datenschutzerklaerung.
  6. "Cancel your contract": Link `/kuendigen` (Hinweis "page in German"): im Kundenbereich oder per E-Mail.
  7. "Legal": Links ueber `legalFooterLinks(LEGAL_CONTENT, "en")` (`../lib/legal.js`, `../lib/legal-content.js`,
     wie `layouts/Site.astro:98-99`) - so zeigt der Link automatisch auf eine kuenftige EN-Fassung, heute auf die
     deutsche. Satz: "The binding versions of our legal documents are in German."
- Kommentar-Kopf (Deutsch, ohne Umlaute): Zweck (oeffentliche Support-URL fuer die Einreichung), Belegquellen,
  Regel "keine Fristen/keine erfundenen Wege", indexierbar.
- Verboten auf der Seite: interne Kennungen (T2-, O-, OW-, N-, H-, Phasennamen), Produktionswerte, Telefonnummern,
  "24/7", "SLA", "within X hours/days", Preise, Wettbewerbsvergleich.
- IDs: O-7. Pfade: nur Website (statisch, sundartha.com + Labor); kein MCP-/OAuth-/stdio-Pfad betroffen.
- Beweis: (b) Test aus Schritt 5 gruen; (c) `test -f apps/web/dist/support/index.html` nach Build; `grep -c 'name="robots"' apps/web/dist/support/index.html` -> 0; `grep -o 'mailto:kontakt@sundartha.com' ...` >= 1.

### 2. Footer-Links auf `/support`
- `apps/web/src/layouts/Hermes.astro` Fussband (`legal`-Liste bzw. direkt vor dem Kontakt-Link, Z. ~94): `<a class="site-footer__link" href="/support">Support</a>`.
  Label "Support" ist in DE und EN gleich -> keine Uebersetzung noetig. Deckt alle Unterseiten (so-funktionierts,
  preise, registrieren, 404, kuendigen, datenschutz, impressum, agb, legal/[slug], support).
- `apps/web/src/pages/index.astro` Z. ~280 (site-footer, vor Contact) und Z. ~572 (menu-foot, mobiles Menue):
  derselbe Link, OHNE `data-i18n` (Label sprachneutral; der DE-Umschalter tauscht nur Elemente mit Key).
  `legal-pills` (Z. ~512) NICHT anfassen (dort nur Rechtsdokumente).
- `apps/web/src/layouts/Site.astro` NICHT anfassen (von keiner Seite mehr genutzt, `grep` belegt).
- Beweis: (b) Test "jede oeffentliche Seite verlinkt /support" (Schritt 5); (b) bestehender `links.test.js`
  "jeder interne href zeigt auf eine echte Route" bleibt gruen (faengt einen toten Link).

### 3. Sitemap
- `apps/web/public/sitemap.xml`: `<url><loc>https://sundartha.com/support</loc></url>` ergaenzen. `robots.txt` unveraendert (Allow /).
- Beweis: (c) `grep -c "https://sundartha.com/support<" apps/web/public/sitemap.xml` -> 1; Root-Test
  `NODE_ENV=test node --test test/legal-content.test.js` weiter gruen (prueft, dass keine /legal/-URL in der Sitemap steht).

### 4. HermesDemo ehrlich nachziehen (EN + DE an BEIDEN Orten)
Die Demo-Texte leben doppelt: `apps/web/src/components/HermesDemo.astro` (`DEMO.de`, `DEMO.en`) UND das
DE-Woerterbuch `apps/web/src/scripts/hermes-scroll.js:101-132` (Laufzeit-Umschalter der Startseite).
- `ev2v` (Z. 39 und 69, kein i18n-Key): `"prepare_call · place_call · list_calls · get_call_result"`
  (alle vier stehen im gemessenen stdio-tools/list und werden in `src/mcp-tools.js` unbedingt registriert).
- `toolName` (DE+EN) -> `"prepare_call"`; `hdToolcall` in hermes-scroll.js -> `<span class=\"hd-toolcall__fn\">prepare_call</span>(\"Praxis Dr. Behrens\")`.
  Grund: im Karten-Ablauf ruft die KI `prepare_call`; die Karte waehlt nach dem Klick selbst
  (`src/mcp-tools.js:914`, `:944`: "you never call place_call for that call").
- `aiMsg1` / `hdAiMsg1`: Bestaetigung sichtbar machen, z.B. EN "Sure — confirm the call in the Hermes card, then Hermes rings the practice."
  DE "Klar — bestätige den Anruf in der Hermes-Karte, dann ruft Hermes die Praxis an." (gesprochene/angezeigte DE-Strings mit Umlauten wie im Bestand).
- `aiMsg2` / `hdAiMsg2`: Kalender-Behauptung streichen (Hermes hat keinen Kalender mehr), z.B.
  EN "Done! Thursday, Aug 14 at 11:30 am with Dr. Behrens is booked." DE "Erledigt! Donnerstag, 14. Aug. um 11:30 bei Dr. Behrens ist gebucht."
- `r2v` bleibt (Zusammenfassung + Transkript im Kundenbereich ist belegt).
- Kopfkommentar `HermesDemo.astro:5-6` ("der Tool-Call (place_call)") nachziehen: "(prepare_call, Bestaetigung in der Hermes-Karte)".
- Keine Aenderung an Animation/CSS/`LOOP=76`/Struktur; nur Strings + Kommentar.
- IDs: vom Lead gepinnter Zusatz (Werkzeugnamen aus T2-11/T2-12/T2-13). Pfade: nur Website.
- Beweis: (c) `grep -rn "get_transcript\|get_my_number\|get_calendar" apps/web/src` -> 0 Zeilen;
  `grep -rn "Termin eingetragen\|added it to your calendar" apps/web/src` -> 0; (b) Test aus Schritt 5.

### 5. Tests in `apps/web/test/pages.test.js` (kein neuer Build, der bestehende `before` baut `dist-test`)
- `"support/index.html"` in `MARKETING_PAGES` und `EN_PAGES` aufnehmen (damit greifen: Chrome-Marker, kein Markenrot,
  lang=en, Cookie-Einwilligung, kein Analytics-Platzhalter). Testname "die beiden EN-Rand-Seiten" ehrlich anpassen.
- Neuer Test "Support-Seite: indexierbar, kanonisch, Kontakt aus dem Bestand, keine erfundenen Zusagen":
  kein `name="robots"`; `<link rel="canonical" href="https://sundartha.com/support"`; `mailto:kontakt@sundartha.com`;
  Links auf `/kuendigen` und auf jedes `legalFooterLinks(LEGAL_CONTENT,"en")`-Ziel; Negativ-Regex gegen
  `/24\/7|\bSLA\b|within \d+|business days|\+\d{2}[\s\d]{6,}/i` und gegen interne Kennungen
  `/\b(T2-\d+|OW-[A-Z]|O-\d+|N-\d+|H-\d+)\b/`; keine `src=`/`href=` auf fremde Hosts (erlaubt: `sundartha.com`,
  `app.sundartha.com` bzw. der Host aus `PUBLIC_GATEWAY_URL` des Testlaufs).
  Positiv-Kontrolle mitliefern: dieselbe Regex schlaegt an einem synthetischen String an (Muster `csp.test.js:125`).
- Neuer Test "jede oeffentliche Seite verlinkt /support im Fussband": fuer `PUBLIC_PAGES` `href="/support"` vorhanden.
- Neuer Test "Demo nennt nur heutige Werkzeuge": gebautes `index.html` und `so-funktionierts/index.html` enthalten
  `prepare_call`, KEIN `get_transcript|get_my_number|get_calendar`, KEIN "added it to your calendar"/"Termin eingetragen";
  dazu Quelltext `src/scripts/hermes-scroll.js` (fs lesen) ohne diese Namen/Saetze.
- Neuer Test "Sitemap enthaelt /support" (fs lesen `public/sitemap.xml`).
- Bestehende Tests, die brechen koennten: keiner nennt die alten Demo-Strings (grep in `apps/web/test` leer).
- Beweis: `npm --prefix apps/web test` -> `pass = 209 + neue`, `fail 0` (Zeilen `ℹ pass`/`ℹ fail` zaehlen, nicht der Exit-Code).

### 6. Gesamtpruefung (Bau-Agent faehrt selbst, Zahlen in den Bericht)
- `PUBLIC_GATEWAY_URL=https://app.sundartha.com npm --prefix apps/web run build` -> rc 0, "12 page(s) built".
- `npm --prefix apps/web test > <logs>/web-test.log 2>&1` -> pass/fail-Zeilen.
- `npx eslint apps/web/src/scripts/hermes-scroll.js apps/web/test/pages.test.js` -> 0 Befunde (`.astro` wird nicht gelintet;
  `eslint-legacy-exceptions.json` unveraendert, keine disable-Marker).
- `git diff --stat master -- . ':!apps/web'` -> LEER (Runbook-Leitplanke: auf dem Website-Weg NUR `apps/web/**`).
  Das ist zugleich der Beweis fuer "tools/list/initialize byte-gleich master": `src/` ist unberuehrt.
- Root: `NODE_ENV=test node --test test/legal-content.test.js` gruen. Ein voller `npm test -- -- --test-concurrency=4`
  ist optional (kein Root-Code geaendert); falls gefahren: Log komplett, nur `# pass`/`# fail`, rot nur wenn isoliert rot.
- Externe Hosts: `grep -oE '(src|href)="https?://[^"]+"' apps/web/dist/support/index.html | sort -u` -> nur sundartha.com-Hosts.
- CSP: `csp.test.js` gruen (kein Inline-Script, kein Event-Attribut); render.yaml-CSP unveraendert.
- Gestartete Prozesse (dev/preview) beenden, mit `ps` pruefen.

## Nicht bauen

- Kontaktformular, Telefon, Chat, Ticket-System: OpenAI verlangt es nicht; neue externe Quelle wuerde die CSP brechen; Scope-Regel.
- Reaktionszeit/SLA: kein Beleg, Pre-Mortem (a).
- Self-Service-Loeschung/-Export, Connector-Widerruf serverseitig: existiert nicht; Bau waere Backend-/Sicherheitsarbeit ausserhalb O-7.
- "Anruf abbrechen" auf der Seite: `cancel_call` hat bewusst Vorbehalte (Datensatz vs. Leitung) - auf einer Support-Seite nicht ehrlich kurz darstellbar.
- Rechtstexte (Impressum/Datenschutz/AGB, `src/data/legal/*`) und `kuendigen.astro`: Rechtstext = Owner; nur verlinkt.
- EN-Uebersetzung des Hermes.astro-Kopfs/Fussbands (heute deutsch, auch auf der EN-Seite `legal/[slug]`): Bestand, nicht O-7.
- `layouts/Site.astro`: ungenutzt.
- Demo-Rufnummer `ev1v` und Transkriptzeilen der Demo: nicht im Auftrag (nur Werkzeugnamen/Kalender/Bestaetigung).
- `docs/RUNBOOK-LAB-LIVE.md`-Korrekturen (Remote `origin` vs. `upstream`, Isolation): Datei liegt ausserhalb `apps/web/**`;
  wuerde die Leitplanke "nur apps/web" brechen. Als Widerspruch/Owner-Hinweis gefuehrt.
- `PLAN-SECURITY.md`: keine sicherheitsrelevante Aenderung.
- Push/Deploy/Labor-Pruefung: Owner.

## Pre-Mortem (ein Jahr spaeter war die Phase ein Fehler - was ist passiert?)

1. Die Seite nennt eine Antwortfrist oder "24/7", der Support schafft das nicht; OpenAI-Review oder ein Nutzer haelt es vor.
   -> keine Fristen; Negativ-Regex im Test.
2. Die Seite verspricht einen Loesch-/Export-Knopf, den es nicht gibt; Beschwerde bei der Aufsicht.
   -> Text folgt `privacy.de.json` ("kein Selbstbedienungs-Weg"), Beleg `api-read.js:110-119`.
3. "Connector entfernen" wird als "alles gestoppt" gelesen, ein laufender Anruf geht weiter, Kosten laufen.
   -> Pflicht-Vorbehalt (a) im Text; Anrufe bleiben durch Max-Dauer und Kostendecke begrenzt (Gates unangetastet).
4. Die Seite ist in Produktion `noindex` oder nicht erreichbar -> Support-URL in der Einreichung tot, Ablehnung.
   -> kein noindex-Prop; Test; Owner-Messung `curl -sI https://sundartha.com/support` nach Deploy (200, kein `X-Robots-Tag: noindex`).
5. Neue externe Ressource bricht die Live-CSP -> ungestylte/kaputte Seite.
   -> keine externen Hosts, kein Inline; csp.test + Host-grep; Labor spiegelt die Live-CSP.
6. Interne Kennungen/Produktionswerte landen oeffentlich -> Negativ-Regex; nur Bestands-Kontaktadresse.
7. Die Demo zeigt Waehlen ohne Bestaetigung -> Reviewer erwartet einen Ein-Schritt-Anruf. -> `prepare_call` + Bestaetigung im Text.
8. Der Owner pusht `master` nach `upstream`, um die Website live zu bringen, und deployt damit ungewollt 285 Backend-Commits
   (der Gateway-Build baut `apps/web` mit, render.yaml `buildCommand`, GAP-37 - kein Frontend-Filter).
   -> Owner-Anleitung bietet Weg A (nur Website, per Cherry-Pick auf `upstream/master`) und nennt die Backend-Folge ausdruecklich.
9. Sprachagent/MCP veraendert -> `git diff --stat master -- . ':!apps/web'` leer.

## Widersprueche

1. Plan T2-19 (und autonome Entscheidung P10b): Branch geht von `staging` ab und wird von der Kette NICHT auf master gemergt.
   Gepinnt (Lead): Branch von master, Lead merged lokal auf master. Gepinnt gilt. Das Labor wird dadurch nicht umgangen,
   weil die Kette nie pusht; der Owner-Weg unten fuehrt zwingend ueber das Labor.
2. Lead-Notiz: HermesDemo Z. 39/69 nennt `get_transcript/get_my_number`. Tatsaechlich: `get_transcript` und `get_calendar`
   (Plan korrekt); `get_my_number` kommt in `apps/web` nirgends vor.
3. `docs/RUNBOOK-LAB-LIVE.md` sagt `git push origin staging|master`. Gemessen: `origin` = Fork Antonio20045, `upstream` = jonas986;
   laut Projekt-Gedaechtnis deployt Render von `upstream`. Owner-Anleitung nutzt `upstream`, Owner bestaetigt.
4. Runbook: Gateway sei "konstruktiv isoliert". render.yaml `buildCommand` (Z. 22) baut `apps/web` im Gateway-Service mit,
   `buildFilter` filtert das Frontend bewusst NICHT (GAP-37, Z. 41-45) -> ein apps/web-Commit auf upstream master
   betrifft auch den Gateway (Deploy, falls dort autoDeploy an - Live-Stand ist dashboard-verwaltet, ungemessen).
5. `upstream/staging` liegt 363 Commits hinter `upstream/master`; apps/web unterscheidet sich staging vs. master in 33 Dateien.
   Zwischen `upstream/master` (live) und lokalem master ist `apps/web` identisch. -> Labor-Stand auf Basis `upstream/master` bauen, nicht auf dem alten staging.
6. Plan-Abnahme "npm run build in apps/web" laeuft ohne `PUBLIC_GATEWAY_URL` nicht (fail-closed) - Variable mitgeben.
7. Die Primaerquelle enthaelt zusaetzlich zur Checklisten-Zeile den Satz "Website, support, privacy, and terms URLs: Use public URLs
   that match the publisher and disclose relevant data handling." - fehlt in `00-openai-anforderungen.md`. Die Pflicht
   "support contact details" steht unter O-8 (app-guidelines), nicht O-7; O-8 ist nicht gepinnt, wird aber faktisch mit erfuellt.
8. Plan Ziel "wie man Daten loeschen laesst" setzt einen Weg voraus: es gibt ihn nur per E-Mail + Betreiber-Skript - die Seite sagt genau das.

## Owner-Punkte (nach OWNER-REGEL: Push/Deploy, Render-Dashboard, Rechtstext)

1. Labor (Weg A, nur Website, empfohlen solange die Backend-Kette nicht live gehen soll):
   `git fetch upstream && git checkout -b web-support upstream/master && git cherry-pick <T2-19-Commit(s) auf master>`
   (nur `apps/web/**`, `git show --stat` pruefen), dann `git push upstream web-support:staging` (Fast-Forward, da
   `upstream/staging` Vorfahre von `upstream/master` ist). Erwartet: Auto-Deploy `hermes-web-staging`;
   `https://hermes-web-staging.onrender.com/support` -> 200, Footer-Link "Support" auf Start- und Unterseiten,
   Browser-Konsole ohne CSP-Verstoss, Demo auf `/` zeigt `prepare_call` und die Bestaetigungszeile, mobil lesbar.
2. Live (bewusster Schritt): `git push upstream web-support:master` (Fast-Forward). HINWEIS: jeder Push auf
   `upstream master` kann den Gateway deployen (render.yaml Z. 22/41-45); ein Push des LOKALEN master nach upstream
   bringt zusaetzlich alle ~285 unveroeffentlichten Backend-Commits live. Danach `hermes-web` manuell deployen
   (Render-Dashboard -> Manual Deploy). Spaeteres Zusammenfuehren von lokalem master: der Cherry-Pick ist inhaltsgleich, Merge trivial.
   Weg B: Website erst mit der gesamten Kette live nehmen (Push master -> upstream, Backend-Deploy eingeschlossen).
3. Messung nach Live-Deploy: `curl -sI https://sundartha.com/support` -> `200`, KEIN `X-Robots-Tag: noindex`;
   `curl -s https://sundartha.com/support | grep -c 'name="robots"'` -> 0. Diese URL als Support-URL im OpenAI-Formular eintragen.
4. Publisher-Identitaet: die OpenAI-Verifikation (Name) muss zu "Sundartha"/Impressum passen; das Impressum traegt noch
   `[OFFEN: ...]`-Platzhalter (Rechtstext = Owner, s. OW-J).
