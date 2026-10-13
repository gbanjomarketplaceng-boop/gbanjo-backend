import { EmisriSmsProvider } from "./emisri.provider";
import { GatewaySmsChannel } from "./gateway-sms.channel";
import { SmsProviderError } from "./sms-provider";
import { TermiiSmsProvider } from "./termii.provider";

type Call = { url: string; init: RequestInit & { headers: Record<string, string> } };

/** Replaces global fetch with canned responses (in order) and records the requests. */
function mockFetch(...responses: Array<{ status: number; body: unknown } | Error>) {
  const calls: Call[] = [];
  jest.spyOn(global, "fetch").mockImplementation(async (url, init) => {
    calls.push({ url: String(url), init: init as Call["init"] });
    const next = responses.shift()!;
    if (next instanceof Error) throw next;
    return new Response(JSON.stringify(next.body), { status: next.status, headers: { "Content-Type": "application/json" } });
  });
  return calls;
}

const termii = () => new TermiiSmsProvider({ apiKey: "tk", senderId: "N-Alert", baseUrl: "https://api.ng.termii.com/", channel: "dnd" });
const emisri = () => new EmisriSmsProvider({ apiKey: "ek", senderId: "Aldor", baseUrl: "https://api.emisri.com/v1", excludeDnd: false });

afterEach(() => jest.restoreAllMocks());

describe("Termii", () => {
  it("posts the message in Termii's format", async () => {
    const calls = mockFetch({ status: 200, body: { code: "ok", message_id: "301", message: "Successfully Sent" } });
    await expect(termii().send("+2349045654356", "Your code is 1234")).resolves.toEqual({ messageId: "301" });
    expect(calls[0].url).toBe("https://api.ng.termii.com/api/sms/send");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ api_key: "tk", to: "2349045654356", from: "N-Alert", sms: "Your code is 1234", type: "plain", channel: "dnd" });
  });

  it("reports refusals (bad key isn't worth retrying)", async () => {
    mockFetch({ status: 401, body: { message: "Invalid API key" } });
    const err = await termii().send("+2349045654356", "x").catch((e: SmsProviderError) => e);
    expect(err).toBeInstanceOf(SmsProviderError);
    expect(err).toMatchObject({ message: "termii: Invalid API key", status: 401, retryable: false });
  });
});

describe("Emisri", () => {
  it("posts with the X-Emisri-Api-Key header", async () => {
    const calls = mockFetch({ status: 200, body: { success: true, data: { campaignId: "c1", summary: { totalRecipients: 1, validDestination: 1, invalidDestination: 0 } } } });
    await expect(emisri().send("+2349045654356", "Hi")).resolves.toEqual({ messageId: "c1" });
    expect(calls[0].url).toBe("https://api.emisri.com/v1/sms/send");
    expect(calls[0].init.headers["X-Emisri-Api-Key"]).toBe("ek");
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({ sender: "Aldor", text: "Hi", destination: ["2349045654356"], options: { excludeDnd: false } });
  });

  it("treats a rejected number as a failure", async () => {
    mockFetch({ status: 200, body: { success: true, data: { campaignId: "c1", summary: { validDestination: 0, invalidDestination: 1 } } } });
    await expect(emisri().send("+2349045654356", "Hi")).rejects.toThrow("rejected");
  });
});

describe("Fallback", () => {
  it("tries the next gateway when the first fails", async () => {
    const calls = mockFetch({ status: 500, body: { message: "down" } }, { status: 200, body: { success: true, data: { campaignId: "c9" } } });
    await new GatewaySmsChannel([termii(), emisri()]).send("+2349045654356", "Hi");
    expect(calls.map((c) => new URL(c.url).host)).toEqual(["api.ng.termii.com", "api.emisri.com"]);
  });

  it("throws (so the queue retries) when every gateway fails", async () => {
    mockFetch(new TypeError("network"), { status: 503, body: {} });
    await expect(new GatewaySmsChannel([termii(), emisri()]).send("+2349045654356", "Hi")).rejects.toThrow(/termii: couldn't connect.*emisri: HTTP 503/);
  });
});
