/** One SMS gateway (Termii, Emisri, …). */
export interface SmsProvider {
  /** Shown in logs, e.g. "termii". */
  readonly name: string;
  /** `to` is +234XXXXXXXXXX. Resolves with the provider's message id; throws SmsProviderError when not accepted. */
  send(to: string, message: string): Promise<{ messageId?: string }>;
}

/** The provider refused or couldn't be reached. `retryable` is false for problems a retry won't fix (bad key, no balance…). */
export class SmsProviderError extends Error {
  constructor(
    readonly provider: string,
    message: string,
    readonly status?: number,
    readonly retryable = true,
  ) {
    super(`${provider}: ${message}`);
  }
}

/** +2349045654356 → 2349045654356 (what both gateways expect). */
export const toInternational = (phone: string) => phone.replace(/\D/g, "");

/** +2349045654356 → +234*******56 for logs. */
export const maskForLog = (phone: string) => `${phone.slice(0, 4)}${"*".repeat(Math.max(phone.length - 6, 3))}${phone.slice(-2)}`;

/** POST JSON with a timeout; returns status + parsed body (or {} when the body isn't JSON). */
export async function postJson(provider: string, url: string, body: unknown, headers: Record<string, string> = {}, timeoutMs = 10_000) {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    throw new SmsProviderError(provider, e instanceof Error && e.name === "TimeoutError" ? "timed out" : "couldn't connect");
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, data };
}
