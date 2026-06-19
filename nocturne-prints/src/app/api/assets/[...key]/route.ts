import { NextRequest, NextResponse } from "next/server";
import { getStorage } from "@/lib/storage";

export const runtime = "nodejs";

/**
 * Serwowanie plikow z adaptera lokalnego storage.
 *
 * Uploady uzytkownikow NIE leza w /public — sa serwowane przez ten route,
 * dzieki czemu nie sa publicznie listowalne i mozna w przyszlosci dolozyc
 * autoryzacje (np. dostep do generated_design tylko dla admina).
 */
export async function GET(_req: NextRequest, { params }: { params: { key: string[] } }) {
  const key = decodeURIComponent(params.key.join("/"));

  // Tylko nasze prefiksy storage sa dozwolone.
  if (!/^(uploads|generated)\//.test(key)) {
    return new NextResponse("Not found", { status: 404 });
  }

  const obj = await getStorage().get(key);
  if (!obj) return new NextResponse("Not found", { status: 404 });

  return new NextResponse(new Uint8Array(obj.body), {
    headers: {
      "Content-Type": obj.contentType,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
