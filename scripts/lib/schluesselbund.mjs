import { execFileSync } from "node:child_process";
import { userInfo } from "node:os";

const PLATTFORM_MAC = "darwin";
const SCHLUESSELBUND_FRIST_MS = 5000;

export const SCHLUESSELBUND_DIENST = "elevenlabs";
export const UEBERNAHME_BEFEHL = "npm run elevenlabs:uebernehmen";
export const SCHLUESSELBUND_HINWEIS =
  `Quellen: Umgebungsvariable ELEVENLABS_API_KEY, dann macOS-Schluesselbund (Dienst "${SCHLUESSELBUND_DIENST}"). ` +
  `Einmalig den Schluessel aus der .env uebernehmen: ${UEBERNAHME_BEFEHL}`;

function sicherheitsAufruf(argumente, ausfuehren) {
  return ausfuehren("security", argumente, {
    encoding: "utf8",
    timeout: SCHLUESSELBUND_FRIST_MS,
    stdio: ["ignore", "pipe", "ignore"],
  });
}

export function elevenLabsSchluessel(konfigWert, { plattform = process.platform, ausfuehren = execFileSync } = {}) {
  if ((konfigWert ?? "").trim()) return konfigWert;
  if (plattform !== PLATTFORM_MAC) return "";
  try {
    return String(sicherheitsAufruf(["find-generic-password", "-s", SCHLUESSELBUND_DIENST, "-w"], ausfuehren)).trim();
  } catch {
    return "";
  }
}

export function hinterlegeElevenLabsSchluessel(wert, { benutzer = userInfo().username, ausfuehren = execFileSync } = {}) {
  sicherheitsAufruf(["add-generic-password", "-U", "-s", SCHLUESSELBUND_DIENST, "-a", benutzer, "-w", wert], ausfuehren);
}
