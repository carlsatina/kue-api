import express from "express";
import { z } from "zod";
import prisma from "../lib/prisma.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { findPlayerForUser, findSessionForUser } from "../utils/access.js";

const router = express.Router();

const createSchema = z.object({
  fullName: z.string().min(1),
  nickname: z.string().optional(),
  skillLevel: z.string().optional(),
  contact: z.string().optional()
});

const updateSchema = z.object({
  fullName: z.string().min(1).optional(),
  nickname: z.string().optional(),
  skillLevel: z.string().optional(),
  contact: z.string().optional()
});

const checkinSchema = z.object({
  sessionId: z.string().uuid()
});

const presentSchema = z.object({
  sessionId: z.string().uuid()
});

const checkoutSchema = z.object({
  sessionId: z.string().uuid(),
  status: z.enum(["away", "done"])
});

router.get("/", requireAuth, requireRole(["admin", "staff"]), async (req, res) => {
  const players = await prisma.player.findMany({
    where: { deletedAt: null, createdBy: req.user.id },
    include: { team: true }
  });
  res.json(players);
});

router.post("/", requireAuth, requireRole(["admin", "staff"]), async (req, res) => {
  const parse = createSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: "Invalid input", details: parse.error.flatten() });
  }
  const player = await prisma.player.create({
    data: { ...parse.data, createdBy: req.user.id }
  });
  res.json(player);
});

router.patch("/:id", requireAuth, requireRole(["admin", "staff"]), async (req, res) => {
  const parse = updateSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: "Invalid input", details: parse.error.flatten() });
  }
  const player = await findPlayerForUser(req.params.id, req.user.id);
  if (!player) {
    return res.status(404).json({ error: "Player not found" });
  }
  const updated = await prisma.player.update({
    where: { id: player.id },
    data: parse.data
  });
  res.json(updated);
});

router.post("/:id/checkin", requireAuth, requireRole(["admin", "staff"]), async (req, res) => {
  const parse = checkinSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: "Invalid input", details: parse.error.flatten() });
  }
  const { sessionId } = parse.data;
  const session = await findSessionForUser(sessionId, req.user.id);
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }
  const player = await findPlayerForUser(req.params.id, req.user.id);
  if (!player) {
    return res.status(404).json({ error: "Player not found" });
  }
  const sessionPlayer = await prisma.sessionPlayer.upsert({
    where: { sessionId_playerId: { sessionId, playerId: player.id } },
    update: { status: "checked_in" },
    create: {
      sessionId,
      playerId: player.id,
      status: "checked_in"
    }
  });
  res.json(sessionPlayer);
});

router.post("/:id/present", requireAuth, requireRole(["admin", "staff"]), async (req, res) => {
  const parse = presentSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: "Invalid input", details: parse.error.flatten() });
  }
  const { sessionId } = parse.data;
  const session = await findSessionForUser(sessionId, req.user.id);
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }
  const player = await findPlayerForUser(req.params.id, req.user.id);
  if (!player) {
    return res.status(404).json({ error: "Player not found" });
  }
  const sessionPlayer = await prisma.sessionPlayer.upsert({
    where: { sessionId_playerId: { sessionId, playerId: player.id } },
    update: { status: "present" },
    create: {
      sessionId,
      playerId: player.id,
      status: "present"
    }
  });
  res.json(sessionPlayer);
});

router.post("/:id/checkout", requireAuth, requireRole(["admin", "staff"]), async (req, res) => {
  const parse = checkoutSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: "Invalid input", details: parse.error.flatten() });
  }
  const { sessionId, status } = parse.data;
  const session = await findSessionForUser(sessionId, req.user.id);
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }
  const player = await findPlayerForUser(req.params.id, req.user.id);
  if (!player) {
    return res.status(404).json({ error: "Player not found" });
  }
  const sessionPlayer = await prisma.sessionPlayer.update({
    where: { sessionId_playerId: { sessionId, playerId: player.id } },
    data: { status }
  });
  res.json(sessionPlayer);
});

export default router;
