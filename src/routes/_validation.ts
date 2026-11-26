import { TEXT_LIMITS, type TextName } from "../begriffe/anruf-pruefung.ts";
export { E164, TEXT_LIMITS } from "../begriffe/anruf-pruefung.ts";
export {
  invalidText,
  invalidStringArray,
  invalidEnum,
  validateAssistantContext,
  validateMandate,
} from "../i18n/anruf-eingabe-texte.ts";
export type { TextName } from "../begriffe/anruf-pruefung.ts";
export { KEY_FACTS_LIMITS } from "../begriffe/anrufe.ts";

export const IDENTITY_MAX_LEN = 254;
export const validIdentity = (e: unknown): boolean =>
  typeof e === "string" && e.length > 0 && e.length <= IDENTITY_MAX_LEN && !/\s/.test(e);

const C0_LETZTER = 0x1f;
const DEL = 0x7f;
const C1_LETZTER = 0x9f;

function steuerzeichen(codePoint: number): boolean {
  return codePoint <= C0_LETZTER || (codePoint >= DEL && codePoint <= C1_LETZTER);
}

export function promptLineRejection(name: TextName, value: unknown): "too_long" | "control_chars" | null {
  if (typeof value !== "string") return null;
  if (Array.from(value).length > TEXT_LIMITS[name]) return "too_long";
  if (Array.from(value).some((zeichen) => steuerzeichen(zeichen.charCodeAt(0)))) return "control_chars";
  return null;
}
