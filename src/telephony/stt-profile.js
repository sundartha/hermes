export const STT_PROFILE = Object.freeze({
  ACCURATE: "accurate",
});

export const DEFAULT_STT_PROFILE = STT_PROFILE.ACCURATE;

export function isSttProfile(value) {
  const werte = Object.values(STT_PROFILE);
  return werte.includes(value);
}
