export function makeStubGeoLookup(
  table: Record<string, string> = {},
): (ip: string) => { country: string } | null {
  return (ip) => {
    const country = table[ip];
    return country ? { country } : null;
  };
}

export const nullGeoLookup = (): null => null;
