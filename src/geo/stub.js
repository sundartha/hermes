export function makeStubGeoLookup(table = {}) {
  return (ip) => {
    const country = table[ip];
    return country ? { country } : null;
  };
}

export const nullGeoLookup = () => null;
