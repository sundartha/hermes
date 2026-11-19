const ID_RADIX = 36;
const ID_RANDOM_START = 2;
const ID_RANDOM_END = 6;

export function newId(prefix: string): string {
  return (
    prefix +
    "_" +
    Date.now().toString(ID_RADIX) +
    Math.random().toString(ID_RADIX).slice(ID_RANDOM_START, ID_RANDOM_END)
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
