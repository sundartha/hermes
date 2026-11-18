export function leseBetterStackAlertUrl(env: { BETTERSTACK_ALERT_URL?: string | undefined }): string {
  return env.BETTERSTACK_ALERT_URL ?? "";
}
