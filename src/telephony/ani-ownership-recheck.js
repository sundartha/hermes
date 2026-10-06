import { kontoBesitzt } from "./outbound-config-drift.js";

export const ANI_RECHECK_TIMEOUT_MS = 4000;

function mitTimeout(promise, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(Object.assign(new Error("ani-ownership-recheck: Timeout"), { name: "TimeoutError" }));
    }, timeoutMs);
    promise.then(
      (wert) => {
        clearTimeout(timer);
        resolve(wert);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export function makeAniOwnershipRecheck({ telnyxRead, timeoutMs = ANI_RECHECK_TIMEOUT_MS }) {
  return async function aniOwnershipRecheck(e164) {
    if (!e164) return null;
    const antwort = await mitTimeout(telnyxRead.findPhoneNumber(e164), timeoutMs);
    const status = kontoBesitzt({ ok: true, wert: antwort }, e164);
    if (status === "unbekannt") return null;
    return status === "verloren";
  };
}
