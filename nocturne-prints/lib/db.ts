import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { env } from "@/lib/env";

declare global {
  var prismaGlobal: PrismaClient | undefined;
}

export const db =
  global.prismaGlobal ??
  new PrismaClient({
    adapter: new PrismaPg(
      new Pool({
        connectionString: env.DATABASE_URL,
      }),
    ),
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  global.prismaGlobal = db;
}
