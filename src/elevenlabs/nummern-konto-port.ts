import {
  listPhoneNumbers,
  createPhoneNumber,
  deletePhoneNumber,
  fetchPhoneNumber,
  patchPhoneNumber,
} from "./convai.ts";

interface NummernKontoPort {
  listPhoneNumbers: typeof listPhoneNumbers;
  createPhoneNumber: typeof createPhoneNumber;
  deletePhoneNumber: typeof deletePhoneNumber;
  fetchPhoneNumber: typeof fetchPhoneNumber;
  patchPhoneNumber: typeof patchPhoneNumber;
}

const ADAPTER_NUMMERN_KONTO: NummernKontoPort = Object.freeze({
  listPhoneNumbers,
  createPhoneNumber,
  deletePhoneNumber,
  fetchPhoneNumber,
  patchPhoneNumber,
});

export const elevenlabsNummernKonto = (): NummernKontoPort => ADAPTER_NUMMERN_KONTO;
