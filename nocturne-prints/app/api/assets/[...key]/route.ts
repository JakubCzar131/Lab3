import path from "node:path";
import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { env } from "@/lib/env";

type Context = {
  params: Promise<{ key: string[] }>;
};

export async function GET(_request: Request, context: Context) {
  if (env.STORAGE_DRIVER !== "local") {
    return NextResponse.json({ error: "Local storage is disabled" }, { status: 404 });
  }

  const { key } = await context.params;
  const relativeKey = key.join("/");
  const baseDir = path.resolve(/* turbopackIgnore: true */ process.cwd(), env.LOCAL_STORAGE_DIR);
  const absolutePath = path.resolve(baseDir, relativeKey);

  if (!absolutePath.startsWith(baseDir)) {
    return NextResponse.json({ error: "Invalid key" }, { status: 400 });
  }

  try {
    const buffer = await readFile(absolutePath);
    return new Response(buffer, {
      status: 200,
      headers: {
        "content-type": "image/png",
        "cache-control": "public, max-age=60",
      },
    });
  } catch {
    return NextResponse.json({ error: "Asset not found" }, { status: 404 });
  }
}
