import { request } from "./client";

export type MyKyc = {
  kycStatus: "PENDING" | "VERIFIED" | "REJECTED";
  latest: {
    id: string;
    fullName: string;
    idNumber: string;
    status: "PENDING_REVIEW" | "APPROVED" | "REJECTED";
    rejectReason: string | null;
    createdAt: string;
    reviewedAt: string | null;
  } | null;
};

export function getMine() {
  return request<MyKyc>("/api/account/kyc");
}

export function submit(body: {
  fullName: string;
  idNumber: string;
  selfieData: string;
  idFrontData: string;
  idBackData: string;
}) {
  return request<{ id: string; status: string }>("/api/account/kyc", {
    method: "POST",
    body,
  });
}