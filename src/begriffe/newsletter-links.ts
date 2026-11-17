export function newsletterConfirmUrl(publicUrl: string, confirmToken: string): string {
  return `${publicUrl}/newsletter/confirm?token=${confirmToken}`;
}

export function newsletterUnsubscribeUrl(publicUrl: string, unsubToken: string): string {
  return `${publicUrl}/newsletter/unsubscribe?token=${unsubToken}`;
}
