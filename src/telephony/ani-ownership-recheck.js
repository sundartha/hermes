import { defaultSetTimer } from "../utils/timer.js";
import { kontoBesitzt } from "./outbound-config-drift.ts";

export const ANI_RECHECK_TIMEOUT_MS = 4000;

function mitTimeout({ promise, timeoutMs, setTimer, clearTimer }) {
  return new Promise((resolve, reject) => {
    const timer = setTimer(() => {
      reject(Object.assign(new Error("ani-ownership-recheck: Timeout"), { name: "TimeoutError" }));
    }, timeoutMs);
    promise.then(
      (wert) => {
        clearTimer(timer);
        resolve(wert);
      },
      (err) => {
        clearTimer(timer);
        reject(err);
      },
    );
  });
}

export function makeAniOwnershipRecheck({ telnyxRead, timeoutMs = ANI_RECHECK_TIMEOUT_MS, setTimer = defaultSetTimer, clearTimer = clearTimeout }) {
  return async function aniOwnershipRecheck(e164) {
    if (!e164) return null;
    const antwort = await mitTimeout({ promise: telnyxRead.findPhoneNumber(e164), timeoutMs, setTimer, clearTimer });
    const status = kontoBesitzt({ ok: true, wert: antwort }, e164);
    if (status === "unbekannt") return null;
    return status === "verloren";
  };
}
