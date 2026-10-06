export const STT_PROFILE = Object.freeze({
  ACCURATE: "accurate",
});

export const DEFAULT_STT_PROFILE = STT_PROFILE.ACCURATE;

export function isSttProfile(value) {
  return Object.values(STT_PROFILE).includes(value);
}
