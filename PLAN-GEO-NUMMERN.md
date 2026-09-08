# PLAN-GEO-NUMMERN

Geo-Rufnummern: zahlende User aus GB bekommen eine GB-Nummer, aus FR eine FR-Nummer usw. --
fuer die Laender, die Telnyx reguliert. Das Dokument beantworte voerstehend die drei
Kernfragen des Owners: Was genau passiert waehrend der Telnyx-Verifikationszeit? Kriegt der
User eine provisorische US-Nummer? Wie und wann wird gewechselt, was passiert mit der
Interims-Nummer und ihren Gespraechsdaten?

Status: Entwurf (Strategie), kein implementierter Stand. Alle Telnyx-Aussagen tragen ihre
Quelle; Unsicherheiten sind als UNBESTAETIGT markiert. Die Owner-Entscheidungen aus 10. sind
am 2026-09-01 gefaellt und je Eintrag dort dokumentiert (inkl. Render-Verifikation zu 10.7);
offen bleiben die G0-Klaerungen (10.8, 10.9, G0-(d) zu 10.12) und die rechtliche Abnahme
zu 10.1.

## 1. Ziel & Nicht-Ziele

Ziel:

- Landeskriegerische Nummern ("local"/geo DIDs) fuer die wichtigsten Ziellaender statt der
  heutigen globalen US-Nummer (FORCE_NUMBER_COUNTRY=US): GB-User -> GB-Nummer, FR-User ->
  FR-Nummer.
- Klarer Ablauf fuer die Verifikationszeit: Der User ist ab Zahlung nutzbar, die
  Laendernummer entsteht nebenher, der Wechsel ist ein definierter, beobachtbarer Vorgang.
- Kleinste funktionsfaehige Loesung (kein BDUF), aber Seams richtig gesetzt: Verifikation,
  Nummern-Rolle (interim/permanent) und Swap sind eigene Konzepte im Store, nicht
  Spezialfaelle im Provisioning-Worker.

Nicht-Ziele:

- Mobile-Nummern in Laendern, die Telnyx dafuer gar nicht anbietet (DE, FR, ES, CH) --
  siehe Laender-Matrix.
- Porting bestehender Nummern (eigene Telnyx-Requirements je Land, hier nicht betrachtet).
- Eine eigene KYC-Identitaetspruefung des Users durch uns (Onfido & Co.). Wir reichen
  Dokumente an Telnyx durch; die Pruefung macht Telnyx Number Ops (Ausnahme siehe 10.).
- Automatischer Nummern-Tausch gegen den Willen des Users (der User entscheidet das Land,
  die Kette ist praezedent: User-Wahl > IP-Geo-Vorschlag, siehe 2.).
- 10DLC/SMS-Regulatorik der US-Nummer (separates Gate, nicht Teil der DID-Regulatorik).

## 2. Ist-Zustand im Code

Onboarding-Kette heute:

- POST /api/onboard (admin-gated, Operator) baut im withStoreLock registerTenant ->
  setTenantGeo -> requestNumber, dann queueProvisioning mit fire-and-forget Drain
  (src/routes/api-onboard.js:93-244). Der Stripe-Aktivierungspfad laeuft ueber
  triggerTenantProvisioning (src/billing/provision-trigger.js:40-48).
- Land-Praezedenz: resolveOnboardCountry = User-Wahl (autoritativ) > IP-Geo-Vorschlag
  (nur GEO_ENABLED) > PROVISIONING_COUNTRY > Default DE (src/geo/resolve.js:22-26,
  src/routes/api-onboard.js:137-142). Das Kauf-Land ist davon entkoppelt:
  FORCE_NUMBER_COUNTRY greift an genau drei Stellen (Operator-Onboard, Webhook-/Retry-Pfad,
  Anzeige-Formel im Self-Service; src/routes/api-onboard.js:151,
  src/self-service-routes.js:118-123) und ueberschreibt das Kauf-Land global. Config:
  src/config.js:1596-1725.
- requestNumber legt den Number-Record als {id, e164:null, tenantId, provider, country,
  language, status:'requested', providerNumberId:null, paymentIntentId:null} an
  (src/store/state-ops.js:2513-2546). monthlyCostCents setzt erst activateNumber.
- Lifecycle: NUMBER_STATUS requested/provisioning/capturing/active/failed/suspended/released
  mit fail-closed Transitionstabelle (src/store/defaults.js:72-99). DB: number-Tabelle mit
  nullable UNIQUE e164, country, language, monthly_cost_cents (src/db/schema.sql:672-713);
  provisioning_job-Spur idempotent ueber idempotencyKey (src/db/schema.sql:817,
  src/store/state-ops.js:2896-2921).
- Kauf: Orchestrator queueProvisioning/runProvisioningDrainExclusive (single-flight)
  (src/worker/provisioning-orchestrator.js:41-269), Worker kauft nur bei
  status==='requested' (src/worker/provisioning.js:16-25); Geld-Invarianten in
  provisionNumber: Karten-Gate -> Preis-Suche (10 Kandidaten, read-only) -> Hold in Hoehe
  des Provider-Preises -> orderNumber mit Idempotenz-Key -> Capture -> activateNumber;
  Capture-Fehler rollt mit Provider-Release zurueck (src/onboarding.js:79-177).
- Telnyx-Adapter: searchNumbers mit filter[country_code]/[features][]=voice/
  [phone_number_type], orderNumber setzt connection_id + Idempotenz-Key und lost die
  Ressourcen-id per gedeckeltem Poll (8x1s), releaseNumber = DELETE
  (src/telephony/adapters/telnyx/numbers.js:44-122).
- Laender-Tabelle COUNTRY_SEARCH_PARAMS traegt AT,AU,CA,CH,ES,FR,GB,IE,IT,US -- alle
  Eintraege leer, Nummernart immer 'local' (src/telephony/provisioning-geo.js:43-127).
  Der Drain leitet Suchparameter und Hold pro Job aus number.country ab
  (src/worker/provisioning-orchestrator.js:171-188).
- Gates: MAX_NUMBERS (Default 5) und MAX_NUMBERS_PER_TENANT (Default 1) geprueft in
  requestNumber (src/config.js:1580-1612, src/store/state-ops.js:2527-2532);
  PROVISIONING_ENABLED=false ist Dry-Run. Kostendecke sperrt beide Richtungen
  (src/store/defaults.js:145-147, src/store/state-ops.js:4086-4110).
- Hermes-KYC: ranggeordnetes tenant.kycLevel none<otp<card<id_verified,
  KYC_OUTBOUND_MIN=card, fail-closed geprueft (src/store/defaults.js:478-493,
  src/store/state-ops.js:2056-2077, Pruefstellen src/telephony/outbound-gates.js:348-396).
  Gesetzt wird es heute NUR durch activatePaidTenant (Abo-Zahlung = card,
  src/billing/activation.js:86-105) und seedBootstrapKyc (Owner = id_verified,
  src/store/state-ops.js:2042-2047). Ein Dokumenten-/id_verified-Flow existiert nicht.
- Fuer mehrtaegige Async-Prozesse existieren Muster: persistente Job-Spur mit Alters-Gate
  (PROVISIONING_REDRIVE_MAX_AGE_MS, Default Observe-Only), Boot-Reconciler mit
  close/hold/redrive, stuendlicher runSweepTick mit sieben .catch-isolierten Zweigen,
  withStoreLock als Single-Writer (src/store/state-ops.js:2939-2944, src/boot.js:1036-1074,
  1218-1221, 1273, src/store.js:393-427).
- Self-Service hinter webAuthMw hat PII-Andockmuster: /api/self-service/private-number und
  newsletter-consent (src/self-service-routes.js:251-455); Landwechsel im Self-Service ist
  bewusst gesperrt (409 country_change_unsupported).

Luecken fuer dieses Vorhaben: kein Verifikations-/Dokumenten-Flow (weder Store noch Route),
kein Nummern-Concept "Interims-Nummer", kein Webhook-/Polling-Pfad fuer mehrtaegige Telnyx-
pending-Orders (der Adapter pollt nur Sekunden auf die Ressourcen-id, nicht auf die
regulatorische Freigabe), Capture feuert unmittelbar nach Order-Erfolg.

## 3. Telnyx-Regulatorik: Mechanik

Anforderungserkundung und Ressourcen:

- GET /v2/requirements mit filter[country_code] (ISO 3166-1 alpha-2),
  filter[phone_number_type], filter[action] (ordering/porting/branded_calling). Antwort mit
  record_types 'requirement' (Parent fuer Land+Nummernart+Aktion) und 'requirement_type'
  (konkretes Erfordernis); Details inkl. acceptance_criteria unter
  GET /v2/requirement_types/{id}
  (https://developers.telnyx.com/docs/numbers/phone-numbers/regulatory-requirements).
- Jeder requirement_type hat eine von vier Klassen: textual (freier String), address (ID
  einer per POST /v2/addresses erstellten Adresse, nie ein String), document (ID einer per
  POST /v2/documents hochgeladenen Datei), action (selten; externe Verifikation, z.B.
  AU-Mobile via Onfido) -- ebenda.
- Documents: Upload base64 im Feld 'file'+'filename' oder multipart, max 20 MB,
  PDF/PNG/JPEG/CSV/TXT/JSON/Office (https://developers.telnyx.com/docs/numbers/phone-numbers/documents).

Requirement Groups und Orders:

- Eine Gruppe befuelle alle Werte fuer genau country_code+phone_number_type+action:
  POST /v2/requirement_groups, Werte per PATCH .../{id}, optional
  POST .../{id}/submit_for_approval fuer Pre-Approval
  (https://developers.telnyx.com/docs/numbers/phone-numbers/requirement-groups).
- Reihenfolge geht beides: Order zuerst und Werte/Gruppe am haengenden sub_number_order
  nachreichen (PATCH /v2/sub_number_orders/{id} bzw. POST .../requirement_group), oder
  fulfilled/pre-approved Gruppe bei der Bestellung als requirement_group_id mitgeben
  (https://developers.telnyx.com/docs/numbers/phone-numbers/number-orders + .../requirement-groups).
- Die Nummer wird VOR der regulatorischen Freigabe gekauft: Order erfolgreich, aber
  Inbound "will not be activated until documentation has been uploaded and verified"; der
  Order bleibt pending bis alle Requirements einzeln approved sind
  (https://support.telnyx.com/en/articles/5469551-international-numbers-required-documents).
  Pending-Nummern koennen KEINE Anrufe empfangen -- das ist der Kern der Interims-Frage.
- Ohne Regulatorik (US/CA) aktiviert der Order "momentarily with no further user action";
  Fortschritt laesst sich an requirements_met ablesen (ebenda +
  https://developers.telnyx.com/docs/numbers/phone-numbers/number-orders).

Statusmodelle (alle belegt ueber spec3.json/OpenAPI + Doku, siehe Quellen):

- Dokument: pending / verified / denied; unabhaengig av_scan_status
  (pending_scan/scanned/infected/not_scanned; infected = Ablehnung).
- Gruppe: unapproved / pending-approval / approved / declined / expired /
  no-longer-eligible. Approved-Gruppen aktivieren Orders "automatically within a few
  minutes". Gruppen sind fuer Wiederverwendung ueber mehrere Orders gebaut (gleiches
  Land+Typ+Aktion); Pflicht bei Orders in CH, DK, IT, NO, PT, SE; Pre-Approval nicht in
  allen Laendern (IT liefert einen Fehler).
- Order: pending / success / failure / cancelled / deleted; waehrend pending zeigt der
  Phone-Number-Status den Vettings-Fortschritt: requirement-info-pending,
  requirement-info-under-review, requirement-info-exception (abgelehnt, korrigieren und
  neu einreichen), approved.
- Einzelne Requirements tragen selbst Status + expires_at; bereits approved Requirements
  bleiben bei Nachreichen unveraendert.
- Jeder Order hat eine deadline: Bis dahin muessen alle Requirements erfuellt sein, sonst
  auto-cancelt der Order; nach Ablehnung wird eine neue Deadline gesetzt, Verlaengerung
  nur per Kommentar. Ablehnungsgruende kommen ueber die Comments-API (GET/POST /v2/comments).
  Die Laenge der Deadline ist nicht dokumentiert (UNBESTAETIGT; Mechanik bestaetigt in llms-full-txt "Deadline + Auto Cancellation", Recherche 2026-09-01).

Webhooks und Dauer:

- Dokumentiert ist Event 'number_order.complete' (Number Order Status Update Webhook,
  Payload mit phone_numbers[].status und requirements_met); aktivierbar ueber Notification
  Setting "Number Order Notifications", dort sind fuer "When a Number Order Completes"
  derzeit NUR Webhooks moeglich, kein Email
  (https://developers.telnyx.com/data/webhook-events.json,
  https://support.telnyx.com/en/articles/4277896-notification-settings).
- Fuer Requirement Groups existiert die Notification-Setting "Requirement Group Status
  Change"; der exakte event_type-String ist im oeffentlichen Event-Katalog nicht
  verzeichnet (UNBESTAETIGT, klaeren per Produktiv-Account/Support). NACHTRAG Recherche
  2026-09-01: weder der Event-Katalog (94 Events, einziger Nummern-Webhook:
  number_order.complete) noch die OpenAPI spezifizieren ein Requirement-Group-Event; der
  Artikel 4277896 nennt die Setting heute nicht mehr. Live-Check Produktiv-Account
  2026-09-01: /v2/notification_events listet "Requirement Group Status Change" -- das
  Event EXISTIERT; nur der exakte Webhook-String bleibt empirisch. Polling bleibt der
  primaere Weg.
- Fuer Dokumentenstatus-Aenderungen ist KEIN Webhook dokumentiert -- dort Polling ueber
  GET /v2/documents bzw. GET /v2/document_links (UNBESTAETIGT ob doch Events existieren;
  Recherche 2026-09-01: Katalog und OpenAPI enthalten keine Dokumenten-Events -- der
  Marker gilt nur noch fuer undokumentierte Kanaele, der Polling-Pfad ist Stand der
  Erkenntnis).
- Dauer: Standard-Review "can take time"; konkret "The verification process can take a few
  working days" (Support-Artikel), die Laender-Artikel nennen durchgaengig "approximately
  72 hours" nach Dokumenteneingang. Mit approved Gruppe: Minuten.

Dokumenten-Verbleib (PII):

- Telnyx speichert Dokumente selbst; nicht innerhalb 30 Minuten an einen Service
  (Order/Requirement) verlinkte Dokumente werden automatisch geloescht; verlinkte erst
  nach Unlink loeschbar (https://developers.telnyx.com/docs/numbers/phone-numbers/documents).
  Wir muessen Dateien also nur transient durchreichen.
- ABER: Die country-specific T&C legt dem KUNDEN (uns als Plattform) die Pflicht auf,
  KYC-Unterlagen "securely for the retention period mandated locally" aufzubewahren und
  bei Anforderung herauszugeben
  (https://telnyx.com/country-specific-requirements-terms-and-conditions-of-service).
  Ob Telnyx-Speicherung diese Pflicht erfuellt, ist eine Owner-Entscheidung (siehe 10.).
- DSGVO-Basis (Pre-Mortem-Nachtrag): Telnyx verarbeitet die Dokumente fuer UNS -- wir sind
  der Telnyx-Kunde, der Enduser taucht bei Telnyx nicht auf (siehe Besteller-Rolle, 6./10.12).
  Vor dem ersten produktiven Upload noetig: geklaerte Rechtsgrundlage (Art. 6 DSGVO),
  Art.-13-Information an den User (seine Ausweiskopie und Utility Bill gehen an einen
  US-Anbieter, also Drittlandtransfer) und ein abgeschlossener AVV/DPA mit Telnyx inkl.
  Subprozessoren und Drittlandtransfer-Mechanismus. Telnyx stellt eine DPA bereit, die die
  EU-SCCs inkorporiert (https://telnyx.com/data-transfer-impact-assessment) -- deren
  Annahme/Annahme-Faehigkeit ist als G2-Start-Gate festgeschrieben (6.).
- Loeschkonzept fuer VERLINKTE Dokumente: Telnyx loescht verlinkte Dokumente erst nach
  Unlink. Der Plan braucht deshalb je Endzustand (Order auto-cancelled, Kuendigung,
  Store-Account-Loeschung, Art.-17-Antrag) einen definierten Unlink+Delete-Anstoss bei
  Telnyx, eine Aussage, was am Verifikations-Datensatz des Tenants verbleibt (Adress-/
  Dokument-IDs, Status-Historie) und wie lange, sowie eine Antwort-Regel fuer Art.-17-
  Antraege gegen die lokale Aufbewahrungspflicht aus den country-specific T&C (Sperre
  statt Loeschung unter Vorbehalt, Frist, Begruendung gegenueber dem User).

## 4. Laender-Matrix

Miete = "Monthly Recurring Cost" local laut https://telnyx.com/pricing.md; DID =
"Direct Inward"-Posten. Dauer ab Dokumenteneingang. "Praesenz" = Enduser muss beim Kauf
physisch im Land sein.

| Land | Regulatorik | Dokumente (local) | Eligibilitaet | Dauer | Miete |
|---|---|---|---|---|---|
| US | NEIN | keine ("Not required") | keine Einschraenkung | sofort | $1 (Volume ab $0.79); ein $50-Posten in pricing.md ist ein Vanity/Sonder-Rate-Center (UNBESTAETIGT) |
| CA | NEIN | keine | keine | sofort | $1 |
| GB | JA (KYC vor Aktivierung) | Name+Telefon, lokale Pass-/ID-Kopie, UK-Adresse + Utility Bill <3 Monate; Firma: UK-Registrierung, Website, Business Use Case | Praesenzpflicht; EU-Ausweis genuegt als "lokal" | ~72 h | $1 (DID $1); Mobile $2, Regulatorik wie local plus Sub-Allocation-Angabe |
| DE | JA | Name+Telefon, ID/Pass (EU genuegt), vollstaendig unterschriebenes deutsches Registrierungsformular, Adresse im Vorwahl-Gebiet + Utility Bill <3 Monate; Firma: Company-Registration; nur Scans | Praesenzpflicht | ~72 h | $1 (DID $0.75); Mobile nicht im Angebot |
| FR | JA | Name+Telefon, lokale ID/Pass, Adresse in FR + Adressnachweis <3 Monate | Praesenzpflicht | ~72 h | $1 (DID $0.50); Mobile nicht im Angebot |
| AT | JA | ID/Pass, Adresse passend zur Vorwahl + Nachweis <3 Monate | Praesenzpflicht | ~72 h | $2 (DID $0.75); Mobile nur Landes- statt Vorwahl-Match |
| CH | JA, NUR Geschaeftskunden | Vertreter-ID, Business-Registrierung plus -Nummer, Adresse im Vorwahl-Gebiet + Nachweis <3 Monate; Requirement Groups Pflicht | private Nutzung unzulaessig | (Artikel nennt keine eigene Frist) | $1 (DID $0.75); National/Mobile N/A |
| ES | JA | ID/Pass, DNI/NIE, Adresse passend zur Vorwahl + Nachweis <3 Monate; Firma: CIF | Praesenzpflicht | ~72 h | $1 (DID $1.50); Mobile nicht im Angebot |
| IT | JA, nach Kundentyp (Persona Fisica/Giuridica/Ditta) | Name+Geburtsdaten+Staatsangehoerigkeit, Personal Tax Code, ID vorne+hinten (nur PDF), IT-Adresse + Nachweis <3 Monate; Firma: Registrierung, VAT, Vertreter-Wohnsitz IT; Requirement Groups Pflicht | Praesenzpflicht | ~72 h ueblich, Artikel nennt keine Frist | $2 (DID $0.75) |
| IE | JA | Name+Telefon+E-Mail, ID/Pass, Adresse passend zur Vorwahl + Nachweis <3 Monate, Service-Usage-Beschreibung | Praesenzpflicht | ~72 h | $0.50 (DID $0.50); Mobile nur geschaeftlich |
| AU | JA (ACMA) | Name+Telefon (KEIN Ausweis fuer local), AU-Adresse + Nachweis <3 Monate | keine Praesenzpflicht genannt | ~72 h | $2; Mobile deutlich staerker reguliert (Rollen, Local ID Verification) |

Quellen je Zeile: die Telnyx-Support-Artikel der Collection "International DID Requirements"
(https://support.telnyx.com/en/collections/1511606-international-did-requirements, im
einzelnen siehe 11.) plus https://telnyx.com/pricing.md.

Muster: In DE/FR/AT/ES/GB/IT/IE muessen Enduser physisch im Land sein; EU-Buerger duerfen
einen Pass BELIEBIGES EU-Staats als "lokale" ID verwenden (belegt am GB-Artikel). Mobile
ist in DE/FR/CH/ES nicht bestellbar; DE-mobile: GEKLAERT 2026-09-01 am Produktiv-Account
(Suche phone_number_type=mobile -> Fehler 10015 "No coverage found") -- nicht bestellbar,
der Preisposten in pricing.md (MRC $0.75, OTC $1) ist ein Phantom.
LIVE-BESTAETIGT 2026-09-01 (/v2/requirements am Produktiv-Account): DE-local verlangt den
Adress-Typ "Address Matching the DID Area Code (Geographic Match)" -- Stadt/Region der
Adresse MUSS im Vorwahl-Gebiet der Nummer liegen ("Addresses outside the area code's
geographic region are not acceptable"), zusaetzlich das unterschriebene BNetzA-Formular
mit belegter "local relationship to the area code". Der im Requirementstext selbst
genannte Ausweg ("a different (broader, national-level) address requirement") existiert
als DE-national-Satz ohne Vorwahl-Bindung -- mit 0 Bestand. KONSEQUENZ: DE-local ist nur
mit Adresse im Vorwahl-Gebiet kaufbar, und der Telnyx-Bestand deckt viele Vorwahlen
nicht (Bsp. 2132 Meerbusch: leer; 211/2151/202/203/221/212: verfuegbar) -- DE ist fuer
Remote-User damit noch restriktiver als die Matrix ausdrueckt. GB (Pilotland) kennt die
Vorwahl-Falle NICHT: Adress-Typ ist NATIONAL ("The address does not need to match the
specific city or area code of the number; any address within the national borders is
acceptable"). GB fragt zusaetzlich die Sub-Allocation als PFLICHT-Requirement ab
("Business Use Case Description (with Sub-Allocation Disclosure)": Erklaerung, ob die
Nummer an einen Dritten sub-allokiert wird) -- Deklarationspflicht aus G0 (d) ist damit
ein Formfeld am Order, keine Grauzone. Porting-Anforderungen weichen ab
und sind hier nicht abgedeckt. Der Vendor darf jederzeit zusaetzliche Informationen
anfordern; Telnyx kann Dokumente ablehnen.

## 5. Zielbild: Zustandsmaschine Interims-Nummer -> Verifikation -> Swap

Antwort auf die Kernfrage "Was passiert in dieser Zeit?": In regulierten Laendern ist die
Nummer sofort kaufbar, aber Inbound aktiviert erst nach Verifikation ("a few working
days", meist ~72 h ab vollstaendigen Dokumenten). Der Tenant waere also Tage ohne
empfangsbereite Nummer. Deshalb Zielbild mit Interims-Nummer:

- Sofort nach Zahlung: US-Nummer kaufen und aktivieren (keine Regulatorik, Aktivierung
  "momentarily") -- identisch zum heutigen Ablauf, aber mit Rolle kind='interim' und
  targetCountry=GB am Number-Record. Damit ist der Tenant sofort voll nutzbar (Inbound auf
  US-Nummer, Outbound mit US-Caller-ID -- fuer GB-Zielgespraeche nicht ideal, aber
  funktional; Offenlegungs-/Outbound-Gates unveraendert). EINSCHRAENKUNG Herkunfts-Gate:
  "funktional" gilt nur, solange FORCE_NUMBER_COUNTRY gesetzt ist. numberOriginDecoupled ist
  exakt Boolean(provisioning.forceNumberCountry) und damit der einzige Schalter, der das
  Herkunfts-Gate offenhaelt (src/telephony/outbound-gates.js:143-144, 473-487;
  src/config.js:1715); countryForE164 liefert fuer +1 bewusst null, ein GB-Ziel unter
  US-Absender zaehlt als fremd -> 403 ("not registered in the destination country"), und der
  Boot-Guard meldet die Konstellation bei jedem Start. G4 will FORCE_NUMBER_COUNTRY fuer
  GB-User entfallen lassen -- ohne Ersatz verliert der GB-User auf der Interims-Nummer
  Inlandsanrufe. Owner-Entscheidung 10.15 VOR der Allowlist: Decoupling-Kriterium von
  FORCE_NUMBER_COUNTRY entkoppeln (eigenes Flag mit Begruendung + Boot-Guard-Anpassung,
  Beruehrung nach CLAUDE.md Regel 1, siehe 7c) oder ein anderes Interimskonzept.
  ENTSCHEIDEN 2026-09-01 (10.15): weder noch -- das Herkunfts-Gate selbst wird geloescht;
  dieser Absatz beschreibt den Zustand vor dieser Entscheidung.
- Parallel: Telnyx-Verifikations-Datensatz am Tenant fuehren (Adress-/Dokument-IDs,
  Requirement-Group-Status), Requirement Group fuer Land+local+orderingen befuellen, Order
  mit requirement_group_id anlegen. Order bleibt pending; unser Number-Record dafuer im
  neuen Status 'verifying' (Erweiterung der Transitionstabelle, fail-closed).
- Aktivierung: number_order.complete (Webhook) ODER stuendlicher Sweep-Poll erkennt
  success/approved -> GB-Nummer capturen und active; Calls auf die neue Nummer routen
  (Connection-Zuordnung passiert im Order, siehe Adapter). Praezisierung (Regel-Review):
  Genau EINE aktivierende Funktion unter withStoreLock; Webhook, Sweep-Poll und Boot-
  Reconciler duerfen nur anstossen (alle drei sind als Ausloeser geplant -- ohne diese
  Pflicht drohen Webhook-Wiederholung und Poll-Race Doppel-Capture bzw. konkurrierende
  Transitions). Capture je Order genau einmal (Idempotenz-Key je Order; Test: doppelter
  Webhook + gleichzeitiger Poll => genau ein Capture, eine Transition). Die G3/G4-Naht
  (G3 erkennt den Erfolg, die Aktivierungslogik liefert erst G4) muss diese Anforderung
  bereits in G3 formulieren, nicht erst in G4.
- Verifikation nach Kuendigung/Refund/Suspend (Fall fehlte im Entwurf): Der bestehende
  Cleanup erfasst nur AKTIVE Nummern SUSPENDIERTER Tenants -- numberReleaseVerdict skippt
  jede nicht-aktive Nummer mit not_active_<status> und fordert zusaetzlich tenantSuspendedAt;
  classifyNumbersForRelease und tenantNumbersForErase laufen ueber denselben Verdikt
  (src/store/state-ops.js:2999-3019, 3025, 3054). Ein 'verifying'-Order eines gekuendigten
  Tenants wird also von keinem Cleanup-Pfad beendet: Telnyx aktiviert evtl. trotzdem, der
  Capture feuerte auf das Zahlungsmittel eines Ex-Tenants (oder auf keins), alternativ
  bleibt die Nummer ungeschaeftet mit MRC beim Provider. Deshalb: Suspend/Kuendigung beendet
  den Verifikations-Order aktiv (Telnyx-Order canceln oder Nummer sofort nach Aktivierung
  releasen), die Capture-Entscheidung koppelt an ein aktives Abo, und es gibt einen
  observing hold-Korb fuer verifying-Nummern suspendierter Tenants (Sweep + Audit).
- Uebergangsfenster: Die Interims-Nummer bleibt fuer eine begrenzte Frist (Vorschlag:
  14 Tage) als 'grace' aktiv; auf ihr laeuft der Agent weiter, damit Anrufer der alten
  Nummer nicht ins Leere gehen. Was ein Anrufer NACH dem Release hoert, ist undokumentiert
  (UNBESTAETIGT; Recherche 2026-09-01: plausibel Standard-Carrier-Ansage "number not in
  service" und ~2 Wochen Telnyx-Hold, empirischer Test vor G4b bleibt offen) -- deshalb
  vorher im Gespraech/prompt-unterstuetzt auf die neue Nummer
  hinweisen.
- Release: Nach Ablauf des Fensters DELETE /v2/phone_numbers/{id} (releaseNumber,
  src/telephony/adapters/telnyx/numbers.js:44-122). MRC endet sofort; Telnyx haelt die
  Nummer bis zu 15 Tage rueckkaufbar (US ohne erneute Dokumente). CODE-BESTAND (Regel-Review):
  Der bestehende automatische Release-Pfad kann das NOCH nicht -- runReleaseReconcile/
  performNumberRelease released ausschliesslich Nummern SUSPENDIERTER Tenants
  (numberReleaseVerdict fordert tenantSuspendedAt, src/store/state-ops.js:2999-3019; der
  Live-Recheck in releaseCandidate verlangt zusaetzlich tenantInactive,
  src/release-reconcile.js:168-180); fuer einen AKTIVEN Tenant liefert der Verdikt SKIP
  tenant_not_suspended, einen zweiten Release-Aktor gibt es nicht. G4b braucht deshalb
  einen eigenen Swap-Release-Pfad: eigener Klassifikator nach dem Muster
  classifyNumbersForRelease fuer kind='grace' mit abgelaufener Frist, Wiederverwendung von
  performNumberRelease nur nach Entkoppeln des tenantInactive-Rechecks, eigener Recheck
  (numberBusyReason: ACTIVE_CALL/Plattform-Bindungen), pending-Marker nach dem
  Provider-DELETE VOR der Store-Mutation (Idempotenz gegen Crash zwischen beidem),
  Audit-Zeilen und Wiederholung bei Fehlversuch.
- Absenderwahl und Sprache im Swap-Fenster (Fall fehlte im Entwurf): Heute waehlt
  outboundFrom die ERSTE aktive Nummer des Tenants in Array-Reihenfolge
  (src/store/views.js:69-76, src/telephony/outbound-gates.js:461-466); der numberRecord
  dieser Nummer ist zugleich der Geo-Anker der Outbound-Gespraechssprache. Im Swap-Fenster
  sind zwei Nummern aktiv -- ohne Regel bliebe Outbound je nach Anlageordnung auf der
  US-Caller-ID mit US-Sprachanker, obwohl die GB-Nummer laengst aktiv ist. Verbindlich:
  kind='permanent' schlaegt kind='interim' bei der Absenderwahl (EINE Stelle:
  findActiveNumber/outboundFrom), Inbound bleibt auf beiden Nummern aktiv; das Umschalten
  von Caller-ID, Sprache und EL-Zuordnung (providerAgentPhoneNumberId je Nummer,
  registriereNummerFailSoft, src/onboarding.js:168-197) sind explizite Swap-Schritte mit
  Test im G4-Abnahmekriterium (Outbound mit GB-Caller-ID, waehrend die Interims-Nummer
  noch grace laeuft).
- Gespraechsdaten: Transkripte und Call-Records sind im Store an tenantId/call gebunden,
  nicht an den Fortbestand der Nummer; die alte e164 bleibt als historischer Verweis am
  Call-Record stehen und wird NICHT geloescht. Dashboard-/Store-Views mit
  "genau eine aktive Nummer"-Annahmen muessen fuer das Swap-Fenster angepasst werden.
- Dauer-Deckel Interims-Nummer: maximal 14 Tage ab Kauf (ENTSCHEIDEN 2026-09-01, 10.3;
  urspruenglicher Vorschlag 30 Tage). Bis dahin
  nicht abgeschlossene Verifikation -> Owner-Entscheidung im Phasenplan umgesetzt als
  explizite Entscheidung statt stiller Ewigkeit: (a) Verifikationsversuch beenden, US-Nummer
  wird permanent (kind hochstufen), oder (b) Frist verlaengern mit Begrundung. Default (a),
  damit keine unbegrenzte Interims-Bevoelkerung entsteht.

Zwei getrennte Zustaende, die nicht vermischt werden duerfen:

1. Hermes-KYC (kommerziell): tenant.kycLevel entscheidet am Outbound-Gate, ob der Tenant
   UEBERHAUPT telefonieren darf (Abo+Karte). Unberuehrt von diesem Plan; Kartenzahlung
   bleibt der Weg zu card (src/billing/activation.js:86-105).
2. Telnyx-Verifikation (regulatorisch): entscheidet, ob die LANDESNUMMER aktiviert wird.
   Eigener Datensatz, eigene Statusmaschine: unverified -> docs_requested -> submitted
   (Gruppe/Order pending) -> approved | declined | expired. declined mit Grund aus der
   Comments-API, Korrektur und Neu-Einreichung (requirement-info-exception-Pfad).
   Fuehrende Quelle (Regel-Review): Die Tenant-Statusmaschine ist AUTORITATIV; der
   Number-Record-Status 'verifying' ist rein abgeleitet aus Order-/Gruppen-Ereignissen.
   Kaskadierungsregel in G1 mitschreiben: ein Ereignis -> genau eine abgeleitete Transition
   (inkl. Wiederverwendung approveder Gruppen ueber mehrere Orders). Ohne diese Regel
   waeren es zwei Statusquellen fuer denselben Sachverhalt mit Synchronisationsdrift.

Zusammenspiel: Outbound mit der GB-Nummer braucht BEIDES -- aktive GB-Nummer (Telnyx
approved) UND Hermes-KYC card (Abo). Die US-Interims-Nummer unterliegt der selben
Hermes-KYC, aber keiner Telnyx-Verifikation. Von einer automatischen Herleitung
kycLevel=id_verified aus Telnyx-approved sehen wir ab (Vertrauenskette unterschiedlich,
siehe 10.).

Capture-Punkt: Heute feuert Capture unmittelbar nach Order-Erfolg
(src/onboarding.js:79-177). Bei mehrtaegigem pending duerfen wir nicht auf
Order-Quittung capturen, sondern erst bei Aktivierung -- das ist ein bewusster Eingriff in
die Geld-Invarianten (Details 6./7.; Stripe-Hold-Verfalltage GEKLAERT 2026-09-01:
Standard-Autorisierung 7 Tage, Extended Authorization bis ~30 Tage aktivierbar -- siehe
G0-Zwischenstand; der 14-Tage-Deckel braucht deshalb Extended Authorization oder einen
neu gestellten Hold je Retry).

Geld-Endzustaende je Verifikationsausgang (Regel-Review, vorher nur Capture-Fehler
betrachtet): Fuer JEDES Ende -- approved (Capture), declined, expired, no-longer-eligible,
Order-auto-cancel an der deadline, Abbruch durch den 14-Tage-Deckel (Entscheidung (a)) --
ist definiert, ob der noch offene Stripe-Hold released (cancel) oder gecaptured wird, ob
Teilmengen anfallen und wer die MRC eines toten Orders traegt (MRC-Verhalten aus G0).
Der existierende Rollback deckt nur Capture-FEHLER ab; die neuen End-Zustaende hatten im
Entwurf keine Geld-Abwicklung. Als Unit-Tests in G3/G4 festschreiben.

Capture-Versagen NACH Verifikation (umgekehrter Fall von Risiko 4): Telnyx hat approved,
settleSetupFeeHold scheitert erst jetzt (Autorisierung abgelaufen, Karte abgelehnt,
gekuendigt) -> rollbackAfterOrder setzt failNumber und fuehrt den Provider-Release aus
(src/onboarding.js:140-160, 284-340) -- die soeben verifizierte GB-Nummer ist sofort wieder
weg, der Genehmigungsfortschritt (approved Requirements/Gruppe) verfaellt mit ihr.
Geplant: Separierung von "Nummer aktivieren" und "Capture endgueltig gescheitert", Retry
mit NEU gestelltem Hold VOR jedem Release (Autorisierungen halten nicht beliebig lange;
Haltbarkeit UNBESTAETIGT, in G0 klaeren), Nachziehfrist fuer das Zahlungsmittel und
Nutzerkommunikation -- als G3-Abnahmekriterium.

## 6. Phasenplan

Jede Phase ist eigenstaendig wertvoll, merge-faehig und rueckgaengig machbar. Bewusst
klein halten: ein Pilotland zuerst (Vorschlag GB -- groesster nicht-deutschsprachiger
Zielmarkt, local $1/Monat; Alternative siehe 10.), alle weiteren Laender sind reine Daten-
pflege in COUNTRY_SEARCH_PARAMS, sobald der Flow steht.

- G0 Klaerung (kein Code): Mit dem PRODUKTIV-Telnyx-Account klaeren (Owner-Entscheidung
  2026-09-01: KEIN Produktiv-Account -- Begruendung und bewusst akzeptierte Konsequenzen am
  Ende des G0-Zwischenstands): event_type-String der
  Requirement-Group-Webhooks, ob Dokumenten-Events existieren, Laenge der Order-deadline,
  Anrufer-Erlebnis nach Release, ob DE-mobile bestellbar ist, ggf. IT-Pre-Approval-Fehler.
  Nachregel-Review ZUSAETZLICH (geld- und compliance-kritisch, bisher ohne Phasenzuordnung):
  (a) Telnyx-MRC-Verhalten bei auto-cancelled Order (Rueckerstattung? bisher nur "vor G3
  klaeren" in 8./10.8) und (b) Stripe-Hold-Verfallstage ueber mehrtaegiges pending (bisher
  "vor Umsetzung pruefen") -- beide sind G3-START-GATE: verfaellt der Hold vor der
  Aktivierung, kann nie gecaptured werden. Ebenfalls in G0: (c) wie Telnyx Suspension/Recall
  einer bereits AKTIVEN Laendernummer signalisiert (Webhook? Status am Phone-Number-Record?),
  (d) Besteller-Rolle: Deklarationspflicht des Endnutzers gegenueber Telnyx,
  Sub-Allocation-/Resale-Anforderungen je Pilotland (GB-Mobile verlangt zusaetzlich eine
  Sub-Allocation-Angabe, GB-Firma die UK-Registrierung des KUNDEN) und was passiert, wenn
  Telnyx die Plattform-Konstellation als Fehldeklaration wertet (Nummern-Recall,
  Account-Sperre). Gate: Ergebnisse in diesem Plan festgehalten; UNBESTAETIGT-Marker
  aufgeloest oder bestaetigt. Abnahmekriterium: schriftliche Antwort/Testprotokoll bzw.
  Produktiv-Account-Protokoll fuer (a)/(b). ENTSCHEIDEN 2026-09-01: (i) Durchfuehrung GEMEINSAM
  in einer eigenen Session (API-Calls gegen den Produktiv-Account, Ergebnisse direkt in diesem
  Plan); (ii) Order-Weg aus Risiko 4: Weg A (Order sofort parallel zur Gruppen-Befuellung,
  Capture erst bei Aktivierung) ist der Plan -- Weg B (Order erst nach approved Gruppe)
  greift genau dann, wenn (a) ergibt, dass Telnyx die MRC auto-cancelter Orders behaelt.
  G0-ZWISCHENSTAND 2026-09-01 (Doku-Recherche, Session): Oeffentliche Quellen ausgewertet
  (Event-Katalog webhook-events.json, 94 Events; OpenAPI spec3.json; Notification-Artikel
  4277896; llms-full-txt; pricing.md; Stripe-Doku). Ergebnisse im Einzelnen:
  - (b) Stripe-Hold-Verfallstage GEKLAERT (G3-Start-Gate (b) damit per Doku erfuellt):
    Standard-Autorisierung 7 Tage (Online-Karten; uncaptured PaymentIntents werden nach
    7 Tagen gecancelt), Extended Authorization bis ~30 Tage (29 d 18 h, je Kartennetzwerk,
    muss aktiviert werden, teils Zusatzkosten)
    (docs.stripe.com/payments/place-a-hold-on-a-payment-method,
    docs.stripe.com/payments/extended-authorization). KONSEQUENZ: Der 14-Tage-Deckel
    (10.3) ueberschreitet das 7-Tage-Fenster -- Capture bei Aktivierung braucht entweder
    Extended Authorization ODER einen neu gestellten Hold je Retry; der Risiko-15-Pfad
    (Retry mit NEUEM Hold) ist damit Pflichtbestandteil von G3, nicht optional.
  - (1)/(2) Events: Der oeffentliche Katalog fuehrt als EINZIGEN Nummern-Webhook
    number_order.complete (NumberOrderStatusUpdate; Webhook-only, bestaetigt in 4277896).
    Requirement-Group- und Dokumenten-Events existieren in Katalog UND OpenAPI nicht; die
    frueher dokumentierte Notification-Setting "Requirement Group Status Change" wird im
    Artikel 4277896 heute nicht mehr genannt. => Polling (stuendlicher Sweep) ist der
    primaere Weg fuer ALLE mehrtaegigen Zustaende; der Webhook beschleunigt nur die
    Aktivierung. Der event_type-String fuer Requirement Groups bleibt empirisch
    (Produktiv-Account/Support).
  - (3) Order-deadline: Mechanik bestaetigt (llms-full-txt, Abschnitt "Deadline + Auto
    Cancellation": Requirements bis deadline, Auto-Cancel bei Fristablauf, neue deadline
    nach Ablehnung, Verlaengerung per Kommentar) -- deckungsgleich mit 3.; die DAUER
    bleibt undokumentiert -> Support/Produktiv-Account. OpenAPI: deadline-Feld sitzt je
    phone_number am Order (NumberOrderPhoneNumber.deadline, date-time, ohne Dauer-Angabe).
  - (a) MRC bei auto-cancel: oeffentlich NICHT belegt. Indiz GEGEN Rueckerstattung:
    "Orders are final, and we do not provide refunds if you purchased a number by
    mistake" (Support-Artikel 4380325). -> Support-Ticket bleibt G3-START-GATE (a);
    bis zur Antwort gilt Weg B als vorbereiteter Fallback (Entscheidung oben, (ii)).
  - (4) Anrufer-Erlebnis nach Release: offiziell undokumentiert; plausibel aus Community/
    Help-Center-Indizien: Standard-Carrier-Ansage ("number not in service"), Telnyx
    haelt die Nummer ~2 Wochen in Hold vor Rueckgabe in den Pool. Empirischer Test mit
    einer Testnummer bleibt offen (vor G4b).
  - (5) DE-mobile: GEKLAERT 2026-09-01 (Live-Check Produktiv-Account): Suche mit
    phone_number_type=mobile+voice liefert Fehler 10015 "No coverage found" -- DE-mobile
    ist NICHT bestellbar; der Preisposten in pricing.md (MRC $0.75, OTC $1) ist ein
    Phantom ohne Bestellbarkeit. Deckungsgleich mit dem DE-Support-Artikel.
  - (d) Sub-Allocation/Besteller-Rolle: 0 Vorkommen von sub-allocation in OpenAPI und
    llms-full-txt -- der Begriff existiert nur im GB-Support-Artikel. TEILERGEBNIS
    2026-09-01 (Live-Requirements GB): die Sub-Allocation-Disclosure ist ein PFLICHT-
    Requirement-Typ am GB-Order ("Business Use Case Description (with Sub-Allocation
    Disclosure)", textual) -- Deklaration ist Formfeld, keine Grauzone. Support-Frage
    verengt sich auf: wird Sub-Allocation an Endkunden genehmigt, und welche Folgen hat
    Fehldeklaration?
  G0-MUSTERLAUF 2026-09-01 (Produktiv-Account, Owner-go): DE-local +4921194289148
  (Vorwahl 211 Duesseldorf, $1 MRC + $1 OTC), Order b559545d-e1c4-45c5-b460-dff7bafc7396,
  customer_reference "G0-geo-nummern-musterlauf-2026-09". Befunde bislang: (i) Order per
  API sofort pending, requirements_status requirement-info-pending; die 6 DE-local
  requirement_types haengen maschinell lesbar am sub_number_order (Zuordnung via
  /v2/requirement_types/{id}). (ii) deadline ist bei Order-Anlage NULL und bleibt NULL
  nach erster Teil-Einreichung eines textual-Felds (Company-Registration-Number="N/A",
  PII-frei, PATCH HTTP 200) -- die Frist entsteht offenbar erst mit Review-Beginn; die
  llms-Aussage "each order has a deadline" ist ungenau (Korrektur gegenueber 3.).
  (iii) Die Nummer existiert bis zum Order-Erfolg NICHT als Phone-Number-Record im
  Account (GET /v2/phone_numbers leer) -- Release-Reconcile darf pending Orders also
  nicht ueber den Phone-Number-Index suchen. (iv) Bestands-Realitaet DE: Vorwahl 2132
  (Meerbusch) komplett leer, 211 reichlich Bestand -- der Such-Filter
  filter[national_destination_code] funktioniert und liefert mit cost_information den
  Live-Preis je Kandidat. Der Order laeuft bewusst ohne Dokumente ins Leere; Beobachtung
  auf deadline-Erscheinen/Auto-Cancel/MRC-Ausgang laeuft (Task), danach manuell canceln
  und dokumentieren.
  LIVE-CHECKS PRODUKTIV-ACCOUNT 2026-09-01 (read-only, lokaler .env-Key, keine
  Bestellung, nichts geschrieben):
  - /v2/notification_events listet "Requirement Group Status Change" (Kategorie Orders,
    enabled) -- das Notification-Event EXISTIERT am Account; der oeffentliche
    Event-Katalog ist lueckenhaft. Der exakte Webhook-event_type-String bleibt trotzdem
    empirisch (Setting anlegen + Gruppe befuellen); die Existenzfrage ist positiv
    beantwortet.
  - /v2/notification_settings: leer -- am Account sind KEINE Notification-Settings
    konfiguriert; G3 muss Channel+Profile+Setting anlegen (auch fuer
    number_order.complete, das heute nirgends ankommt).
  - /v2/requirements live verifiziert fuer DE und GB (local, ordering):
    requirement_types inkl. acceptance_criteria sind programmatisch abfragbar (DE:
    Contact Information textual, Proof of Address Local als Dokument u. a.; GB beginnt
    mit Proof of Address National / Utility Bill). Das ist die Datenquelle fuer die
    G3-UI/Prompts, keine manuelle Pflege noetig.
  OFFEN (empirisch, braucht Antonio/Produktiv-Account): event_type-String Requirement
  Group (Setting + echte Gruppe), Deadline-DAUER (echte Order), MRC-bei-auto-cancel (a,
  Support), Release-Anrufer-Erlebnis (4, echter Release), Sub-Allocation/
  Deklarationspflicht (d, Support), IT-Pre-Approval-Fehler. Naechster konkreter Schritt:
  die EINE korrekt deklarierte DE-local-Bestellung (~$2, echte Dokumente des
  Account-Inhabers, Release danach) -- klaert Deadline-Dauer, Event-Strings und
  Review-Erlebnis in einem Zug; wartet auf Owner-Go.
  OWNER-ENTSCHEIDUNG 2026-09-01 (PRODUKTIV-ACCOUNT statt Produktiv-Account): G0 laeuft auf dem
  Produktiv-Account, es wird KEIN Produktiv-Account angelegt. Dafuer sprechen: das Trial-Limit
  (Pretrial-Accounts erlauben nur EINE Nummern-Bestellung) entfaellt; die Broker-Modell-
  Frage (d) muss ohnehin vom echten Account aus gestellt werden (Support antwortet im
  echten Kontext); keine zweite Abrechnung/Verwaltung. Bewusst akzeptiert: Experimente
  laufen am Account, der die Live-Telefonie aller Tenants traegt -- die einzige Bestellung
  ist deshalb eine KORREKT deklarierte DE-Nummer mit echten Dokumenten des
  Account-Inhabers (keine Fake-Dokumente, keine Fehldeklaration; ~$2, Release danach);
  Notification-Setting-Aenderungen betreffen nur Nummern-Order-Events und werden
  dokumentiert und ruecknehmbar konfiguriert; read-only API-Checks (Requirements, Suche,
  Settings) sind gefahrlos.
  Deadline-DAUER, MRC-bei-auto-cancel (a), Release-Anrufer-Erlebnis (4), DE-mobile-
  Bestellbarkeit (5), Sub-Allocation/Deklarationspflicht (d), IT-Pre-Approval-Fehler.
- G1 Fundament Store (kein Verhalten fuer Bestands-Tenants): Felder kind/targetCountry/
  verification-Status am Number- bzw. Tenant-Record (additive ALTERs, RLS), neue
  Transitionen 'verifying'/'grace' in der fail-closed-Tabelle, Swap-Fenster-Konstanten.
  Bewusst NICHT gebaut: keine neue Route, kein UI, kein Telnyx-Call. Abnahmekriterium:
  Test der Transitionstabelle lehnt jede undefinierte Kante ab; npm test gruen;
  Bestands-Tenants sehen null Differenz (Test mit Altdaten-Fixture).
- G2 Dokumenten-Durchreichung (PII-Route): Self-Service-Endpunkte nach dem Muster
  private-number hinter webAuthMw: POST Adresse (-> POST /v2/addresses), POST Dokument
  (-> POST /v2/documents, transient, kein Persist bei uns, kein Loggen von Inhalten),
  GET Verifikationsstatus. START-GATES (Blocker, Regel-Review + Compliance-Review):
  (a) Owner-Entscheidung 10.1 (Aufbewahrung) ist mit rechtlicher Abnahme entschieden und
  hier festgehalten (Entscheidung gefaellt 2026-09-01: Option (a) Telnyx-Speicherung, siehe
  10.1; die rechtliche Abnahme steht noch aus und bleibt Gate), (b) AVV/DPA mit Telnyx
  inkl. Drittlandtransfer-Mechanismus ist
  abgeschlossen (SCC-Dokument von Telnyx annehmen, siehe 3.), (c) geklaerte Rechtsgrundlage
  plus Art.-13-Hinweis in der Upload-UI (Dokumente gehen an Telnyx, US-Anbieter). Ohne (a)-(c)
  geht die PII-Route nicht live -- die Abnahmekriterien unten sind rein technisch und
  decken das nicht ab. Abnahmekriterium ZUSAETZLICH: (d) route-spezifisches
  Body-Limit/Multipart-Handling NUR fuer die Dokument-Route (begruendet, begrenzt, hinter
  webAuthMw, saubere Nutzerfehlermeldung bei Ueberschreitung, KEINE Erhoehung des globalen
  BODY_LIMIT='100kb', src/app.js:53, 113-115 -- ein Pass-Scan als PDF/Foto sprengt 100 kb
  regulaessig, Telnyx nimmt bis 20 MB), (e) Plausibilitaets-Abgleich Dokumentinhalt vs.
  Tenant-Identitaet (Name/Geburtsdatum aus OIDC/Stripe) nach dem Muster der
  Besitz-Verifikation private-number: Pre-Mortem R9, (f) Begrenzung der Upload-/
  Reupload-Versuche, (g) Missbrauchs-Alarm (Haeufung abgelehnter Verifikungen,
  voneinander abweichende Dokumentnamen je Tenant). Abnahmekriterium (Bestand):
  unauthentifiziert 401/403; ein Test-Dokument taucht bei Telnyx auf und ist nach 30 Min
  ohne Link automatisch geloescht; grep-artiger Test, dass kein Dateiinhalt in Store/Log
  landet. Bewusst NICHT gebaut: eigene Bildschirmfreigabe/Onfido-Automation (action-Klasse
  nur fuer AU-Mobile relevant).
- G3 Regulierter Order + Warten: Worker erweitert: Fuer Laender mit Regulatorik (aktivierte
  Allowlist, zunaechst nur GB) Requirement Group befuellen, Order mit requirement_group_id,
  Number-Record 'verifying', Webhook-Endpunkt fuer number_order.complete + stuendlicher
  Polling-Zweig im runSweepTick als Fallback, Comments-API-Ablehnungsgruende einsammeln.
  Merge OHNE Aktivierung (Laender-Allowlist leer). Uebergangssemantik (Regel-Review,
  fail-closed formulieren): Laender ausserhalb der Allowlist erhalten EXAKT das heutige
  Verhalten (globaler FORCE_NUMBER_COUNTRY-US-Override unberuehrt); die Allowlist schaltet
  PRO LAND den neuen Pfad frei; das Praedikat "GB-User" ist die User-Wahl aus
  resolveOnboardCountry (nicht IP-Geo). Uebernahmepflichten aus 5.: EINE aktivierende
  Funktion unter withStoreLock (Webhook/Sweep/Reconciler stossen nur an), Capture-
  Idempotenz je Order, Geld-Endzustaende je Verifikationsausgang, aktive Beendigung des
  Verifikations-Orders bei Suspend/Kuendigung inkl. observing hold-Korb, Capture-Versagen-
  Pfad (Retry mit neuem Hold vor Release, Nutzerkommunikation). Abnahmekriterium: mit
  Produktiv-Account eine Pilotland-Nummer bis pending gebracht und per Webhook ODER Poll als
  success erkannt; Capture erst bei Aktivierung (Unit-Test: kein Capture bei Order-pending);
  Unit-Tests der Geld-Endzustaende; Test "doppelter Webhook + gleichzeitiger Poll => genau
  ein Capture, eine Transition".
- G4 Interim + Swap (die Aktivierung) -- nach Regel-Review GETEILT, weil die Sammel-Phase
  dem Inkrementalitaetsversprechen widersprach (ein Revert nach Live-Swaps haette den
  Release-Sweep mit entfernt und ewige Doppel-Miete hinterlassen, siehe Risiko 10):
  - G4a Interimskauf + Deckel + Dashboard: Interims-US-Nummer (kind='interim') fuer
    regulierte Laender, Dauer-Deckel 14 Tage (ENTSCHEIDEN 2026-09-01, 10.3) mit
    Entscheidung (a)/(b) aus 5., Erstattungs-/Vertragsfolge nach 10.14 entschieden
    (2026-09-01: keine Sonderregel), Dashboard-Anzeige zwei Nummern. VOR Setzen der
    Allowlist zusaetzlich: Owner-Entscheidung 10.15 (Herkunfts-Gate nach
    FORCE_NUMBER_COUNTRY-Rueckbau, siehe 5./7c) gefaellt (2026-09-01: Gate-Loeschung,
    siehe 10.15 -- als eigene Phase vor G4a umzusetzen).
  - G4b Aktivierung + Swap + grace/Release: Bei Aktivierung der Laendernummer: capturen,
    active setzen, Interims-Nummer 'grace', Frist-Timer, danach releaseNumber ueber den
    NEUEN Swap-Release-Pfad aus 5. (eigener Klassifikator kind='grace', kein
    tenantSuspendedAt/tenantInactive-Recheck, pending-Marker, Audit). Absenderwechsel
    (permanent schlaegt interim) als expliziter Swap-Schritt.
  Abnahmekriterium (gemeinsam): End-to-End-Test mit zwei Fake-Nummern (Interim + Land) inkl.
  Release-Rollback; laenger laufende grace-Nummer wird vom Sweep released; Dashboard zeigt
  im Swap-Fenster beide korrekt; Outbound geht waehrend grace mit der Land-Caller-ID und
  Land-Sprachanker (nicht der US-Nummer); Revert-Verhalten dokumentiert -- Tenants in
  verifying/grace bleiben betreut, der Release-Sweep bleibt bei Rueckgaengigmachung aktiv.
  Erst hier wird die Laender-Allowlist auf GB gesetzt und FORCE_NUMBER_COUNTRY fuer GB-User
  entfaellt (Praedikat: User-Wahl, siehe G3; Verhalten aller anderen Laender unveraendert).
  Bewusst NICHT gebaut: automatische Rufumleitung alter->neue Nummer (Telnyx bietet das
  nicht dokumentiert fuer DIDs).
- G5 Rollout + Kostenhaerte: Weitere Laender nach Prioritaet (Vorschlag: FR, danach
  AT/IE/ES; CH/IT spaeter wegen business-only/PDF-only/Requirement-Groups-Pflicht),
  holdAmountForCountry mit echten Preisen befuellen, Kosten-Telemetrie der Interimsphase
  (Doppel-Miete je Tenant sichtbar) inkl. Klaerung des Traegers (10.13: ENTSCHEIDEN
  2026-09-01 -- Plattform traegt, kein number_month-Beleg der Interims-Nummer auf der
  Tenant-Achse, siehe 10.13). VOR G5: Landwechsel-Regime nach G4 (10.11 -- Risiko 8 sperrt
  den Self-Service-Landwechsel nur bis G4 stable; ENTSCHEIDEN 2026-09-01: ein Wechsel je
  Abrechnungszeitraum plus Gebuehr, siehe 10.11): Wechsel-Frequenz, Gebuehr,
  verpflichtendes Release der
  Altnummer vor neuem Zyklus, harte Grenze gleichzeitiger 'verifying'-Datensaetze je
  Tenant (jeder Wechsel loest einen vollen Zyklus aus: neue Interims-Nummer,
  Doppel-Miete, neue Verifikation, Telnyx-Review-Last). Abnahmekriterium: Fuer jedes neue
  Land reicht ein Daten-/Konfig-Eintrag plus Regressionslauf; keine Codeaenderung pro Land
  (ausser neue Sonderregeln wie IT-PDF-only im Upload).

## 7. Integration in die Safety-Gates

- CLAUDE.md Regel 1 (Gates unangetastet): Outbound-Permit (Abo+KYC), OUTBOUND_FROZEN,
  Denylist/Land-Gate/Stundenlimit, pro-Tenant-Kostendecke (beide Richtungen),
  Max-Gespraechsdauer, Provider-Signatur bleiben unveraendert. Vier Beruehrungen sind
  bewusst und dokumentiert: (a) Der Zwei-Nummern-Betrieb im Swap-Fenster braucht eine
  Anhebung von MAX_NUMBERS_PER_TENANT 1 -> 2 als explizite, per Land/Flag begrenzte
  Swap-Freigabe (NICHT als globale Default-Anhebung; das DID-Deckel-Prinzip bleibt).
  Alternativ ohne Anhebung: sequenzieller Swap mit empfangslosem Fenster -- abgelehnt,
  siehe Pre-Mortem R3. (b) Der Capture-Punkt verschiebt sich fuer regulierte Laender von
  "nach Order-Quittung" auf "nach Aktivierung" -- das haertet die Geld-Invariante
  (Capture nur gegen aktive Leistung), lockert nichts. Rollback-Pfad Provider-Release
  bleibt fuer alle Fehlerfaelle erhalten. (c) Herkunfts-Gate (im Entwurf vergessen, Regel-
  Review): Das Herkunfts-Gate (originGateError, 403 bei fremder Absender-Herkunft auf
  Inlandszielen) haengt heute alleine an numberOriginDecoupled =
  Boolean(provisioning.forceNumberCountry) (src/telephony/outbound-gates.js:143-144,
  473-487). Der geplante FORCE_NUMBER_COUNTRY-Rueckbau fuer GB-User wuerde es fuer genau
  die Konstellation schliessen, fuer die die Interims-Nummer gedacht ist (GB-Ziel unter
  US-Absender). Das ist eine dritte, ausdrueckliche Beruehrung: entweder ein eigenes,
  begruendetes Decoupling-Flag mit Boot-Guard-Anpassung oder ein anderes
  Interimskonzept -- Owner-Entscheidung 10.15 VOR der Allowlist (G4a). ENTSCHEIDEN
  2026-09-01 (10.15): Loeschung des Herkunfts-Gates statt Decoupling-Flag oder
  Interims-Ersatz; Details siehe 10.15. Damit ist diese Beruehrung (c) hinfellig. (d) Pro-Tenant-
  Kostendecke vs. Doppel-Miete: recordNumberMonthMeter bucht je aktiver Nummer einen
  number_month-Beleg mit monthlyCostCents auf die TENANT-Achse; im Swap-Fenster sind zwei
  Nummern aktiv -> zwei Belege im selben Monat auf genau der Achse, die budgetExceeded
  liest (src/billing/metering.js:166-184, src/store/state-ops.js:4269-4285, stuendlicher
  Sweep + Abo-Verlaengerung in src/worker/provisioning-orchestrator.js:282-301). Ohne
  Entscheidung (10.13) kann die Interims-Miete die Kostendecke ueberziehen und den
  Gespraechsbetrieb mitten im Swap sperren -- die Decke selbst bleibt unangetastet,
  entschieden wird nur, ob und was auf sie gebucht wird. ENTSCHEIDEN 2026-09-01 (10.13):
  Plattform traegt -- der number_month-Beleg der kind='interim'-Nummer wird nicht auf die
  Tenant-Achse gebucht; der Doppel-Beleg kann die Decke damit nicht triggern.
- Regel 3 (AUTH FAIL-CLOSED): Alle neuen Endpunkte (Dokument-/Adress-Upload,
  Verifikationsstatus, ggf. Webhook fuer number_order.complete) sind standardmaessig
  hinter auth. Der Telnyx-Webhook-Endpunkt laeuft nach dem Muster der bestehenden
  /voice/*-Provider-Webhooks mit Provider-Signaturpruefung fail-closed und Kommentar +
  route-policy-Eintrag. Die Self-Service-Routen haengen an webAuthMw (aktive OIDC-Session).
- Regel 4 (SECRETS/PII): Ausweisdokumente sind hochsensibel. Grundsatz: transient
  durchreichen (base64/multipart direkt an POST /v2/documents), keine persistente Ablage
  bei uns, niemals loggen, niemals in API-Responses/MCP-Tool-Ausgaben; 30-Minuten-Link des
  Telnyx-Uploads unmittelbar an Order/Requirement haengen. Retry braucht Neu-Upload durch
  den User (oder Wiederverwendung der Telnyx-Dokument-ID, die bereits bei Telnyx liegt).
  Audit-Log nur Metadaten (Dokument-ID, Zeit, Tenant), nie Inhalt.
- Transkript-/Gespraechsdaten der Interims-Nummer bleiben wie jeder andere Call-Record im
  Store (Regel 1: Kostendecke bucht auch dort weiter); sie wandern nicht und werden beim
  Release nicht geloescht.
- PLAN-SECURITY.md: PII-Durchreichung und neuer Provider-Webhook werden dort als Eintraege
  festgehalten (Pflicht bei sicherheitsrelevanten Aenderungen).

## 8. Kosten

Doppel-Miete in der Interimsphase (je Tenant, pro Monat):

- Interims-US-Nummer: $1.00/Monat (https://telnyx.com/pricing.md; US-Base-Rate).
- Zielland local dazu: IE $0.50, GB/DE/FR/CH/ES $1, AT/IT/AU $2.
- Typische Verifikationsdauer ~72 h plus Puffer bis zum Release ( grace-Fenster 14 Tage):
  realistische Doppelhalte 0.5-2 Wochen => Mehrkosten je Swap ca. $0.25-$1.50 pro Tenant
  (anteilige Miete der Interims-Nummer). Bei 1.000 Swaps/Monat obere Schranke also ~$
  1.500 -- der Broker-Preis dafuer ist ein sofort nutzbares Produkt statt Tage Wartezeit.
- Nach dem Release endet die US-MRC sofort ("monthly recurring charges will no longer
  apply"); Telnyx haelt die Nummer 15 Tage rueckkaufbar, Rueckkauf prorated, bei
  internationalen Nummern erneut Dokumente (https://support.telnyx.com/en/articles/4380325).
- Traeger der Doppel-Miete (Regel-Review, bisher implizit "Plattform"): Die Rechnung oben
  nennt Plattform-Broker-Preis, gebucht wird aber auf die TENANT-Achse -- der
  Monatsmeter feuert je aktiver Nummer einen number_month-Beleg mit monthlyCostCents
  (src/billing/metering.js:166-184), stuendlich und bei jeder Abo-Verlaengerung
  (settleDueNumberMonthMeters, src/worker/provisioning-orchestrator.js:282-301). Im
  Swap-Fenster stehen zwei Belege im selben Monat auf der Achse, die budgetExceeded/
  Kostendecke liest (sperrt BEIDE Richtungen). Owner-Entscheidung 10.13 vor G4a: Interims-
  Miete erlassen/gutschreiben, bewusst belasten oder den number_month-Meter der
  kind='interim'-Nummer nicht auf die Tenant-Decke buchen -- und wie verhindert wird, dass
  der Doppel-Beleg die Decke triggert (z.B. Decke um den Interimsanteil entlasten).
  ENTSCHEIDEN 2026-09-01 (10.13): Plattform traegt -- kein number_month-Beleg der
  Interims-Nummer auf der Tenant-Achse; der Doppel-Beleg kann die Decke damit nicht
  triggern (technische Form legt G4a fest).

Hold/Capture je Land: provisionNumber haelt den Provider-Live-Preis vor dem Order und
capturt davor bzw. kuenftig erst bei Aktivierung; die Pauschale liefert
holdAmountForCountry (Tabelle heute leer, src/telephony/provisioning-geo.js:43-127).
Preise sind vor Kauf ueber das cost_information-Objekt der Available-Phone-Numbers-API
abfragbar -- das ist der Weg, monthlyCostCents ohne manuelle Pflege zu fuellen. Offen:
Was passiert mit der gebuchten Telnyx-MRC, wenn ein Order an seiner deadline auto-cancelt
(Rueckerstattung seitens Telnyx?) -- Recherche 2026-09-01: oeffentlich nicht belegt, Indiz
gegen Rueckerstattung ("Orders are final", Support-Artikel 4380325); Support-Ticket bleibt
G3-START-GATE (a). Stripe-Hold-Verfall ueber mehrere
Tage: GEKLAERT 2026-09-01 per Stripe-Doku (7 Tage Standard, Extended Authorization bis
~30 Tage -- siehe G0-Zwischenstand); das Abnahmekriterium (b) ist damit erfuellt.

Plattform-Deckel: MAX_NUMBERS Default 5 (Onboarding-Sperre bei zusaetzlich 0) muss mit
dem gleichzeitigen Swap-Betrieb skaliert werden (Schaetzung: aktive Interims-Nummern +
aktive Laendernummern pro Tenant 2 => plattformweit Default mindestens 2x Tenant-Zahl,
bzw. limitseteuerung wie bisher per Config).

## 9. Pre-Mortem

Risiko 1 -- Ausweisdokumente leaken (groesster Schaden: DSGVO/PII-Vorfall). Was wenn
passiert: Upload-Route loggt Multipart-Body, Store persistiert base64, Fehlermeldung gibt
Dateiinhalt zurueck. Gegenmassnahme: transient-only-Architektur (G2) mit expliziten Tests
auf Store-/Log-Freiheit, Audit nur Metadaten, kein Error-Body mit Inhalt, PLAN-SECURITY-
Eintrag, Code-Review-Fokus PII. Owner-Entscheidung zur Aufbewahrungspflicht vorher klaeren
(T&C verlangt lokale Retention -- Telnyx-Speicherung zaehlen oder nicht).

Risiko 2 -- Tenant haengt ewig auf der Interims-US-Nummer (Verifikation declined,
User reagiert nicht). Was wenn passiert: unbegrenzte Doppel-Miete, Produktversprechen
"GB-Nummer" nie erfuellt, Supportlast. Gegenmassnahme: harter Dauer-Deckel (14 Tage, 10.3) mit
erzwungener Entscheidung (permanente US-Nummer ODER begruendete Verlaengerung),
declined-Gruende aus der Comments-API dem User direkt als Handlungsanweisung zeigen,
Sweep-Zweig ueberwacht grace- und verifying-Altersstufen; Erstattungs-/Vertragsfolge bei
endgueltiger Ablehnung siehe 10.14 (Compliance-Review: Rollback/Kommunikation waren nur
fuer "User reagiert nicht" beschrieben, nicht fuer "Plattform kann nicht liefern").

Risiko 3 -- Zwei-Nummern-Parallelbetrieb hebt den DID-Deckel still auf. Was wenn
passiert: MAX_NUMBERS_PER_TENANT pauschal hochgesetzt, jeder Tenant akkumuliert Nummern,
Kostenlauf. Gegenmassnahme: kein globaler Default-Anhebung; zeitlich gedeckelte
Swap-Freigabe (zusaetzlich genau eine Nummer in verifying/grace, harte Pruefung in
requestNumber), Meta-Monitoring der Zahl gleichzeitiger grace-Nummern mit Alarm.

Risiko 4 -- Geld weg ohne Leistung: Capture auf Order-Quittung, Verifikation scheitert
spaeter, Telnyx behaelt MRC des auto-cancelled Orders. Was wenn passiert: Rueckerstattungs-
und Reputationsaufwand. Gegenmassnahme: Capture erst bei Aktivierung (G3), Rollback mit
Provider-Release bleibt, Telnyx-MRC-Verhalten bei auto-cancel in G0 klaeren, im Zweifel
Order erst NACH approved Gruppe anlegen (Weg B) -- dann ist der Kauf von Anfang an
sicher. ENTSCHEIDEN 2026-09-01: Weg A ist der Plan (Zielbild 5.); Weg B greift genau dann,
wenn G0 (a) ergibt, dass Telnyx die MRC auto-cancelter Orders behaelt.

Risiko 5 -- Anrufer der alten Nummer verschwinden: Nach dem Release der Interims-Nummer
rufen Menschen die alte US-Nummer an und hoeren ... nichts Dokumentiertes (UNBESTAETIGT; Recherche 2026-09-01: plausibel Standard-Carrier-Ansage "number not in service", ~2 Wochen Hold -- empirischer Test mit Testnummer bleibt offen).
Was wenn passiert: verpasste Anrufe, verlorene Kontakte des Tenants. Gegenmassnahme:
14-Tage-grace mit aktiver Hinweis-Kommunikation (Agent nennt im Gespraech auf der alten
Nummer die neue), Release erst danach, Verhalten nach Release in G0 per Support/Testnummer
klaeren; 15-Tage-Rueckkauf als Notfallanker.

Risiko 6 -- Webhook-Luecke: Gruppen-/Dokumenten-Events sind nicht dokumentiert
(UNBESTAETIGT). Was wenn passiert: Nummer aktiviert, wir merken es tagelang nicht,
Tenant bleibt auf Interim. Gegenmassnahme: stuendlicher Polling-Zweig im bestehenden
runSweepTick ist primaer, der Webhook nur Beschleuniger (und umgekehrt robust); Boot-
Reconciler klassifiziert haengengebliebene verifying-Jobs beim Restart.

Risiko 7 -- Regulatorik aendert sich mid-flight (Gruppe no-longer-eligible, neue
Requirements). Was wenn passiert: abgeschlossener Flow bricht bei der naechsten Bestellung,
 Fehler unerwartet. Gegenmassnahme: Verifikations-Statusmaschine kennt expired/no-longer-
eligible als erstklassige Zustaende, Requirements werden pro Order frisch ueber
GET /v2/requirements geholt statt nur aus Cache, Fehlermeldung an den User mit konkretem
Nachforderungsweg.

Risiko 8 -- Falsche Landzuordnung (IP-Geo irrt, User uebersieht Wahl). Was wenn passiert:
FR-Verifikation fuer einen DE-User angestossen, Praesenzpflicht unerfuellbar, Ablehnung.
Gegenmassnahme: Land immer als bestaetigte User-Wahl im Onboarding (Praezedenz bleibt),
bei Laendern mit Praesenzpflicht im UI deutlich machen, dass Ausweis/Adresse/Anwesenheit
im Land sein muessen; Self-Service-Landwechsel bleibt gesperrt (409) bis G4 stable.

Risiko 9 -- Identitaetsbetrug: fremde oder gestohlene Ausweiskopien (Compliance-Review,
fehlte komplett). Telnyx prueft das Dokument gegen die ANGEGEBENE Person/Adresse -- nicht
gegen unsere Tenant-Identitaet; webAuthMw allein reicht als Gate. Was wenn passiert:
Belaestigungs-/Spoofing-Kampagne ueber auf Drittpersonen registrierte Laendernummern;
Opfer und Behoerden kommen zu uns als Telnyx-Kunde; Telnyx sperrt den Account (Zahlen-
Verhalten nach Account-Sperre, Support-Artikel 8648864, siehe Quellen) = Totalausfall
ALLER Tenants. Gegenmassnahme: Plausibilitaets-Abgleich Dokumentinhalt vs. Tenant-
Identitaet (Name/Geburtsdatum aus OIDC/Stripe), Begrenzung der Upload-/Reupload-Versuche,
Missbrauchs-Alarm (Haeufung abgelehnter Verifikationen, abweichende Dokumentnamen),
Notfallplan fuer den Account-Sperre-Fall (G2-Abnahmekriterien (e)-(g)).

Risiko 10 -- Revert von G4 nach Live-Swaps. Was wenn passiert: Die Sammelphase G4 wird
zurueckgerollt, der Release-Sweep verschwindet mit ihr, zurueckbleibende grace-Nummern
bedeuten ewige Doppel-Miete (genau Risiko-2/3-Szenario). Gegenmassnahme: G4 geteilt in
G4a/G4b; Revert-Verhalten fuer Tenants in verifying/grace dokumentiert -- mindestens der
Release-Sweep bleibt bei Rueckgaengigmachung aktiv (Abnahmekriterium G4).

Risiko 11 -- Interims-US-Nummer als Missbrauchsziel (Compliance-Review). Fuer einen
Missbraucher ist die US-Nummer nicht Durchgang, sondern das Ziel: anonym, sofort aktiv,
einziges Gate ist Karte + Kostendecke; der 14-Tage-Deckel hat die Verlaengerungsoption (b)
und damit kein hartes Ende. Was wenn passiert: Spam-Schadensbild von der Plattform-Nummer
(Carrier-/Telnyx-Reputation, Beschwerden, Account-Sperrung) -- die bestehenden Decken
begrenzen Kosten, nicht Reputation und Missbrauch. Gegenmassnahme: Verlaengerungsoption (b)
nur mit explizitem Review, Auffaelligkeits-Monitoring waehrend der Interimsphase
(Outbound-Volumen/Beschwerden je Interims-Nummer), Sperr-/Entzieh-Kriterium fuer
Interims-Nummern vor Verifikationsabschluss.

Risiko 12 -- Rueckruf der AKTIVEN Laendernummer (Compliance-Review; Risiko 7 deckt nur die
NAECHSTE Bestellung). Telnyx/Regulierer suspendiert oder terminiert eine bereits aktive
GB-Nummer; Requirements tragen expires_at, der Lifecycle kennt 'suspended'. Was wenn
passiert: Zu diesem Zeitpunkt ist die Interims-US-Nummer laengst released und der
15-Tage-Rueckkauf abgelaufen -- der Tenant steht ohne JEDE Nummer da, Anrufer ins Leere.
Gegenmassnahme: Suspension als ereignisbehafteter Zustand (Webhook/Sweep, Signalisierung
in G0 klaeren), Notfall-Rueckfall auf eine frisch provisioningbare US-Nummer,
Benachrichtigungspflicht an den Tenant.

Risiko 13 -- Praesenzpflicht per Selbstauskunft umgangen (Compliance-Review zu 10.10).
Option "Praesenz im UI bejahen lassen" ist die aktive Umgehung der Praesenzpflicht: Wir
lassen den User eine Erklaerung abgeben, die niemand prueft, und stehen als Telnyx-Kunde
fuer falsche Angaben gerade. Was wenn passiert: Haftung gegenueber Telnyx, Nummern-Recall,
Arglist des Users schlaegt auf uns durch. Gegenmassnahme: Option als eigenes Risiko
gefuehrt (dieser Eintrag), Entscheidung 10.10 VOR G4 erzwungen; im UI die Erklaerung als
verbindliche, dokumentierte und abrufbare Zusicherung gegenueber uns ausgestalten
(abrufbar bei Telnyx-Anfrage). ENTSCHEIDEN 2026-09-01 (10.10): Selbstauskunft mit genau
dieser Form; die Risiko-13-Massnahmen (Plausibilitaetsabgleich, Limits, Alarm) sind
Pflichtbestandteil von G2.

Risiko 14 -- Verifikation erst NACH Kuendigung/Refund abgeschlossen (Betriebs-Review; der
Fall fehlte komplett). Was wenn passiert: Der Cleanup erfasst keine 'verifying'-Nummern
(numberReleaseVerdict ist active-only, siehe 5.), der Capture feuert auf ein
Zahlungsmittel eines Ex-Tenants oder die Nummer liegt ungeschaeftet mit MRC beim Provider.
Gegenmassnahme: siehe 5. -- Suspend/Kuendigung beendet den Verifikations-Order aktiv,
Capture-Entscheidung koppelt an aktives Abo, observing hold-Korb mit Sweep + Audit.

Risiko 15 -- Capture-Versagen NACH Verifikation: Die verifizierte Nummer rollt zurueck
(rollbackAfterOrder mit Provider-Release), der Genehmigungsfortschritt verfaellt mit ihr;
der umgekehrte Fall von Risiko 4 ("Leistung da, Geld weg") war unbehandelt.
Gegenmassnahme: siehe 5. -- Separierung Aktivieren/Capture-gescheitert, Retry mit neuem
Hold vor Release, Nachziehfrist, Nutzerkommunikation; Hold-Haltbarkeit ueber Tage:
GEKLAERT 2026-09-01 (7 Tage Standard, ~30 Tage Extended Authorization -- siehe
G0-Zwischenstand; damit ist der Retry-mit-neuem-Hold-Pfad Pflicht).

## 10. Offene Fragen / Owner-Entscheidungen (entschieden 2026-09-01; Ausnahme: 10.8/10.9
sind G0-Klaerungen, keine Entscheidungen)

1. Ausweisdokumente: Wer bewahrt auf? Telnyx speichert verlinkte Dokumente; die
   country-specific T&C legt UNS die lokale Aufbewahrungspflicht auf. Optionen: (a)
   Telnyx-Speicherung als Erfuellung deklarieren (rechtlich pruefen), (b) eigene
   verschluesselte Ablage mit Retention-Loeschung (mehr PII-Risiko, mehr Aufwand).
   Empfehlung: (a) mit rechtlicher Abnahme; sonst Plan scheitert an G2. Regel-Review:
   Diese Entscheidung ist als G2-START-GATE festgeschrieben (6.) -- vorher geht keine
   PII-Durchreichungs-Route live. Dazugehoert die Loesch-/Unlink-Regel aus 3. (je
   Endzustand) und die Art.-17-Antwort unter Aufbewahrungspflicht.
   **ENTSCHEIDEN 2026-09-01:** Option (a) -- Telnyx-Speicherung als Erfuellung der lokalen
   Retention deklarieren; wir reichen transient durch, keine eigene Ablage. Die rechtliche
   Abnahme bleibt G2-START-GATE (zusammen mit AVV/DPA und Art.-13-Hinweis). Fallback bei
   negativer Abnahme (mitentschieden 2026-09-01): Option (b) -- verschluesselte eigene
   Ablage mit Retention-Loeschung; G2 bleibt in jedem Fall Gate. Wer die Abnahme macht
   (extern oder Owner selbst), ist bewusst NICHT entschieden (Owner 2026-09-01: erstmal
   offen); das G2-Gate erzwingt die Klaerung vor dem ersten produktiven Upload.
2. Interims-Nummer ja/nein: Empfehlung JA (US, $1, sofort aktiv) -- sonst ist der Tenant
   Tage unbrauchbar und die heutige UX verschlechtert sich. Alternative: nur fuer Laender
   mit Praesenzpflicht/dokumentenlastige Prozesse. Owner-Entscheidung.
   **ENTSCHEIDEN 2026-09-01:** JA -- US-Interims-Nummer sofort nach Zahlung (kind='interim',
   targetCountry am Number-Record). Uebernommene Konsequenzen: MAX_NUMBERS_PER_TENANT 1->2
   als gedeckelte Swap-Freigabe (7a), Miete-Traegerschaft nach 10.13.
3. Dauer-Deckel der Interims-Nummer: Vorschlag 30 Tage mit Decision-Punkt; Verlaengerungs-
   und Downgrade-Regel festlegen.
   **ENTSCHEIDEN 2026-09-01:** 14 Tage (abweichend vom 30-Tage-Vorschlag). Danach endet der
   Verifikationsversuch: Interims-US-Nummer wird permanent (Entscheidung (a) aus 5.).
   Verlaengerung nur mit explizitem begruendetem Review. Bewusst akzeptiert: 72-h-Review
   plus Nachreiche-Runden plus Puffer wird eng, langsame User fallen haeufiger auf die
   US-Endloesung. Alle 30-Tage-Referenzen in 5./6./9. sind auf 14 Tage zu lesen.
4. Pilotland: GB (grobe Nutzererwartung, local $1) oder DE (Heimatmarkt, Praezedenz-Land
   im Code, aber Registrierungsformular+Vorwahl-Match aufwaendiger) oder AT (teuerstes
   local $2, aber Vorwahl-Match wie DE)? CH/IT/NL-artige Sonderfaelle (business-only,
   PDF-only, Gruppen-Pflicht) erst nach Musterlauf.
   **ENTSCHEIDEN 2026-09-01:** GB -- groesster nicht-deutschsprachiger Zielmarkt, local
   $1/Monat, EU-Ausweis genuegt als lokale ID, keine Requirement-Groups-Pflicht. Die
   Laender-Allowlist in G3/G4 wird zunaechst ausschliesslich GB enthalten.
5. Setzt Telnyx-approved kycLevel=id_verified bei uns? Empfehlung: nein (zwei
   Vertrauensketten); nur dokumentieren, dass id_verified auch kuenftig alleiniger
   Owner-Bootstrap bleibt. Bei "ja": Review der Outbound-Gate-Konsequenzen.
   **ENTSCHEIDEN 2026-09-01:** Nein. Zwei Vertrauensketten bleiben getrennt; id_verified
   bleibt alleiniger Owner-Bootstrap (seedBootstrapKyc). Keine Gate-Aenderung.
6. Queue-Reife fuer mehrtaegige Prozesse: In-Memory-Queue reicht nur mit Sweep+Reconciler
   (Muster existiert); pgboss-Adapter ist vorhanden, Reifegrad laut Kommentaren "deferred
   nach P8" -- Entscheidung, ob G3+ darauf aufbaut oder Memory+Sweep bleibt.
   **ENTSCHEIDEN 2026-09-01:** Memory + stuendlicher Sweep + Boot-Reconciler (das
   bestehende, an Provisioning erprobte Muster). Kein pgboss-Ausbau fuer G3+.
7. Live-Config auf Render verifizieren: PROVISIONING_ENABLED und FORCE_NUMBER_COUNTRY
   aktuell gesetzt? (Aus dem Repo nicht ersichtlich, src/config.js:1596-1725.)
   **GEPRUEFT 2026-09-01 (Render):** FORCE_NUMBER_COUNTRY=US ist live gesetzt -- belegt
   durch die GAP-19-Boot-Warnung im Service-Log (letzter Start 2026-08-30,
   srv-d8m0fhflk1mc73bno570). PROVISIONING_ENABLED steht im Blueprint (render.yaml) auf
   "false" (Dry-Run); ein Dashboard-Override ist via API nicht direkt lesbar, aber alle
   Boot-Warnungen, die bei "true" ohne TELNYX_CONNECTION_ID bzw. bei PAYMENT_ENABLED ohne
   Provisioning feuern wuerden (src/boot.js:418-424, src/config.js:2533), bleiben aus --
   kein Anzeichen eines Overrides. Betriebliche Konsequenz: live wird heute KEINE echte
   Nummer gekauft; die Scharfschaltung von PROVISIONING_ENABLED ist Teil des Rollouts
   (G3/G4).
8. Telnyx-MRC-Verhalten bei auto-cancelled Order (Rueckerstattung?) und genaue
   Order-deadline-Laenge -- in G0 klaeren.
9. Anrufer-Erlebnis nach Release (Risiko 5) -- Telnyx-Support-Anfrage vor G4.
10. Wie gehen wir mit Laendern um, deren Praesenzpflicht fuer Remote-User unerfuellbar
    ist (DE/FR/GB/AT/ES/IT/IE)? Optionen: nur Onboarding mit User-Wahl dieser Laender
    zulasen und Praesenz im UI bejahen lassen (Selbstauskunft), oder diese Laender auf
    Auslandsnummern (US) begrenzen. Rechtliche/produktische Owner-Entscheidung.
    Compliance-Review: Entscheidung VOR G4 erzwingen; die Selbstauskunft-Option traegt
    Risiko 13 (bewusste Falschangabe) und braucht die verbindliche, dokumentierte
    Zusicherungs-Form im UI.
    **ENTSCHEIDEN 2026-09-01:** Selbstauskunft. Die Praesenz-Laender bleiben im Onboarding
    waehlbar; die Praesenz wird im UI als verbindliche, dokumentierte und abrufbare
    Zusicherung gegenueber uns erklaert (abrufbar bei Telnyx-Anfrage). Die Risiko-13-
    Massnahmen sind Pflichtbestandteil von G2: Plausibilitaetsabgleich Dokumentinhalt vs.
    Tenant-Identitaet, Upload-/Reupload-Limits, Missbrauchs-Alarm.
11. Landwechsel-Regime nach G4 (Regel-Review; Risiko 8 sperrt nur "bis G4 stable"):
    Wechsel-Frequenz (z.B. ein Wechsel pro Abrechnungszeitraum), Gebuehr in Hoehe der
    Interims-Miete, verpflichtendes Release der Altnummer vor neuem Zyklus, harte Grenze
    gleichzeitiger 'verifying'-Datensaetze je Tenant. Jeder Wechsel loest einen vollen
    Zyklus aus (neue Interims-US-Nummer, Doppel-Miete, neue Verifikation, Telnyx-Review-
    Last). Vor G5 entscheiden.
    **ENTSCHEIDEN 2026-09-01:** Ein Wechsel je Abrechnungszeitraum, Gebuehr in Hoehe der
    Interims-Miete, verpflichtendes Release der Altnummer vor neuem Zyklus, hart max. ein
    'verifying'-Datensatz je Tenant gleichzeitig. Umsetzung mit G5.
12. Besteller-Rolle gegenueber Telnyx (Compliance-Review): Telnyx-Kunde sind WIR; die
    Laendernummer entsteht auf unserem Account, der Enduser ist Untermieter. Die Matrix
    (4.) formuliert alle Requirements fuer den "Enduser" -- Telnyx kennt diesen nicht,
    wir reichen Drittdokumente als unsere Bestellunterlagen durch. Ob Telnyx/Regulierer
    dieses Broker-/Sub-Allocation-Modell akzeptieren, ist UNBESTAETIGT und in G0 (d) zu
    klaeren; Ergebnis vor G3 festhalten, inkl. Fehldeklarations-Folgen (Nummern-Recall,
    Account-Sperre).
    **ENTSCHEIDEN 2026-09-01:** Broker-Modell bleibt. Die G0-(d)-Klaerung ist hartes Gate
    VOR G3; Ergebnis (inkl. Fehldeklarations-Folgen) dort festhalten.
13. Traeger der Interims-Miete und Schutz der Kostendecke (Regel-Review, siehe 7d/8.):
    number_month der kind='interim'-Nummer auf der Tenant-Decke -- Meter auslassen,
    erlassen oder bewusst belasten? Und wie wird verhindert, dass der Doppel-Beleg im
    Swap-Monat budgetExceeded triggert und den Gespraechsbetrieb mitten im Swap sperrt?
    Vor G4a entscheiden.
    **ENTSCHEIDEN 2026-09-01:** Plattform traegt. Der number_month-Beleg der
    kind='interim'-Nummer wird NICHT auf die Tenant-Decke gebucht; die Doppel-Miete
    ($0.25-1.50 je Swap, siehe 8.) ist als Plattform-Broker-Kosten einkalkuliert. Damit
    kann der Doppel-Beleg budgetExceeded nicht triggern. Die Decke selbst bleibt
    unangetastet; die technische Form (Meter skippen oder auf eine Plattform-Achse buchen)
    legt G4a fest.
14. Erstattungs- und Vertragspfad bei endgueltiger Telnyx-Ablehnung (Compliance-Review):
    Der User hat ein Produkt "Laendernummer" gekauft (Abo); die Verifikation scheitert
    dauerhaft (Praesenzpflicht unerfuellbar, Dokumente wiederholt denied). Optionen:
    Teilerstattung, kostenlose Downgrade-Stufe (US-Produkt) oder Sonderkuendigungsrecht;
    plus Dashboard-/Mail-Kommunikationsfolge vor Ablauf des 14-Tage-Deckels. Sonst zieht
    die wiederkehrende Buchung unbegrenzt fuer ein nie geliefertes Produkt ab. Vor G4a
    entscheiden.
    **ENTSCHEIDEN 2026-09-01:** Keine Sonderregel. Scheitert die Verifikation dauerhaft,
    hat der User die US-Nummer (Endzustand aus 10.3); Vertrag und laufende Buchung bleiben
    unveraendert -- keine Teilerstattung, kein Sonderkuendigungsrecht, keine eigene
    Downgrade-Stufe. Konsistent, solange es keine landabhaengigen Abopreise gibt (heute ist
    holdAmountForCountry nur der Provider-Preis des Hold, nicht das Abo); sobald es
    landabhaengige Abopreise gibt, ist 10.14 neu zu stellen.
15. Herkunfts-Gate nach FORCE_NUMBER_COUNTRY-Rueckbau (Regel-Review, siehe 5./7c): Das
    Herkunfts-Gate haengt heute alleine an numberOriginDecoupled =
    Boolean(FORCE_NUMBER_COUNTRY). Entweder ein eigenes, begruendetes Decoupling-Flag mit
    Boot-Guard-Anpassung (Beruehrung nach CLAUDE.md Regel 1, dokumentiert) oder ein
    anderes Interimskonzept -- sonst verliert der GB-User auf der Interims-Nummer
    Inlandsanrufe, sobald die Allowlist gesetzt ist. Vor G4a entscheiden.
    **ENTSCHEIDEN 2026-09-01:** Die Regel wird GELOESCHT -- kein Decoupling-Flag, kein
    Ersatzkonzept. Begruendung (Owner): es gibt keinen Grund, warum eine US-Nummer keine
    normalen Auslandsanrufe (z.B. GB-Ziele) fuehren duerfte; die Kosten sind beim User
    abgebildet, und der Tarif tut das ohnehin (Auslands-Leg -> Default-Tarif,
    isDomesticLeg/tariffCentsPerMin, src/telephony/outbound-gates.js:171-189). Bleiben:
    Denylist, Land-Gate (ALLOWED_COUNTRY_CODES), Stundenlimit, Kostendecke, Outbound-Permit
    -- alle unberuehrt; das Herkunfts-Gate (GAP-19) ist ein EIGENES Gate, nicht das in
    CLAUDE.md Regel 1 geschuetzte Land-Gate. Bewusst akzeptiert: der GAP-19-Schutzzweck
    (Zustellrate/Reputation des Absenders bei Inlandszielen) entfaellt. Umsetzung als
    eigene Phase VOR G4a: foreignOriginOnHomeCall/originGateError entfernen samt der
    Gate-Haelfte von numberOriginDecoupled; der Boot-Guard-Zweig
    (warnNumberOriginDecoupled, src/boot.js:393-409) entfaellt MIT dem Gate. Damit entfaelt
    die urspruengliche Fragestellung dieses Eintrags vollstaendig.

## 11. Quellen

- Telnyx-Entwicklerdokumentation: regulatory-requirements, requirement-groups,
  number-orders, documents (je unter
  https://developers.telnyx.com/docs/numbers/phone-numbers/...),
  https://developers.telnyx.com/data/webhook-events.json, OpenAPI spec3.json
  (https://raw.githubusercontent.com/team-telnyx/openapi/master/openapi/spec3.json),
  https://developers.telnyx.com/docs/development/llms/numbers-global-phone-numbers-llms-full-txt
- Telnyx-Support: 5469551-international-numbers-required-documents,
  4277896-notification-settings, 4380325-search-and-buy-numbers,
  2819236-bulk-edit-numbers-delete-numbers, 8648864 (Zahlen-Verhalten nach Account-
  Sperre), 9801714-requirement-groups-for-ordering-phone-numbers (alle unter
  https://support.telnyx.com/en/articles/...)
- Laender-Artikel der Collection "International DID Requirements"
  (https://support.telnyx.com/en/collections/1511606-international-did-requirements):
  DE 1311450, GB 1311457, FR 1311445, AT 5463877, CH 3739580, ES 1311073, IT 1311462,
  IE 1311458, AU 3505912 (IDs der Artikel, je
  https://support.telnyx.com/en/articles/<id>-...)
- Knowledge-Base-Mirrors (team-telnyx/knowledge-base, wiki/support-docs/):
  european-did-requirements--part-1.md, did-number-requirements-by-country--part-2.md,
  did-number-requirements-by-country--part-3.md
- Preise: https://telnyx.com/pricing.md (Abschnitte je Land) und
  https://telnyx.com/pricing/numbers
- https://telnyx.com/country-specific-requirements-terms-and-conditions-of-service
- Telnyx-DPA/Drittlandtransfer: https://telnyx.com/data-transfer-impact-assessment
  ("The Telnyx DPA incorporates the SCCs"; DPA selbst auf Anfrage/Account)
- Code-Belege: alle file:line-Angaben stammen aus der Codebase-Recherche (aufgefuehrt in
  Abschnitt 2; keine selbsterfundenen Zeilenangaben). Die durch den Regel-/Pre-Mortem-Review
  hinzugekommenen Belege (outbound-gates.js Herkunfts-Gate, state-ops.js Release-Verdikt
  und Monatsmeter-Faelligkeit, metering.js, provisioning-orchestrator.js,
  release-reconcile.js, views.js, onboarding.js rollbackAfterOrder/EL-Registrierung,
  app.js BODY_LIMIT) sind jeweils am Ort ihrer Aussage geprueft und genannt.
