import express from "express";
import { z } from "zod";
import prisma from "../lib/prisma.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { findPlayerForUser, findSessionForUser } from "../utils/access.js";

const router = express.Router();

const paymentSchema = z.object({
  playerId: z.string().uuid(),
  amount: z.number().positive(),
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
  const paidMap = new Map();
  const methodMap = new Map();
  payments.forEach((p) => {
    paidMap.set(p.playerId, (paidMap.get(p.playerId) || 0) + Number(p.amount));
  });
  const sortedPayments = [...payments].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  sortedPayments.forEach((p) => {
    if (!methodMap.has(p.playerId)) {
      methodMap.set(p.playerId, p.method);
    }
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
      method: methodMap.get(sp.playerId) || null
    };
  });

  res.json({ sessionId, balances });
});

router.post("/:sessionId", requireAuth, requireRole(["admin", "staff"]), async (req, res) => {
  const { sessionId } = req.params;
  const session = await findSessionForUser(sessionId, req.user.id);
  if (!session) return res.status(404).json({ error: "Session not found" });
  const parse = paymentSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: "Invalid input", details: parse.error.flatten() });
  }

  const player = await findPlayerForUser(parse.data.playerId, req.user.id);
  if (!player) {
    return res.status(404).json({ error: "Player not found" });
  }

  const payment = await prisma.payment.create({
    data: {
      sessionId,
      playerId: player.id,
      amount: parse.data.amount,
      method: parse.data.method,
      note: parse.data.note
    }
  });

  res.json(payment);
});

export default router;
