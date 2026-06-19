import { NextResponse } from "next/server";
import { ZodError } from "zod";

export function jsonOk<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function jsonError(error: unknown, fallbackMessage = "Unexpected error") {
  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: "Validation error",
        details: error.flatten(),
      },
      { status: 400 },
    );
  }

  const message = error instanceof Error ? error.message : fallbackMessage;
  const status = /not found/i.test(message) ? 404 : 400;
  return NextResponse.json({ error: message }, { status });
}
