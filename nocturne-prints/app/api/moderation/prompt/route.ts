import { jsonError, jsonOk } from "@/lib/http";
import { moderatePromptSchema } from "@/lib/validation/schemas";
import { classifyPromptSafety } from "@/modules/moderation/prompt";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const payload = moderatePromptSchema.parse(body);
    const result = await classifyPromptSafety(payload.prompt);
    return jsonOk(result);
  } catch (error) {
    return jsonError(error, "Prompt moderation failed");
  }
}
