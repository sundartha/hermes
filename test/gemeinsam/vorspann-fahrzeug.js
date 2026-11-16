const SCHALTER = ["ELEVENLABS_OUTBOUND_ENABLED", "ELEVENLABS_OUTBOUND_UEBER_TELNYX", "ELEVENLABS_OUTBOUND_VORSPANN"];
const SIGNATUR = ["SKIP_TWILIO_SIGNATURE_CHECK", "TELNYX_PUBLIC_KEY", "PUBLIC_URL"];
const EIGENE_WEGE = ["ELEVENLABS_API_BASE", "TELNYX_API_BASE", "FAKE_ORIGINATE_ELEVENLABS"];
const KENNUNG = "fahrzeug";
const AUDIO_TYP = "audio/mpeg";

export function vorspannDiAttrappe() {
  const gewaehlt = [];
  return {
    erzeugeVorspann: async () => ({ text: "Vorspann-Attrappe", audio: { bytes: Buffer.alloc(1, 1), contentType: AUDIO_TYP } }),
    vorspannAblauf: {
      pruefe: async () => ({ grund: null }),
      waehle: async ({ call }) => {
        gewaehlt.push(call.id);
        return { callControlId: `cc_callee_${call.id}` };
      },
      behandle: async () => {},
      gesagterText: () => undefined,
    },
    gewaehlt,
  };
}

export function vorspannSeedNummer({
  tenantId,
  nummer,
  id = `num_${tenantId}`,
  registrierung = `phnum_${tenantId}`,
  anbieter = "telnyx",
}) {
  return {
    id,
    e164: nummer,
    tenantId,
    provider: anbieter,
    status: "active",
    providerNumberId: null,
    providerAgentPhoneNumberId: registrierung,
  };
}

const schaltetVorspannEin = (env) => env.ELEVENLABS_OUTBOUND_VORSPANN === "true";
const hatEigenenWeg = (env) => EIGENE_WEGE.some((schluessel) => schluessel in env);

export async function vorspannFuerStart(env) {
  if (!schaltetVorspannEin(env) || hatEigenenWeg(env)) return { env, close: async () => {} };
  const { starteAttrappe, vorspannUmgebung, makeTelnyxSigner } = await import("../anrufe/el-bein-attrappe.js");
  const attrappe = await starteAttrappe();
  const vollstaendig = vorspannUmgebung({ attrappe, signer: makeTelnyxSigner(), publicUrl: "", kennung: KENNUNG });
  const ausgenommen = new Set([...SCHALTER, ...SIGNATUR]);
  const ergaenzung = Object.fromEntries(Object.entries(vollstaendig).filter(([schluessel]) => !ausgenommen.has(schluessel)));
  return { env: { ...ergaenzung, ...env }, attrappe, close: () => attrappe.close() };
}
