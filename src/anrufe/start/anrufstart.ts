import { z } from "zod";

const NICHT_LEER = z.string().min(1).brand<"NichtLeer">();
export type NichtLeer = z.infer<typeof NICHT_LEER>;

export const nichtLeer = (text: string): NichtLeer => NICHT_LEER.parse(text);

interface Sprachen {
  language: string;
  providerLanguage: string;
  disclosureLanguage: string;
  voiceId: string;
}

export interface AnrufStartEingabe {
  sprachen: Sprachen;
  dritt: string;
  ownerEroeffnung: string;
  eroeffnungGesagt: boolean;
  folgesatz: string;
  eingehend?: boolean | undefined;
}

interface Override {
  agent: { language: string; first_message?: string };
  tts?: { voice_id: string };
}

interface Gemeinsam {
  sprache: string;
  offenlegungssprache: string;
  eroeffnung: string;
  firstMessage: string | null;
  override: Override;
}

export type AnrufStart =
  | (Gemeinsam & { sprecher: "vorspann"; folgesatz: NichtLeer })
  | (Gemeinsam & { sprecher: "agent" });

function overrideVon({ language, voiceId }: { language: string; voiceId: string }, firstMessage: string | null): Override {
  return {
    agent: { language, ...(firstMessage === null ? {} : { first_message: firstMessage }) },
    ...(voiceId ? { tts: { voice_id: voiceId } } : {}),
  };
}

export function anrufStart({ sprachen, dritt, ownerEroeffnung, eroeffnungGesagt, folgesatz, eingehend }: AnrufStartEingabe): AnrufStart {
  const gemeinsam = { sprache: sprachen.language, offenlegungssprache: sprachen.disclosureLanguage };
  const providerSprache = { language: sprachen.providerLanguage, voiceId: sprachen.voiceId };
  if (eroeffnungGesagt) {
    const nachVorspann = nichtLeer(folgesatz);
    return { ...gemeinsam, sprecher: "vorspann", folgesatz: nachVorspann, eroeffnung: "", firstMessage: nachVorspann, override: overrideVon(providerSprache, nachVorspann) };
  }
  const gleicheSprache = sprachen.providerLanguage === sprachen.disclosureLanguage && !eingehend;
  const erste = ownerEroeffnung || (gleicheSprache ? "" : dritt) || null;
  return { ...gemeinsam, sprecher: "agent", eroeffnung: ownerEroeffnung || dritt, firstMessage: erste, override: overrideVon(providerSprache, erste) };
}
