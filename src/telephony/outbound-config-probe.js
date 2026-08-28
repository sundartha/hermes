// OUTBOUND-E4: holt die neun Messwerte. KEINE Entscheidung - jede Abfrage wird zu
// {ok:true,wert} oder {ok:false,grund}. Ein Anbieterfehler ist hier ein DATUM, kein Wurf:
// genau so wird aus "konnte nicht pruefen" spaeter ein gezaehlter unknown-Befund und
// nicht ein stilles Gruen (PM-16). NUR LESEND: telnyxRead/elRead sind der schmale,
// rein-lesende Read-Port (src/telephony/ports.js#ProviderConfigRead,
// src/elevenlabs/convai.js#fetchPhoneNumber) - kein Methodenname hier ruft je etwas
// anderes als GET.
//
// Reihenfolge ist NICHT beliebig: Pruefung 3 (Kontoeigentum der ANI) braucht den
// ani_override-Wert aus Pruefung 2 (Connection) - deshalb laufen connection und
// aniKontotreffer sequenziell, alles andere unabhaengig parallel (Promise.all).
//
// Ein fehlendes Pflichtfeld in `soll` (leere ID) ist KEIN Anbieterfehler - die Abfrage
// wird gar nicht erst gestellt (kein GET auf eine leere ID), sie liefert sofort
// {ok:false, grund:"soll_fehlt"}, damit der Kern daraus einen eigenen unknown-Befund macht.

const HTTP_NOT_FOUND = 404;
const HTTP_TOO_MANY_REQUESTS = 429;

function grundFuerFehler(err) {
  if (err?.name === "TimeoutError" || err?.name === "AbortError") return "timeout";
  const status = err?.providerStatus;
  if (status === HTTP_NOT_FOUND) return "http_404";
  if (status === HTTP_TOO_MANY_REQUESTS) return "http_429";
  if (typeof status === "number") return `http_${status}`;
  return "netz";
}

async function attempt(fn) {
  try {
    return { ok: true, wert: await fn() };
  } catch (err) {
    return { ok: false, grund: grundFuerFehler(err) };
  }
}

function fehltAls(grund = "soll_fehlt") {
  return Promise.resolve({ ok: false, grund });
}

// Pruefung 1 (EL): elRead.fetchPhoneNumber liefert den ROHEN Anbieter-Body (Muster
// fetchConversation) - die Projektion auf unser Vokabular passiert HIER, nicht im
// gemeinsam genutzten convai.js-Modul.
function projiziereElNummer(antwort) {
  return {
    e164: antwort?.phone_number || null,
    agentId: antwort?.assigned_agent?.agent_id || null,
    supportsOutbound: antwort?.supports_outbound,
  };
}

async function holeElNummer({ elRead, soll }) {
  if (!soll.elPhoneNumberId) return fehltAls();
  return attempt(async () => projiziereElNummer(await elRead.fetchPhoneNumber(soll.elPhoneNumberId)));
}

async function holeConnection({ telnyxRead, soll }) {
  if (!soll.fqdnConnectionId) return fehltAls();
  return attempt(() => telnyxRead.getFqdnConnection(soll.fqdnConnectionId));
}

async function holeAniKontotreffer({ telnyxRead, nAni }) {
  if (!nAni) return fehltAls();
  return attempt(() => telnyxRead.findPhoneNumber(nAni));
}

async function holeVerifizierte({ telnyxRead }) {
  return attempt(() => telnyxRead.listVerifiedNumbers());
}

async function holeFqdns({ telnyxRead, soll }) {
  if (!soll.fqdnConnectionId) return fehltAls();
  return attempt(() => telnyxRead.listFqdns());
}

async function holeOvp({ telnyxRead, soll }) {
  if (!soll.ovpId) return fehltAls();
  return attempt(() => telnyxRead.getOutboundVoiceProfile(soll.ovpId));
}

// Pruefung 8: GET /v2/balance liefert nur availableCreditMicroCents; der 24h-Verbrauch
// ist KEIN Anbieter-Aufruf, sondern eine Store-Query des Aufrufers (der In-Prozess-
// Waechter hat den Store, der CLI-Weg nicht - s. outbound-drift-ausnahmen.json fuer
// Pruefung 8/9). Deshalb reist er ueber `soll` mit, statt hier gefetcht zu werden.
async function holeBalance({ telnyxRead, soll }) {
  const antwort = await attempt(() => telnyxRead.getBalance());
  if (!antwort.ok) return antwort;
  return {
    ok: true,
    wert: {
      availableCreditMicroCents: antwort.wert.availableCreditMicroCents,
      verbrauch24hMicroCents: soll.verbrauch24hMicroCents,
    },
  };
}

async function holeAlertSenderKontotreffer({ telnyxRead, soll }) {
  if (!soll.alertSenderE164) return fehltAls();
  return attempt(() => telnyxRead.findPhoneNumber(soll.alertSenderE164));
}

export async function messeAnbieterWirklichkeit({ telnyxRead, elRead, soll }) {
  const [elNummer, connection] = await Promise.all([
    holeElNummer({ elRead, soll }),
    holeConnection({ telnyxRead, soll }),
  ]);
  const nAni = connection.ok ? connection.wert.aniOverride : null;
  const [aniKontotreffer, verifizierte, fqdns, ovp, balance, alertSenderKontotreffer] = await Promise.all([
    holeAniKontotreffer({ telnyxRead, nAni }),
    holeVerifizierte({ telnyxRead }),
    holeFqdns({ telnyxRead, soll }),
    holeOvp({ telnyxRead, soll }),
    holeBalance({ telnyxRead, soll }),
    holeAlertSenderKontotreffer({ telnyxRead, soll }),
  ]);
  return { elNummer, connection, aniKontotreffer, verifizierte, fqdns, ovp, balance, alertSenderKontotreffer };
}
