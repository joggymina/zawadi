import { request } from "./client";

export function deposit(amount: number, phone?: string) {
  return request<{
    intentId: string;
    status: string;
    message?: string;
    providerRef?: string | null;
  }>("/api/payments/deposit", {
    method: "POST",
    body: phone ? { amount, phone } : { amount },
  });
}

export function getIntent(id: string) {
  return request<{
    id: string;
    status: "PENDING" | "SUCCESS" | "FAILED";
    amount: string;
  }>(`/api/payments/${id}`);
}