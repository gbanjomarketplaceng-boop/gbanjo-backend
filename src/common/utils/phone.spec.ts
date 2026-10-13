import { maskEmail, maskPhone, normalizeNigerianPhone } from "./phone";

describe("normalizeNigerianPhone", () => {
  it.each([
    ["09045654356", "+2349045654356"],
    ["9045654356", "+2349045654356"],
    ["2349045654356", "+2349045654356"],
    ["+234 904 565 4356", "+2349045654356"],
    ["0803-123-4567", "+2348031234567"],
    ["07012345678", "+2347012345678"],
  ])("%s → %s", (input, expected) => expect(normalizeNigerianPhone(input)).toBe(expected));

  it.each(["123", "5551234567", "06012345678", "090456543561", ""])("rejects %s", (input) => expect(normalizeNigerianPhone(input)).toBeNull());
});

describe("masking", () => {
  it("masks phones and emails", () => {
    expect(maskPhone("+2349045654356")).toBe("+234********56");
    expect(maskEmail("romina.williams@email.com")).toBe("ro***@email.com");
    expect(maskEmail("ab@x.com")).toBe("ab***@x.com");
  });
});
