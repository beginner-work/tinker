export type PaymentStatus = "pending" | "refunded";

export type Payment = {
  paymentId: string;
  merchantId: string;
  amountCents: number;
  currency: string;
  status: PaymentStatus;
  createdAt: string;
};

export type Refund = {
  refundId: string;
  paymentId: string;
  amountCents: number;
  createdAt: string;
};

export type CreatePaymentBody = {
  merchantId?: string;
  amountCents?: number;
  currency?: string;
};

export type CreateRefundBody = {
  amountCents?: number;
};
