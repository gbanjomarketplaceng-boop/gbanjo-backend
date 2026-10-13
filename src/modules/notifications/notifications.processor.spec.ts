import { NotificationsProcessor } from "./notifications.processor";

describe("NotificationsProcessor · contact message", () => {
  it("emails support (reply goes to the customer) and confirms to the customer", async () => {
    const sent: { to: string; subject: string; text: string; opts?: { replyTo?: string } }[] = [];
    const email = { send: async (to: string, subject: string, text: string, opts?: { replyTo?: string }) => void sent.push({ to, subject, text, opts }) };
    const config = { get: () => "help@gbanjo.com" };
    const p = new NotificationsProcessor({ send: async () => undefined } as never, email as never, config as never);
    await p.process({
      name: "contact-message",
      data: { id: "m1", name: "Romina", email: "romina@email.com", topic: "Shopping", orderRef: null, subject: "Sizes?", message: "Do you have size 40?" },
    } as never);
    expect(sent[0]).toMatchObject({ to: "help@gbanjo.com", subject: "[Contact · Shopping] Sizes?", opts: { replyTo: "romina@email.com" } });
    expect(sent[0].text).toContain("Do you have size 40?");
    expect(sent[1]).toMatchObject({ to: "romina@email.com" });
    expect(sent[1].text).toContain("Sizes?");
  });
});
