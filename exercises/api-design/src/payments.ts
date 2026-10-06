import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { CreatePaymentBody, CreateRefundBody, Payment, Refund } from "./types";

/**
 * In-memory payments and refunds for this exercise. Implement createPayment,
 * listPayments, getPayment, createRefund, and getRefund, then wire the handlers
 * below. Do not leave the TODO throws in place.
 *
 * Keep the spoken payments language in the code: merchant, payment, refund,
 * amountCents, currency. If a name drifts from what the team says out loud,
 * rename it before you ship the handler.
 */
const payments: Payment[] = [];
const refunds: Refund[] = [];

function notImplemented(_request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  throw new Error("TODO: implement this handler in src/payments.ts");
}

export async function paymentsRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: CreatePaymentBody }>("/payments", notImplemented);

  app.get<{ Querystring: { merchantId?: string } }>("/payments", notImplemented);

  app.get<{ Params: { paymentId: string } }>("/payments/:paymentId", notImplemented);

  app.post<{ Params: { paymentId: string }; Body: CreateRefundBody }>(
    "/payments/:paymentId/refunds",
    notImplemented
  );

  app.get<{ Params: { refundId: string } }>("/refunds/:refundId", notImplemented);
}

/** Test helper: wipe the in-memory store between cases. */
export function resetPaymentsStore(): void {
  payments.length = 0;
  refunds.length = 0;
}
