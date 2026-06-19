import crypto from "node:crypto";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { prisma } from "@/lib/db";

/**
 * Lekki auth dla panelu admina (MVP).
 *
 * - Hasla hashowane scrypt + sol (format: scrypt$<saltHex>$<hashHex>).
 * - Sesja: podpisany HMAC token w httpOnly cookie (bez zewnetrznej biblioteki).
 * - Dla wiekszej skali warto przejsc na NextAuth/Lucia, ale interfejs (getSession,
 *   requireAdmin) pozostanie podobny.
 */

const SESSION_COOKIE = "nocturne_admin_session";
const SESSION_TTL_SEC = 60 * 60 * 8; // 8h

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1], "hex");
  const expected = Buffer.from(parts[2], "hex");
  const actual = crypto.scryptSync(password, salt, expected.length);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

interface SessionPayload {
  userId: string;
  email: string;
  exp: number;
}

function sign(data: string): string {
  return crypto.createHmac("sha256", env.AUTH_SECRET).update(data).digest("base64url");
}

function createToken(payload: SessionPayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body)}`;
}

function verifyToken(token: string): SessionPayload | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = sign(body);
  // porownanie odporne na timing
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function createSession(userId: string, email: string): Promise<void> {
  const payload: SessionPayload = {
    userId,
    email,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SEC,
  };
  cookies().set(SESSION_COOKIE, createToken(payload), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SEC,
  });
}

export function destroySession(): void {
  cookies().delete(SESSION_COOKIE);
}

export interface AdminSession {
  userId: string;
  email: string;
}

export async function getSession(): Promise<AdminSession | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const payload = verifyToken(token);
  if (!payload) return null;
  return { userId: payload.userId, email: payload.email };
}

/** Rzuca, jesli brak zalogowanego admina. Uzywac w server actions / route handlers. */
export async function requireAdmin(): Promise<AdminSession> {
  const session = await getSession();
  if (!session) throw new Error("UNAUTHORIZED");
  return session;
}

export async function authenticate(email: string, password: string): Promise<AdminSession | null> {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user) {
    // Stala praca nawet przy braku usera (utrudnia user enumeration).
    crypto.scryptSync(password, "dummy-salt", 64);
    return null;
  }
  if (!verifyPassword(password, user.passwordHash)) return null;
  return { userId: user.id, email: user.email };
}
