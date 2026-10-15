/** What a card-payment gateway must do. Flutterwave in real use; a built-in test checkout for local work. */
export abstract class PaymentProvider {
  /** "flutterwave" | "test" — stored on each payment. */
  abstract readonly name: string;

  /** Creates the hosted payment page and returns its link. */
  abstract initialize(input: InitializePayment): Promise<{ checkoutUrl: string }>;

  /**
   * Asks the gateway what happened. Pass the gateway's transaction id when known (from the redirect or webhook),
   * otherwise it looks the payment up by our reference. Returns null when the gateway has no such payment yet.
   */
  abstract verify(reference: string, transactionId?: string): Promise<VerifiedPayment | null>;

  /** Refunds part or all of a paid transaction back to the card. Throws if the gateway refuses. */
  abstract refund(transactionId: string, amount: number): Promise<void>;
}

export interface InitializePayment {
  reference: string;
  amount: number;
  currency: string;
  /** Where the gateway sends the shopper afterwards (our /payments/flutterwave/return). */
  redirectUrl: string;
  customer: { email: string; name: string; phone?: string | null };
  title: string;
  description: string;
  /** card | bank-transfer | ussd — limits the options on the payment page; omit for all. */
  method?: string;
  meta?: Record<string, string>;
}

export interface VerifiedPayment {
  transactionId: string;
  reference: string;
  /** successful | failed | pending | cancelled (gateway wording, lower-cased). */
  status: string;
  amount: number;
  currency: string;
}
