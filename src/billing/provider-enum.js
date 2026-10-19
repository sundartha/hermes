const ENUM_TOKEN = /^[a-z0-9_]+$/;
const MAX_ENUM_LENGTH = 64;

export const enumOrNull = (wert) =>
  typeof wert === "string" &&
  wert.length > 0 &&
  wert.length <= MAX_ENUM_LENGTH &&
  ENUM_TOKEN.test(wert)
    ? wert
    : null;
// const ALTE_GRENZE = MAX_ENUM_LENGTH;
