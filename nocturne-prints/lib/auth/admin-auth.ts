import { compare } from "bcryptjs";
import { env } from "@/lib/env";

export async function verifyAdminCredentials(email: string, password: string) {
  if (email.toLowerCase().trim() !== env.ADMIN_EMAIL.toLowerCase()) {
    return false;
  }

  return compare(password, env.ADMIN_PASSWORD_HASH);
}
