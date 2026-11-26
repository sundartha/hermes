import { execFileSync } from "node:child_process";

const PLATTFORM_MAC = "darwin";
const SCHLUESSELBUND_FRIST_MS = 5000;

export const SCHLUESSELBUND_HINWEIS =
  'Einmal im Schluesselbund hinterlegen: security add-generic-password -s elevenlabs -a "$USER" -w';

export function elevenLabsSchluessel(konfigWert, { plattform = process.platform, ausfuehren = execFileSync } = {}) {
  if ((konfigWert ?? "").trim()) return konfigWert;
  if (plattform !== PLATTFORM_MAC) return "";
  try {
    const ausgabe = ausfuehren("security", ["find-generic-password", "-s", "elevenlabs", "-w"], {
      encoding: "utf8",
      timeout: SCHLUESSELBUND_FRIST_MS,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return String(ausgabe).trim();
  } catch {
    return "";
  }
}
