import express from "express";
import { z } from "zod";
import { join } from "path";
import { randomUUID } from "crypto";
import { writeFile } from "fs/promises";
import prisma from "../lib/prisma.js";
import { upload, compressToTarget, PROOFS_DIR } from "../lib/imageUpload.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { findPlayerForUser, findSessionForUser } from "../utils/access.js";

const router = express.Router();

const paymentSchema = z.object({
  playerId: z.string().uuid(),
  amount: z.coerce.number().positive(),
  method: z.string().min(1),
  note: z.string().optional()
});

router.get("/:sessionId/balances", requireAuth, requireRole(["admin", "staff"]), async (req, res) => {
  const { sessionId } = req.params;
  const session = await findSessionForUser(sessionId, req.user.id);
  if (!session) return res.status(404).json({ error: "Session not found" });

  const sessionPlayers = await prisma.sessionPlayer.findMany({
    where: { sessionId },
    include: { player: true }
  });

  const payments = await prisma.payment.findMany({ where: { sessionId } });

  // Only confirmed payments count toward paid amount
  const paidMap = new Map();
  payments
    .filter((p) => p.status === "confirmed")
    .forEach((p) => {
      paidMap.set(p.playerId, (paidMap.get(p.playerId) || 0) + Number(p.amount));
    });

  const sortedConfirmed = payments
    .filter((p) => p.status === "confirmed")
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const methodMap = new Map();
  const proofMap = new Map();
  sortedConfirmed.forEach((p) => {
    if (!methodMap.has(p.playerId)) methodMap.set(p.playerId, p.method);
    if (!proofMap.has(p.playerId) && p.proofImageUrl) proofMap.set(p.playerId, p.proofImageUrl);
  });

  const sortedNonConfirmed = payments
    .filter((p) => p.status !== "confirmed")
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const pendingMap = new Map();
  const rejectedMap = new Map();
  sortedNonConfirmed.forEach((p) => {
    if (p.status === "pending" && !pendingMap.has(p.playerId)) pendingMap.set(p.playerId, p);
    if (p.status === "rejected" && !rejectedMap.has(p.playerId)) rejectedMap.set(p.playerId, p);
  });

  const balances = sessionPlayers.map((sp) => {
    const due = session.feeMode === "flat"
      ? Number(session.feeAmount)
      : Number(session.feeAmount) * sp.gamesPlayed;
    const paid = paidMap.get(sp.playerId) || 0;
    return {
      playerId: sp.playerId,
      player: sp.player,
      due,
      paid,
      remaining: Math.max(0, due - paid),
      method: methodMap.get(sp.playerId) || null,
      proofImageUrl: proofMap.get(sp.playerId) || null,
      pendingPayment: pendingMap.get(sp.playerId) || null,
      rejectedPayment: rejectedMap.get(sp.playerId) || null
    };
  });

  res.json({ sessionId, balances });
});

router.post("/:sessionId", requireAuth, requireRole(["admin", "staff"]), upload.single("proof"), async (req, res) => {
  const { sessionId } = req.params;
  const session = await findSessionForUser(sessionId, req.user.id);
  if (!session) return res.status(404).json({ error: "Session not found" });

  const parse = paymentSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: "Invalid input", details: parse.error.flatten() });
  }

  const player = await findPlayerForUser(parse.data.playerId, req.user.id);
  if (!player) return res.status(404).json({ error: "Player not found" });

  let proofImageUrl = null;
  if (req.file) {
    const compressed = await compressToTarget(req.file.buffer);
    const filename = `${randomUUID()}.jpg`;
    await writeFile(join(PROOFS_DIR, filename), compressed);
    proofImageUrl = `/uploads/proofs/${filename}`;
  }

  const payment = await prisma.payment.create({
    data: {
      sessionId,
      playerId: player.id,
      amount: parse.data.amount,
      method: parse.data.method,
      note: parse.data.note,
      proofImageUrl,
      status: "confirmed"
    }
  });

  res.json(payment);
});

// Confirm a pending payment (player-submitted proof)
router.patch("/:sessionId/:paymentId/confirm", requireAuth, requireRole(["admin", "staff"]), async (req, res) => {
  const { sessionId, paymentId } = req.params;
  const session = await findSessionForUser(sessionId, req.user.id);
  if (!session) return res.status(404).json({ error: "Session not found" });

  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment || payment.sessionId !== sessionId) {
    return res.status(404).json({ error: "Payment not found" });
  }
  if (payment.status !== "pending") {
    return res.status(409).json({ error: "Payment is not pending" });
  }

  const confirmed = await prisma.payment.update({
    where: { id: paymentId },
    data: { status: "confirmed" }
  });
  res.json(confirmed);
});

// Reject a pending payment (marks as rejected so player can see and resubmit)
router.patch("/:sessionId/:paymentId/reject", requireAuth, requireRole(["admin", "staff"]), async (req, res) => {
  const { sessionId, paymentId } = req.params;
  const session = await findSessionForUser(sessionId, req.user.id);
  if (!session) return res.status(404).json({ error: "Session not found" });

  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment || payment.sessionId !== sessionId) {
    return res.status(404).json({ error: "Payment not found" });
  }
  if (payment.status !== "pending") {
    return res.status(409).json({ error: "Payment is not pending" });
  }

  const rejected = await prisma.payment.update({
    where: { id: paymentId },
    data: { status: "rejected" }
  });
  res.json(rejected);
});

export default router;
