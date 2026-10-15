import { randomBytes } from "node:crypto";

import { starteAufzeichnendeAttrappe } from "../../test/helpers/aufzeichnende-attrappe.js";
import {
  CONVERSATION_DONE_WITH_ANALYSIS,
  CONVERSATION_IN_PROGRESS,
} from "../../test/fixtures/elevenlabs-conversations.js";
import { startExaFake } from "../../scripts/convo-bench/exa-fake.mjs";
import { HTTP_OK } from "./zugriff.mjs";

export const STEUER_PFAD_ENDE = "/hermes-ctl/ende/";
const ANRUFSTART_PFAD = "/v1/convai/sip-trunk/outbound-call";
const GESPRAECH_PFAD = "/v1/convai/conversations/";
const ZUSAMMENFASSUNG_PARAMETER = "zusammenfassung";
const HTTP_NICHT_GEFUNDEN = 404;
const HTTP_NICHT_VERFUEGBAR = 503;
const KENNUNG_BYTES = 6;
const BASIS_FUER_PFAD = "http://attrappe.invalid";
const EXA_FAKTEN = [{ title: "Bäckerei am Markt", highlight: "Mo–Fr 7–18 Uhr" }];

function gespraechFertig(kennung, zusammenfassung) {
  const analyse = { ...CONVERSATION_DONE_WITH_ANALYSIS.analysis };
  if (zusammenfassung) analyse.transcript_summary = zusammenfassung;
  return { ...CONVERSATION_DONE_WITH_ANALYSIS, conversation_id: kennung, analysis: analyse };
}

function elevenLabsAntworten() {
  const beendet = new Map();
  let zaehler = 0;
  return (pfadMitAnfrage) => {
    const adresse = new URL(pfadMitAnfrage, BASIS_FUER_PFAD);
    const pfad = adresse.pathname;
    if (pfad === ANRUFSTART_PFAD) {
      zaehler += 1;
      const kennung = `conv_hermesctl_${zaehler}_${randomBytes(KENNUNG_BYTES).toString("hex")}`;
      return {
        status: HTTP_OK,
        koerper: { success: true, conversation_id: kennung, sip_call_id: `sip_${kennung}` },
      };
    }
    if (pfad.startsWith(STEUER_PFAD_ENDE)) {
      const kennung = decodeURIComponent(pfad.slice(STEUER_PFAD_ENDE.length));
      beendet.set(kennung, adresse.searchParams.get(ZUSAMMENFASSUNG_PARAMETER) ?? "");
      return { status: HTTP_OK, koerper: { conversation_id: kennung, status: "done" } };
    }
    if (pfad.startsWith(GESPRAECH_PFAD)) {
      const kennung = decodeURIComponent(pfad.slice(GESPRAECH_PFAD.length));
      if (beendet.has(kennung))
        return { status: HTTP_OK, koerper: gespraechFertig(kennung, beendet.get(kennung)) };
      return {
        status: HTTP_OK,
        koerper: { ...CONVERSATION_IN_PROGRESS, conversation_id: kennung },
      };
    }
    return {
      status: HTTP_NICHT_GEFUNDEN,
      koerper: { detail: { status: "not_found", message: "hermes-ctl-Attrappe" } },
    };
  };
}

const sackgasse = () => ({
  status: HTTP_NICHT_VERFUEGBAR,
  koerper: { error: "hermes-ctl-Attrappe ohne Antwort" },
});

export async function attrappenStarten() {
  const elevenLabs = await starteAufzeichnendeAttrappe(elevenLabsAntworten());
  const anbieterOhneAntwort = await starteAufzeichnendeAttrappe(sackgasse);
  const exa = await startExaFake({ facts: EXA_FAKTEN });
  return {
    urls: {
      elevenLabs: elevenLabs.url,
      anbieterOhneAntwort: anbieterOhneAntwort.url,
      exa: exa.url,
    },
    async schliessen() {
      await Promise.allSettled([
        elevenLabs.schliesse(),
        anbieterOhneAntwort.schliesse(),
        exa.close(),
      ]);
    },
  };
}
