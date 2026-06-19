"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import {
  authenticate,
  createSession,
  destroySession,
  requireAdmin,
} from "@/lib/auth";
import { transitionOrder } from "@/lib/orders";
import { getQueue } from "@/lib/queue";
import { ensureWorkers } from "@/lib/workers";
import { adminUpdateStatusSchema, loginSchema } from "@/lib/validation";

export interface LoginState {
  error?: string;
}

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
  });
  if (!parsed.success) return { error: "Podaj poprawny e-mail i hasło." };

  const session = await authenticate(parsed.data.email, parsed.data.password);
  if (!session) return { error: "Niepoprawne dane logowania." };

  await createSession(session.userId, session.email);
  redirect("/admin");
}

export async function logoutAction(): Promise<void> {
  destroySession();
  redirect("/admin/login");
}

export interface UpdateStatusState {
  ok?: boolean;
  error?: string;
}

/**
 * Aktualizacja statusu zamowienia przez admina.
 * Kazda zmiana jest audytowana (actor = admin:<email>, changedById = userId).
 */
export async function updateOrderStatusAction(
  _prev: UpdateStatusState,
  formData: FormData
): Promise<UpdateStatusState> {
  let admin;
  try {
    admin = await requireAdmin();
  } catch {
    return { error: "Brak autoryzacji." };
  }

  const parsed = adminUpdateStatusSchema.safeParse({
    orderId: String(formData.get("orderId") ?? ""),
    action: String(formData.get("action") ?? ""),
    reason: formData.get("reason") ? String(formData.get("reason")) : undefined,
  });
  if (!parsed.success) return { error: "Niepoprawne dane akcji." };

  const { orderId, action, reason } = parsed.data;
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { generatedDesigns: true },
  });
  if (!order) return { error: "Zamówienie nie istnieje." };

  const actor = `admin:${admin.email}`;
  const changedById = admin.userId;

  try {
    switch (action) {
      case "approve_manual": {
        // Reczna akceptacja: jesli jest juz projekt -> do druku, inaczej -> generuj.
        if (order.generatedDesigns.length > 0) {
          await transitionOrder({
            orderId,
            to: "production_ready",
            actor,
            changedById,
            note: "Ręczna akceptacja projektu.",
            force: true,
          });
        } else {
          await transitionOrder({
            orderId,
            to: "generation_pending",
            actor,
            changedById,
            note: "Ręczna akceptacja — kierowanie do generowania.",
            force: true,
          });
          ensureWorkers();
          await getQueue().enqueue("generate_design", { orderId });
        }
        break;
      }
      case "reject": {
        await transitionOrder({
          orderId,
          to: "rejected",
          actor,
          changedById,
          note: reason ? `Odrzucono ręcznie: ${reason}` : "Odrzucono ręcznie.",
          data: { rejectionReason: reason ?? "Odrzucono przez moderatora." },
          force: true,
        });
        break;
      }
      case "regenerate": {
        await transitionOrder({
          orderId,
          to: "generation_pending",
          actor,
          changedById,
          note: "Ponowne generowanie projektu.",
          force: true,
        });
        ensureWorkers();
        await getQueue().enqueue("generate_design", { orderId });
        break;
      }
      case "mark_production_ready": {
        await transitionOrder({
          orderId,
          to: "production_ready",
          actor,
          changedById,
          note: "Oznaczono jako gotowe do druku.",
          force: true,
        });
        break;
      }
      case "mark_printed": {
        await transitionOrder({ orderId, to: "printed", actor, changedById, note: "Wydrukowano." });
        break;
      }
      case "mark_shipped": {
        await transitionOrder({ orderId, to: "shipped", actor, changedById, note: "Wysłano." });
        break;
      }
      case "cancel": {
        await transitionOrder({
          orderId,
          to: "cancelled",
          actor,
          changedById,
          note: reason ? `Anulowano: ${reason}` : "Anulowano.",
          force: true,
        });
        break;
      }
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Błąd aktualizacji statusu." };
  }

  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath("/admin");
  return { ok: true };
}
