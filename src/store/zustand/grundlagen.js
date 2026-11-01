const ID_RADIX = 36;
const ID_RANDOM_START = 2;
const ID_RANDOM_END = 6;

export function newId(prefix) {
  return (
    prefix +
    "_" +
    Date.now().toString(ID_RADIX) +
    Math.random().toString(ID_RADIX).slice(ID_RANDOM_START, ID_RANDOM_END)
  );
}

export const tenantsOf = (state) => state.tenants || [];
