# Grounding-Bericht: eigene/private Nummer eines Tenants

Nur-Lese-Recherche, keine Aenderungen. Praemisse: Produkt noch nicht gelauncht, alle
aktiven Accounts gehoeren dem Owner-Team.

## 1. Bestehendes Feld: privateNumber / private_number

**Feldname je Backend:**
- Store-intern (beide Backends, Tenant-Record): `tenant.privateNumber` — `src/store/state-ops.js:2151-2163`
- json-Backend: kein eigener Spaltenname, liegt als `privateNumber`-Key direkt im Tenant-Objekt in `data/store.json` (via `state-ops.js`-Funktionen) — `src/store/json.js:1087-1088`
- pg-Backend: Spalte `tenant.private_number TEXT` — `src/db/schema.sql:76`; Mapping Spalte->Feld `src/store/pg.js:1036` (`if (r.private_number != null) tenant.privateNumber = r.private_number;`); Rueckschreiben `src/store/pg.js:1555` (`private_number=EXCLUDED.private_number`) und Bind `src/store/pg.js:1589` (`t.privateNumber ?? null`)
- Store-Fassade (server-weite Import-Quelle): re-exportiert `setPrivateNumber`/`tenantPrivateNumber` — `src/store.js:330-331`

**Default:** kein Wert (`undefined`/fehlender Key). Reader `tenantPrivateNumber` liefert dann `null`, nie `undefined` — `src/store/state-ops.js:2161-2163`. Leer/`""`/`null` beim Schreiben entfernt das Feld explizit (`delete tenant.privateNumber`), es liegt NIE ein leerer String at rest — `src/store/state-ops.js:2151`.

**Normalisierung beim Schreiben (E.164, ja):** `normalizePrivateNumber(raw, tenantCountryIso)` — `src/store/state-ops.js:2117-2133`. Reihenfolge verbindlich:
1. `normNum(raw)` — entfernt Whitespace/Bindestriche/Klammern (`src/store/defaults.js:667`)
2. E.164-Format-Check gegen `E164 = /^\+[1-9]\d{6,14}$/` (`src/store/defaults.js:672`) — sonst `throw`
3. Denylist-Check `isDenied(e164)` (Notruf-Kurzwahlen + Premium/IRSF-Praefixe, `src/telephony/number-denylist.js`) — sonst `throw`
4. Laendercode-Gate `countryAllowed(e164, allowedPrivateNumberCodes(tenantCountryIso))` — Allowlist, hergeleitet aus dem Tenant-Land (`src/store/defaults.js:860-899`); unbekanntes Land -> strenger Default `["+49"]` — sonst `throw`

Dieselbe Funktion bedient BEIDE Schreibwege (Onboarding + Self-Service), kein Drift (G5-Kommentar `src/store/state-ops.js:2117-2120`).

**Alle Leser von `store.tenantPrivateNumber(tenantId)` (verifiziert per grep, 6 Fundstellen):**
1. `src/self-service-routes.js:324` — Dashboard-Lese-View, NUR maskiert (`maskPrivateNumber`, zeigt Laendercode + letzte 4 Ziffern)
2. `src/self-service-routes.js:412` — Existenz-Check nach dem Schreiben (`stored = ... != null`) fuers Audit-Outcome (`set`/`cleared`), NIE der Wert selbst
3. `src/telephony/outbound-gates.js:592` — Kandidat fuer `homeCountryCode(...)` im `normalize_target`-Gate (s. Abschnitt 4)
4. `src/routes/api-calls.js:196` — `ownNumber` fuer `diagnosticRetentionGranted(...)` (s. Abschnitt 4, bestaetigt)
5. `src/sms-summary.js:26` — Versandziel der Anruf-Zusammenfassungs-SMS nach einem Inbound-Call; kein Ziel -> `reason: "no_private_number"` (`src/sms-summary.js:37`)
6. `src/store/state-ops.js` selbst (Definition/Erasure, kein externer Leser)

Kein weiterer Leser gefunden (grep ueber `src/` und `apps/web/`). Insbesondere: `mail-summary.js`/Newsletter-Pfad liest NICHT `tenantPrivateNumber` (eigene Achse: `tenantNewsletterConsent`/`confirmedNewsletterRecipients`, PII-getrennt, `src/mail-summary.js:56-66`).

**Bewusst NICHT in `settings`/`tenantContext`:** Kommentar an mehreren Stellen (`src/self-service-routes.js:325-326`, `src/self-service.js:37`) begruendet H4 — `settings` leakt komplett ueber `/api/state` + MCP, PII gehoert dort nicht rein. Die private Nummer lebt ausschliesslich am Tenant-Record ueber die dedizierten Setter/Reader.

## 2. Schreibwege

Zwei Routen, EINE gemeinsame Validierungs-Quelle (`normalizePrivateNumber`), kein dritter Weg (Env/Bootstrap-Script sind explizit ausgeschlossen, s. `src/config.js:1243-1246`: "ownerName/privateNumber setzt der Tenant ueber Self-Service", kein `OWNER_NUMBER` mehr).

**a) Self-Service (Dashboard, der normale Weg fuer einen bestehenden Tenant):**
- Route: `POST /api/self-service/private-number` — `src/self-service-routes.js:401-414`
- Auth-Kette: `webAuthMw` (Browser-OIDC-Session, `req.tenant.tenantId` aus der Session — nie ein fremder Tenant, H3) — `src/self-service-routes.js:401`; Datei-Header bestaetigt "web-session-only ... webAuthMw setzt req.tenant" (`src/self-service-routes.js:1-4`)
- Validierung: `store.setPrivateNumber(tenant, privateNumber)` -> intern `normalizePrivateNumber` (E.164 + Denylist + Laendergate); Fehler -> `400 {error:"invalid_private_number"}`, alter Wert bleibt unangetastet (fail-closed, wirft VOR jeder Mutation) — `src/self-service-routes.js:403-411`
- Response/Audit tragen NIE den Wert, nur `outcome=set|cleared|rejected` — `src/self-service-routes.js:412-413`
- Frontend: `apps/web/src/lib/api.js:704-709` (`savePrivateNumber`, POST same-origin, kein `Authorization`-Header, Cookie autorisiert), UI-Komponente `apps/web/src/components/app/SettingsIsland.astro`, Lese-Statuszeile nur ueber die Maske (`apps/web/src/lib/api.js:678-694`)

**b) Onboarding (Operator-Pfad, Tenant-Anlage):**
- Route: `POST /api/onboard` — `src/routes/api-onboard.js:88-98`
- Auth-Kette: laut Datei-Kommentar `operator.post` = `webAuthMw` + `adminMw` (`src/routes/api-onboard.js:76-78`: "Hinter einer Admin-Sitzung (webAuthMw+adminMw, AUTH-P6); ohne diese Sicherung gar nicht gemountet") — also Admin-only, nicht der normale Kunden-Weg
- Validierung: `normalizePrivateNumber(privateNumber, country)` VOR dem Store-Lock, damit ungueltige Eingabe als `400` statt `503` zurueckkommt — `src/routes/api-onboard.js:150-163`; im Store-Lock dann `registerTenant(..., privateNumber, ...)` -> `setPrivateNumber`-Logik set-if-absent bei bestehendem Tenant — `src/store/state-ops.js:1750-1773`
- `privateNumber` ist hier optional; fehlt sie, laeuft Onboarding normal weiter (Kommentar `src/routes/api-onboard.js:141-145`)

Kein dritter Schreibweg gefunden (kein Admin-`/api/settings`, kein CLI-Script, kein Env-Seed fuer `privateNumber` — im Unterschied zur Absende-/Routing-Nummer `OWNER_NUMBER_SEED`, die etwas ANDERES ist, s. `src/config.js:1249-1254`, "NICHT der frueher private OWNER_NUMBER-SMS-Empfaenger, D1: keine Konflation").

## 3. Verifikation: gehoert die Nummer dem Tenant?

**Befund: Es existiert KEINE Mechanik, die belegt, dass die eingetragene Nummer dem Tenant tatsaechlich gehoert.** Kein SMS-Bestaetigungscode, kein Rueckruf-Verfahren, kein OTP, keine Verknuepfung mit dem KYC-Datensatz. Grep ueber "verif"/"code"/"sms" im Kontext von `private-number`/`privateNumber` liefert keinen Treffer ausser dem Wort "verifiziert" in Kommentaren.

Das Wort **"verifiziert"** taucht an genau den Stellen auf, die den Kettenstand offenbar zitiert:
- `src/diagnostic-retention.js:44-45`: *"ownNumber - die eigene verifizierte Nummer des Tenants (store.tenantPrivateNumber; beim Setzen ueber setPrivateNumber E.164- UND land-validiert)."*
- `src/telephony/outbound-gates.js` (Verifikations-Gate-Kommentar, `src/telephony/outbound-gates.js:279-289`) bezieht sich auf ein GANZ ANDERES Gate: ob der Tenant ueberhaupt Outbound darf (Admin-Override / aktiver KYC-Subscriber), NICHT ob eine konkrete Zielnummer ihm gehoert.

**Das ist Wortwahl, kein Beleg.** "Verifiziert" bezieht sich in `diagnostic-retention.js` ausschliesslich auf Format-/Land-Validierung (E.164-Regex + Denylist + Laendercode-Allowlist), NICHT auf Eigentumsnachweis der Nummer. Ein Tenant kann heute jede beliebige E.164-Nummer aus einem erlaubten Land eintragen — inklusive einer fremden Nummer — ohne dass irgendein Mechanismus das zurueckweist.

**Was an Verifikations-Mechanik im Repo TATSAECHLICH existiert (fuer anderen Zweck, nicht Nummer-Eigentum):**
- `activation.js` (`src/billing/activation.js:1-40`) — hebt bei Abo-Bezahlung `kycLevel` auf `card`, aktiviert den Tenant-Status, stoesst Nummern-Provisioning an. Das ist Identitaets-/Zahlungs-KYC (Stripe-Karte), nichts mit der privaten Zielnummer verknuepft.
- `outbound-gates.js` KYC-Gate (`src/telephony/outbound-gates.js:271-278`) — prueft `store.kycReached(tenantId, KYC_OUTBOUND_MIN)`, fail-closed bei fehlendem `kycLevel`. Wieder: Tenant-Berechtigung fuers Telefonieren generell, kein Bezug zur konkreten Nummer.
- `state-ops.js` `KYC_ORDER`/`kycReached`/`tenantActiveSubscriber` (`src/store/state-ops.js:1807-1833`) — dieselbe Achse (Abo+KYC als Outbound-Permit), keine Nummer-Eigentums-Pruefung.

**Wiederverwendbar fuer eine echte Verifikation waere:** die vorhandene E.164-Normalisierung/Land-Gate als Vorstufe (Format muss stimmen, bevor man ueberhaupt eine SMS verschickt), und der bestehende SMS-Versandpfad (`src/sms-summary.js`, nutzt bereits `findActiveNumber` als Absender + Tages-Cap gegen Toll-Fraud) als Transportmechanismus fuer einen zukuenftigen OTP-Code. Beides existiert nur als Baustein, nicht als fertige Verifikation.

## 4. Normalisierung des Anrufziels

**Normalisierungsstelle:** Gate `normalize_target` in der Outbound-Gate-Kette — `src/telephony/outbound-gates.js:576-593`:

```js
{
  name: "normalize_target",
  run(ctx) {
    const homeCountry = homeCountryCode(
      [store.tenantPrivateNumber(ctx.tenantId), findActiveNumber(store.load(), ctx.tenantId)?.e164],
      store.tenantGeo(ctx.tenantId).country,
    );
    ctx.to = normalizeDialTarget(ctx.to, homeCountry);
    return null;
  },
},
```

`privateNumber` ist hier **Kandidat Nr. 1** (vor der aktiven DID) fuer die Herleitung des "Heimatlands" einer nationalen Schreibweise (fuehrende `0`) — Kommentar: "private Mobilnummer als 'SIM' vor eigener DID" (`src/telephony/outbound-gates.js:576-578`). Sie bestimmt NICHT das Call-Ziel selbst, sondern nur, wie eine mehrdeutige nationale Nummer (z.B. "0151...") interpretiert wird. Rohes `to` kommt vorher aus `normNum(b.to)` in `src/routes/api-calls.js:156`.

`homeCountryCode`/`normalizeDialTarget` — `src/store/defaults.js:768-780` bzw. `:836ff`.

**Exakter E.164-Vergleich Ziel == privateNumber ist implementiert** — genau EINE Stelle, wortwoertlich (`src/diagnostic-retention.js:49-53`):

```js
export function diagnosticRetentionGranted({ requested, to, ownNumber, privacy }) {
  if (callerDeclined(requested)) return false;
  if (!diagnosticRetentionEnabled(privacy)) return false;
  return Boolean(ownNumber) && to === ownNumber;
}
```

Aufgerufen mit dem NORMALISIERTEN Ziel (`ctx.to` nach `normalize_target`) und `ownNumber: store.tenantPrivateNumber(ctx.tenantId)` — `src/routes/api-calls.js:190-196`. Strikte String-Gleichheit (`===`), kein Fuzzy-Match, kein Praefix-Vergleich. Kommentar bestaetigt die Bedeutung: "Ein Anruf an die eigene verifizierte Nummer IST ein Testanruf - beide Seiten der Leitung gehoeren demselben Tenant" (`src/diagnostic-retention.js:46-48`) — auch hier wieder das Wort "verifiziert" im Sinn von "format-/land-validiert", nicht "eigentumsgeprueft" (s. Abschnitt 3).

Kein zweiter `to === privateNumber`-Vergleich im Repo gefunden.

## 5. Risiko-Kontext: verlaesslicher Schreibweg

- pg-Store haelt Zustand **im Speicher** (Spiegel), hydriert einmalig bei `init()`, jede Mutation laeuft synchron gegen den Spiegel und stoesst danach einen DB-Flush an — `src/store/pg.js:1-13` (Kopf-Kommentar), `requireState()`/`hydrate()` — `src/store/pg.js:61-77`.
- **Folge (aus Lesson `pg-store-holds-state-in-memory`, durch aktuellen Code bestaetigt):** ein direkter `UPDATE` per `psql` an der laufenden Instanz vorbei ist fuer den Prozess unsichtbar UND kann vom naechsten `save()`-Flush aus dem In-Memory-Spiegel wieder ueberschrieben werden — genau das ist einem frueheren Direkt-Write der `private_number` passiert.
- **Verlaesslicher Schreibweg ist ausschliesslich einer der beiden Abschnitt-2-Wege ueber die laufende Anwendung** (`POST /api/self-service/private-number` als Kunde, oder `POST /api/onboard` als Admin) — beide gehen durch `setPrivateNumber` -> Spiegel-Mutation -> `save()`/Flush, bleiben also mit dem In-Memory-Zustand synchron. Ein Direkt-Write in die DB ist NUR dann sicher, wenn unmittelbar danach der Prozess neu gestartet wird (re-hydriert den Spiegel aus der DB) UND per Gegenprobe (erneuter Read ueber die Anwendung) bestaetigt wird, dass der Wert ueberlebt hat — sonst gilt die Aenderung als nicht verlaesslich gesetzt.
- Zusatz-Risiko bei Direkt-Writes: sie umgehen den Audit-Pfad (`audit("self_service_private_number", ...)`) vollstaendig — keine Nachvollziehbarkeit, wer/wann die PII geaendert hat.

## Kernaussagen fuer den Planer

- Das Feld heisst durchgaengig `privateNumber` (App-Ebene) / `private_number` (pg-Spalte), lebt am Tenant-Record, NIE in `settings` (H4-Begruendung mehrfach im Code).
- Schreiben geht NUR ueber zwei validierte Pfade: `POST /api/self-service/private-number` (Kunde, `webAuthMw`) und `POST /api/onboard` (Admin, `webAuthMw`+`adminMw`) — beide teilen `normalizePrivateNumber` (E.164 + Denylist + Land-Allowlist), kein dritter Weg, kein Env-Seed.
- **"Verifiziert" im Bestandscode heisst Format-/Land-validiert, NICHT Eigentums-verifiziert.** Es existiert keinerlei Mechanik (SMS-Code, Rueckruf, KYC-Verknuepfung), die belegt, dass die eingetragene Nummer wirklich dem Tenant gehoert — ein Tenant kann heute jede beliebige zulaessige Nummer eintragen.
- Der einzige exakte `to === privateNumber`-Vergleich im Repo ist `diagnosticRetentionGranted` (`src/diagnostic-retention.js:52`) — String-Gleichheit gegen das bereits normalisierte Call-Ziel; nirgends sonst verwendet.
- `privateNumber` hat 6 Leser: maskierte Dashboard-Anzeige, Audit-Outcome-Check, `normalize_target`-Heimatland-Kandidat, `diagnosticRetentionGranted`, SMS-Summary-Ziel, sowie die Store-internen Setter/Reader selbst.
- Existierende KYC-/Abo-Verifikationsmechanik (`activation.js`, `outbound-gates.js` KYC-Gate, `tenantActiveSubscriber`) betrifft die Berechtigung des TENANTS zum Telefonieren generell (Zahlung/Identitaet), nicht die Zuordnung einer konkreten Zielnummer — waere aber als Baustein (Format-Gate, SMS-Versandpfad mit Tages-Cap) fuer eine kuenftige Nummer-Verifikation wiederverwendbar.
- Die nationale-Nummer-Normalisierung (`normalize_target`-Gate) nutzt `privateNumber` als bevorzugten Kandidaten fuers Heimatland VOR der aktiven DID — bei fehlender `privateNumber` faellt sie auf die DID zurueck (mit NANP-Guard gegen falsches Heimatland).
- pg-Store haelt Zustand im Speicher: ein Direkt-Write in die DB ist unsichtbar fuer den laufenden Prozess und kann vom naechsten Flush ueberschrieben werden — geschehen mit `private_number` in der Vergangenheit. Verlaesslich ist NUR der Schreibweg ueber die Anwendung selbst (Abschnitt 2); ein Direkt-Write braucht zwingend Neustart + Gegenprobe.
- Kein OWNER_NUMBER-Env-Fallback mehr fuer `privateNumber` (P2b-Cutover) — zu unterscheiden von `OWNER_NUMBER_SEED`, das die AKTIVE (Absende-)Nummer des Owner-Tenants seedet, nicht die private Summary-Zielnummer (`src/config.js:1249-1254`).
- Alle Werte verlassen den Server NIE im Klartext an die UI — `maskPrivateNumber` zeigt nur Laendercode + letzte 4 Ziffern (`src/self-service-routes.js:80-82`); Audit-Logs tragen nur `outcome=set|cleared|rejected`, nie den Wert.
