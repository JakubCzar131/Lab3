import type { OrderStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

/**
 * Maszyna stanow zamowienia.
 * Definiuje dozwolone przejscia, by uniknac niespojnych statusow
 * (np. wysylka czegos, co nie przeszlo moderacji).
 */
export const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending_payment: ["paid", "cancelled"],
  paid: ["moderation_pending", "cancelled"],
  moderation_pending: ["generation_pending", "needs_manual_review", "rejected", "cancelled"],
  needs_manual_review: ["generation_pending", "rejected", "cancelled"],
  rejected: ["cancelled"],
  generation_pending: ["generated", "needs_manual_review", "rejected", "cancelled"],
  generated: ["production_ready", "needs_manual_review", "rejected", "cancelled"],
  production_ready: ["printed", "cancelled"],
  printed: ["shipped", "cancelled"],
  shipped: [],
  cancelled: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  if (from === to) return true;
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export interface TransitionInput {
  orderId: string;
  to: OrderStatus;
  actor?: string; // "system" | "admin:<email>" | "stripe"
  changedById?: string | null;
  note?: string;
  /** Dodatkowe pola Order do zaktualizowania w tej samej transakcji. */
  data?: Prisma.OrderUpdateInput;
  /** Jesli true, pomija walidacje przejscia (uzywac ostroznie, np. cancel). */
  force?: boolean;
}

/**
 * Zmienia status zamowienia i zapisuje wpis w StatusHistory (audyt).
 * Operacja transakcyjna — status i historia sa spojne.
 */
export async function transitionOrder(input: TransitionInput) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: input.orderId } });
    if (!order) throw new Error(`Zamówienie ${input.orderId} nie istnieje.`);

    if (!input.force && !canTransition(order.status, input.to)) {
      throw new Error(`Niedozwolone przejście statusu: ${order.status} -> ${input.to}.`);
    }

    const updated = await tx.order.update({
      where: { id: input.orderId },
      data: { ...input.data, status: input.to },
    });

    await tx.statusHistory.create({
      data: {
        orderId: input.orderId,
        fromStatus: order.status,
        toStatus: input.to,
        note: input.note,
        actor: input.actor ?? "system",
        changedById: input.changedById ?? undefined,
      },
    });

    return updated;
  });
}

/** Mapowanie statusow na czytelne etykiety PL dla UI. */
export const STATUS_LABELS: Record<OrderStatus, string> = {
  pending_payment: "Oczekuje na płatność",
  paid: "Opłacone",
  moderation_pending: "W moderacji",
  needs_manual_review: "Weryfikacja ręczna",
  rejected: "Odrzucone",
  generation_pending: "Generowanie projektu",
  generated: "Projekt wygenerowany",
  production_ready: "Gotowe do druku",
  printed: "Wydrukowane",
  shipped: "Wysłane",
  cancelled: "Anulowane",
};

/** Komunikaty dla klienta (ton marki, bez ujawniania projektu). */
export const STATUS_CUSTOMER_MESSAGE: Record<OrderStatus, string> = {
  pending_payment: "Twój rytuał czeka na opłacenie.",
  paid: "Płatność przyjęta. Zaczynamy przygotowania.",
  moderation_pending: "Sprawdzamy Twoje materiały. To chwila.",
  needs_manual_review: "Twoje zamówienie przechodzi dodatkową, ręczną weryfikację.",
  rejected: "Niestety nie możemy zrealizować tego zamówienia — sprawdź szczegóły poniżej.",
  generation_pending: "Algorytm przywołuje Twój nadruk. Pozostaje tajemnicą.",
  generated: "Projekt powstał. Pozostaje ukryty aż do otwarcia paczki.",
  production_ready: "Projekt zatwierdzony do druku.",
  printed: "Twój nadruk został wydrukowany.",
  shipped: "Paczka w drodze. Efekt poznasz po jej otwarciu.",
  cancelled: "Zamówienie zostało anulowane.",
};
