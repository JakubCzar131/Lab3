import { clearAdminSession } from "@/lib/auth/session";
import { jsonOk } from "@/lib/http";

export async function POST() {
  await clearAdminSession();
  return jsonOk({ ok: true });
}
