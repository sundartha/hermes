let abgewiesen = 0;

export function zaehleAbgewiesenenWebhook(): void {
  abgewiesen += 1;
}

export function abgewieseneWebhooks(): number {
  return abgewiesen;
}
