import { localeFor } from "./locales.ts";

export function textePaketFuer(call: { language?: string | undefined }): ReturnType<typeof localeFor> {
  return localeFor(call.language);
}
