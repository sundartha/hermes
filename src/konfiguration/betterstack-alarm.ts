export function leseBetterStackAlertUrl(env: { BETTERSTACK_ALERT_URL?: string | undefined }) {
  return env.BETTERSTACK_ALERT_URL ?? "";
}
