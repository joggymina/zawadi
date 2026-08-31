import bcrypt from "bcrypt";

// Cost factor 12 is a reasonable floor in 2026 — re-benchmark on your
// actual production hardware and raise it if hashing takes < ~150ms.
const SALT_ROUNDS = 12;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

// Minimum bar — real product should also check against a breached-password
// list (e.g. HaveIBeenPwned's k-anonymity API) before accepting.
export function isPasswordStrongEnough(plain: string): boolean {
  return plain.length >= 10 && /[0-9]/.test(plain) && /[A-Za-z]/.test(plain);
}
