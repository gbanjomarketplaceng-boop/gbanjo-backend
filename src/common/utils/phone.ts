/** Accepts 0901…, 901…, 234901… or +234901… and returns +234XXXXXXXXXX, or null if it isn't a valid Nigerian mobile number. */
export function normalizeNigerianPhone(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  let local: string;
  if (digits.startsWith("234")) local = digits.slice(3);
  else if (digits.startsWith("0")) local = digits.slice(1);
  else local = digits;
  return /^[789][01]\d{8}$/.test(local) ? `+234${local}` : null;
}

/** +2349045654356 → +234*******56 */
export const maskPhone = (phone: string) => `${phone.slice(0, 4)}${"*".repeat(Math.max(phone.length - 6, 3))}${phone.slice(-2)}`;

/** romina.williams@email.com → ro***@email.com (fixed-length mask so the name length isn't revealed) */
export function maskEmail(email: string) {
  const [name, domain] = email.split("@");
  return `${name.slice(0, 2)}***@${domain}`;
}
