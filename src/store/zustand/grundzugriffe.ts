export interface MandantRef {
  id: string;
  idpSubject?: string | null;
}

export interface AnrufRef {
  id: string;
  twilioSid?: string | null;
}

export const tenantsOf = <T>(state: { tenants?: T[] }): T[] => state.tenants ?? [];

export function getCall<T extends AnrufRef>(state: { calls: T[] }, id: string): T | null {
  return state.calls.find((call) => call.id === id || call.twilioSid === id) ?? null;
}
