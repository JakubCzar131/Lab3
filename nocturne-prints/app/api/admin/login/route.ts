import { z } from "zod";
import { createAdminSession } from "@/lib/auth/session";
import { verifyAdminCredentials } from "@/lib/auth/admin-auth";
import { jsonError, jsonOk } from "@/lib/http";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const payload = schema.parse(body);
    const valid = await verifyAdminCredentials(payload.email, payload.password);
    if (!valid) {
      return jsonOk({ error: "Invalid credentials" }, { status: 401 });
    }

    await createAdminSession(payload.email);
    return jsonOk({ ok: true });
  } catch (error) {
    return jsonError(error, "Could not sign in");
  }
}
