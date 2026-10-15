import { FlutterwaveProvider } from "./flutterwave.provider";

describe("FlutterwaveProvider", () => {
  const fw = new FlutterwaveProvider("FLWSECK_TEST-abc", "https://api.flutterwave.com/v3/");
  let fetchMock: jest.SpyInstance;
  const reply = (body: unknown, status = 200) => fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));

  beforeEach(() => {
    fetchMock = jest.spyOn(global, "fetch");
  });
  afterEach(() => fetchMock.mockRestore());

  it("creates a hosted payment link with the secret key and the chosen option", async () => {
    reply({ status: "success", message: "Hosted Link", data: { link: "https://checkout.flutterwave.com/v3/hosted/pay/abc" } });
    const res = await fw.initialize({
      reference: "GBJ-1",
      amount: 5000,
      currency: "NGN",
      redirectUrl: "https://api.example/api/v1/payments/flutterwave/return",
      customer: { email: "a@b.com", name: "Ada Obi", phone: "+2348031234567" },
      title: "Gbanjo",
      description: "Top-up",
      method: "bank-transfer",
    });
    expect(res.checkoutUrl).toBe("https://checkout.flutterwave.com/v3/hosted/pay/abc");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.flutterwave.com/v3/payments");
    expect(init.headers.Authorization).toBe("Bearer FLWSECK_TEST-abc");
    expect(JSON.parse(init.body)).toMatchObject({
      tx_ref: "GBJ-1",
      amount: 5000,
      currency: "NGN",
      payment_options: "banktransfer",
      customer: { email: "a@b.com", name: "Ada Obi", phonenumber: "+2348031234567" },
    });
  });

  it("fails clearly when Flutterwave refuses", async () => {
    reply({ status: "error", message: "Invalid key", data: null }, 401);
    await expect(fw.initialize({ reference: "x", amount: 1, currency: "NGN", redirectUrl: "u", customer: { email: "e", name: "n" }, title: "t", description: "d" })).rejects.toMatchObject({
      code: "PAYMENT_PROVIDER_ERROR",
    });
  });

  it("verifies by transaction id, or by reference", async () => {
    reply({ status: "success", message: "ok", data: { id: 987, tx_ref: "GBJ-1", status: "successful", amount: 5000, currency: "NGN" } });
    expect(await fw.verify("GBJ-1", "987")).toEqual({ transactionId: "987", reference: "GBJ-1", status: "successful", amount: 5000, currency: "NGN" });
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.flutterwave.com/v3/transactions/987/verify");

    reply({ status: "error", message: "No transaction was found for this id", data: null }, 400);
    expect(await fw.verify("GBJ-2")).toBeNull();
    expect(fetchMock.mock.calls[1][0]).toBe("https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=GBJ-2");
  });

  it("refunds part of a transaction", async () => {
    reply({ status: "success", message: "Transaction refund initiated", data: {} });
    await fw.refund("987", 2500);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.flutterwave.com/v3/transactions/987/refund");
    expect(JSON.parse(init.body)).toEqual({ amount: 2500 });
    reply({ status: "error", message: "Refund failed", data: null }, 400);
    await expect(fw.refund("987", 1)).rejects.toThrow("Refund failed");
  });

  it("network errors become a friendly error", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNRESET"));
    await expect(fw.verify("GBJ-1", "1")).rejects.toMatchObject({ code: "PAYMENT_PROVIDER_ERROR" });
  });
});
