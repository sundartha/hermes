import { inboundTrunkSchreiberWennErlaubt, sipRegistrarWennAktiv } from "./nummern-registrierung.ts";

interface NummernPort {
  sipRegistrarWennAktiv: typeof sipRegistrarWennAktiv;
  inboundTrunkSchreiberWennErlaubt: typeof inboundTrunkSchreiberWennErlaubt;
}

const ADAPTER_NUMMERN: NummernPort = Object.freeze({ sipRegistrarWennAktiv, inboundTrunkSchreiberWennErlaubt });

export const elevenlabsNummern = (): NummernPort => ADAPTER_NUMMERN;
