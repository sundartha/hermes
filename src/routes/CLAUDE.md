## Bausteine in diesem Ordner (erzeugt aus tools/bausteine.json mit npm run hinweise)
- mcp: intern-probe-mcp.js, mcp.js. Zweck und Darf nutzen: stehen in `src/mcp/CLAUDE.md`, dem ersten Ordner von mcp. Eingang: intern-probe-mcp.js.
- betrieb: _validation.ts, api-deploy-info.js, bearer-schluessel.js, intern-anrufe-laufend.js, intern-anrufpause.js, intern-status.js. Zweck: Interne Betriebsrouten (Deploy-Info, Anrufpause, laufende Anrufe) und Eingabeprüfung. Darf nutzen: basis, begriffe, konfiguration, speicher, texte, mail, sperrdaten, rueckfrage, posteingang, abrechnung, nummern, anmeldung, selbstbedienung, anrufe. Eingang: _validation.ts, bearer-schluessel.js, intern-anrufe-laufend.js, intern-anrufpause.js, intern-status.js.
- posteingang: api-inbox.ts. Zweck: Posteingang und Zusammenfassungen nach dem Anruf. Darf nutzen: basis, begriffe, konfiguration, speicher, texte, mail, sperrdaten. Eingang: kein Eingang hier.
- abrechnung: api-billing.ts, stripe-webhook.ts. Zweck und Darf nutzen: stehen in `src/billing/CLAUDE.md`, dem ersten Ordner von abrechnung. Eingang: stripe-webhook.ts.
- anmeldung: _tenant.js. Zweck und Darf nutzen: stehen in `src/wiring/CLAUDE.md`, dem ersten Ordner von anmeldung. Eingang: _tenant.js.
- selbstbedienung: api-onboard.js. Zweck und Darf nutzen: stehen in `src/geo/CLAUDE.md`, dem ersten Ordner von selbstbedienung. Eingang: kein Eingang hier.
- anrufe: _call-request.ts, api-calls.ts, api-read.ts, voice.ts, webhooks-elevenlabs-init.ts, webhooks-elevenlabs.ts. Zweck und Darf nutzen: stehen in `src/telephony/CLAUDE.md`, dem ersten Ordner von anrufe. Eingang: webhooks-elevenlabs-init.ts.
- Ort für Neues: Neue Route mit `npm run neu -- route <baustein> <name>`; der Baustein steht in tools/bausteine.json.
