import { fetchConversation, listConversations, listPhoneNumbers } from "../src/elevenlabs/convai.js";
import { registrierungenMitNummer } from "../src/elevenlabs/nummern-registrierung.js";
import { EXIT, jaNein } from "./iel-geheimnisse-ausgabe.mjs";

const TENANT_TOKEN = "tenant_token";
const INBOUND_SITUATION = "inbound_situation";
const CALL_BINDING = "sip_hermes_call_binding";
export const BELEG_VARIABLEN = Object.freeze([TENANT_TOKEN, INBOUND_SITUATION, CALL_BINDING]);
const GEHEIME_BELEG_VARIABLEN = Object.freeze([TENANT_TOKEN, CALL_BINDING]);
export const ERSTE_ZEILE_MAX_ZEICHEN = 80;
export const RICHTUNGEN = Object.freeze(["inbound", "outbound"]);
const KONVERSATIONEN_SEITE = 100;
const MS_JE_S = 1000;
const AGENT_ROLLE = "agent";
const LISTEN_TRENNER = ", ";
const OHNE_WERT = "-";
const UNTERBRECHUNG_FEHLT = "fehlt";

export async function laufeConversationBeleg({ argumente, abh }) {
  const { waechter } = abh;
  const gefunden = await neuesteConversation({ abh, richtung: argumente.richtung, seitMs: argumente.seitMs });
  if (gefunden.befund) {
    waechter.fehler(`CONVERSATION-BELEG ROT - ${gefunden.befund}`);
    return EXIT.ROT;
  }
  const registrierung = await registrierungFuer({ abh, nummern: argumente.nummern });
  if (registrierung.befund) {
    waechter.fehler(`CONVERSATION-BELEG ROT - ${registrierung.befund}`);
    return EXIT.ROT;
  }
  const conversation = await fetchConversation({
    fetchImpl: abh.fetchImpl,
    account: abh.elKonto,
    conversationId: gefunden.eintrag.conversation_id,
  });
  meldeBeleg({ abh, conversation, registrierungId: registrierung.id });
  return EXIT.GRUEN;
}

async function neuesteConversation({ abh, richtung, seitMs }) {
  const antwort = await listConversations({
    fetchImpl: abh.fetchImpl,
    account: abh.elKonto,
    query: {
      agent_id: abh.elKonto.agentId,
      call_start_after_unix: String(Math.floor(seitMs / MS_JE_S)),
      page_size: String(KONVERSATIONEN_SEITE),
    },
  });
  if (antwort?.has_more) return { befund: "Conversation-Liste unvollstaendig (has_more) - --seit enger setzen" };
  const passende = (antwort?.conversations ?? [])
    .filter((eintrag) => eintrag.direction === richtung)
    .sort((frueher, spaeter) => spaeter.start_time_unix_secs - frueher.start_time_unix_secs);
  if (passende.length === 0) return { befund: `keine Conversation der Richtung ${richtung} seit ${new Date(seitMs).toISOString()}` };
  return { eintrag: passende[0] };
}

async function registrierungFuer({ abh, nummern }) {
  if (nummern.length === 0) return { id: undefined };
  const liste = await listPhoneNumbers({ fetchImpl: abh.fetchImpl, account: abh.elKonto });
  const treffer = registrierungenMitNummer(Array.isArray(liste) ? liste : [], nummern[0]);
  if (treffer.length !== 1) return { befund: `${treffer.length} Registrierungen fuer die Nummer (erwartet genau eine)` };
  return { id: treffer[0].phone_number_id };
}

export function variablenBeleg(dynamicVariables) {
  const variablen = dynamicVariables ?? {};
  return {
    variablen: BELEG_VARIABLEN.map((name) => {
      const text = String(variablen[name] ?? "");
      return { name, vorhanden: Object.hasOwn(variablen, name), leer: text === "", laenge: text.length };
    }),
    inboundSituationLeer: variablen[INBOUND_SITUATION] === "",
    uebrigeNamen: Object.keys(variablen)
      .filter((name) => !BELEG_VARIABLEN.includes(name))
      .sort(),
  };
}

export function ersteAgentZeile(transcript) {
  return transcriptZeilen(transcript).find((zeile) => istAgentEintrag(zeile) && zeile.message)?.message ?? null;
}

export function ersterAgentEintragUnterbrochen(transcript) {
  const unterbrochen = transcriptZeilen(transcript).find(istAgentEintrag)?.interrupted;
  return typeof unterbrochen === "boolean" ? jaNein(unterbrochen) : UNTERBRECHUNG_FEHLT;
}

function transcriptZeilen(transcript) {
  return Array.isArray(transcript) ? transcript : [];
}

function istAgentEintrag(zeile) {
  return zeile?.role === AGENT_ROLLE;
}

function meldeBeleg({ abh, conversation, registrierungId }) {
  const variablen = conversation?.conversation_initiation_client_data?.dynamic_variables ?? {};
  GEHEIME_BELEG_VARIABLEN.forEach((name) => abh.waechter.verbiete(variablen[name]));
  meldeKopf({ waechter: abh.waechter, conversation, registrierungId });
  meldeVariablen(abh.waechter, variablen);
  meldeErsteAgentZeile(abh.waechter, conversation?.transcript);
  meldeUnterbrechung(abh.waechter, conversation?.transcript);
}

function oderStrich(wert) {
  return wert ?? OHNE_WERT;
}

function meldeKopf({ waechter, conversation, registrierungId }) {
  const metadata = conversation?.metadata ?? {};
  const telefonat = metadata.phone_call ?? {};
  waechter.info(
    `conversation_id ${oderStrich(conversation?.conversation_id)}, direction ${oderStrich(telefonat.direction)}, ` +
      `status ${oderStrich(conversation?.status)}, call_duration_secs ${oderStrich(metadata.call_duration_secs)}`,
  );
  if (registrierungId !== undefined) {
    waechter.info(`phone_number_id == Registrierung: ${jaNein(telefonat.phone_number_id === registrierungId)}`);
  }
}

function meldeVariablen(waechter, variablen) {
  const beleg = variablenBeleg(variablen);
  for (const eintrag of beleg.variablen) {
    waechter.info(
      `Variable ${eintrag.name}: vorhanden: ${jaNein(eintrag.vorhanden)}, leer: ${jaNein(eintrag.leer)}, Laenge ${eintrag.laenge}`,
    );
  }
  waechter.info(`${INBOUND_SITUATION} == "": ${jaNein(beleg.inboundSituationLeer)}`);
  waechter.info(`uebrige dynamic_variables (nur Namen): ${beleg.uebrigeNamen.join(LISTEN_TRENNER) || OHNE_WERT}`);
}

function meldeErsteAgentZeile(waechter, transcript) {
  const zeile = ersteAgentZeile(transcript);
  if (zeile === null) waechter.info(`erste Agent-Zeile: ${OHNE_WERT}`);
  else waechter.infoGekuerzt({ kopf: "erste Agent-Zeile: ", text: zeile, maxZeichen: ERSTE_ZEILE_MAX_ZEICHEN });
}

function meldeUnterbrechung(waechter, transcript) {
  waechter.info(`erste Agent-Zeile unterbrochen: ${ersterAgentEintragUnterbrochen(transcript)}`);
}
