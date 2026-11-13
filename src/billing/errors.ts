export class CustomerMissingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CustomerMissingError";
  }
}

export class PaymentAuthenticationRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentAuthenticationRequiredError";
  }
}
