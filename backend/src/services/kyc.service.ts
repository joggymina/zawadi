import { prisma } from "../lib/prisma";
import { AppError } from "../middleware/errorHandler";
import * as notifications from "./notification.service";

const MAX_DATA_URL_CHARS = 900_000;

function assertDataUrl(label: string, value: string) {
  if (!value.startsWith("data:image/")) {
    throw new AppError(`${label} must be an image upload.`, 422);
  }
  if (value.length > MAX_DATA_URL_CHARS) {
    throw new AppError(`${label} is too large. Use a clearer, smaller photo.`, 422);
  }
}

export async function submitKyc(params: {
  userId: string;
  fullName: string;
  idNumber: string;
  selfieData: string;
  idFrontData: string;
  idBackData: string;
}) {
  const fullName = params.fullName.trim();
  const idNumber = params.idNumber.trim().replace(/\s+/g, "");

  if (fullName.length < 3) throw new AppError("Enter your full legal name.", 422);
  if (idNumber.length < 5) throw new AppError("Enter a valid ID number.", 422);

  assertDataUrl("Selfie", params.selfieData);
  assertDataUrl("ID front", params.idFrontData);
  assertDataUrl("ID back", params.idBackData);

  const user = await prisma.user.findUniqueOrThrow({ where: { id: params.userId } });
  if (user.kycStatus === "VERIFIED") {
    throw new AppError("Your identity is already verified.", 422);
  }

  const pending = await prisma.kycSubmission.findFirst({
    where: { userId: params.userId, status: "PENDING_REVIEW" },
  });
  if (pending) {
    throw new AppError("You already have a submission under review.", 422);
  }

  const submission = await prisma.kycSubmission.create({
    data: {
      userId: params.userId,
      fullName,
      idNumber,
      selfieData: params.selfieData,
      idFrontData: params.idFrontData,
      idBackData: params.idBackData,
      status: "PENDING_REVIEW",
    },
  });

  if (user.kycStatus === "REJECTED") {
    await prisma.user.update({
      where: { id: params.userId },
      data: { kycStatus: "PENDING" },
    });
  }

  return {
    id: submission.id,
    status: submission.status,
    fullName: submission.fullName,
    idNumber: submission.idNumber,
    createdAt: submission.createdAt,
  };
}

export async function getMyKyc(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { kycStatus: true },
  });
  const latest = await prisma.kycSubmission.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      fullName: true,
      idNumber: true,
      status: true,
      rejectReason: true,
      createdAt: true,
      reviewedAt: true,
    },
  });
  return { kycStatus: user.kycStatus, latest };
}

export async function listPendingSubmissions() {
  return prisma.kycSubmission.findMany({
    where: { status: "PENDING_REVIEW" },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      fullName: true,
      idNumber: true,
      status: true,
      createdAt: true,
      user: { select: { id: true, username: true, phoneNumber: true, kycStatus: true } },
    },
  });
}

export async function getSubmissionForAdmin(id: string) {
  const sub = await prisma.kycSubmission.findUnique({
    where: { id },
    include: {
      user: {
        select: {
          id: true,
          username: true,
          phoneNumber: true,
          kycStatus: true,
          createdAt: true,
        },
      },
    },
  });
  if (!sub) throw new AppError("Submission not found.", 404);
  return sub;
}

export async function approveSubmission(params: { submissionId: string; adminId: string }) {
  const sub = await prisma.kycSubmission.findUnique({ where: { id: params.submissionId } });
  if (!sub) throw new AppError("Submission not found.", 404);
  if (sub.status !== "PENDING_REVIEW") {
    throw new AppError("This submission was already reviewed.", 422);
  }

  await prisma.$transaction([
    prisma.kycSubmission.update({
      where: { id: sub.id },
      data: {
        status: "APPROVED",
        reviewedAt: new Date(),
        reviewedById: params.adminId,
        rejectReason: null,
      },
    }),
    prisma.user.update({
      where: { id: sub.userId },
      data: { kycStatus: "VERIFIED" },
    }),
  ]);

  try {
    await notifications.notify({
      userId: sub.userId,
      type: "KYC_APPROVED",
      title: "Identity verified",
      body: "Your KYC was approved. Higher limits may now apply.",
      meta: { submissionId: sub.id },
    });
  } catch {
    /* ignore */
  }

  return { ok: true };
}

export async function rejectSubmission(params: {
  submissionId: string;
  adminId: string;
  reason?: string;
}) {
  const sub = await prisma.kycSubmission.findUnique({ where: { id: params.submissionId } });
  if (!sub) throw new AppError("Submission not found.", 404);
  if (sub.status !== "PENDING_REVIEW") {
    throw new AppError("This submission was already reviewed.", 422);
  }

  const reason = (params.reason || "Documents could not be verified.").trim();

  await prisma.$transaction([
    prisma.kycSubmission.update({
      where: { id: sub.id },
      data: {
        status: "REJECTED",
        reviewedAt: new Date(),
        reviewedById: params.adminId,
        rejectReason: reason,
      },
    }),
    prisma.user.update({
      where: { id: sub.userId },
      data: { kycStatus: "REJECTED" },
    }),
  ]);

  try {
    await notifications.notify({
      userId: sub.userId,
      type: "KYC_REJECTED",
      title: "Identity check not approved",
      body: reason,
      meta: { submissionId: sub.id },
    });
  } catch {
    /* ignore */
  }

  return { ok: true };
}