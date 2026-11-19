import { randomInt } from "node:crypto";

const ID_RADIX = 36;
const ID_RANDOM_LENGTH = 4;
const ID_RANDOM_RANGE = ID_RADIX ** ID_RANDOM_LENGTH;

export function newId(prefix: string): string {
  return (
    prefix +
    "_" +
    Date.now().toString(ID_RADIX) +
    randomInt(ID_RANDOM_RANGE)
      .toString(ID_RADIX)
      .padStart(ID_RANDOM_LENGTH, "0")
  );
}

export interface MandantRef {
  id: string;
  idpSubject?: string | undefined;
}

export interface AnrufRef {
  id: string;
  twilioSid?: string | undefined;
}

export const tenantsOf = <T>(state: { tenants?: T[] | undefined }): T[] => state.tenants ?? [];

export function getCall<T extends AnrufRef>(state: { calls: T[] }, id: string): T | null {
  return state.calls.find((call) => call.id === id || call.twilioSid === id) ?? null;
}
