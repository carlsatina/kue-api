import express from "express";
import { z } from "zod";
import prisma from "../lib/prisma.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { findSessionForUser } from "../utils/access.js";
import { logQueueEvent } from "../services/queueEvents.js";

const router = express.Router();

const enqueueSchema = z.object({
  type: z.enum(["singles", "doubles"]).optional(),
  playerIds: z.array(z.string().uuid()).min(1).max(2)
});

const dequeueSchema = z.object({
  entryId: z.string().uuid()
});

const reorderSchema = z.object({
  orderedEntryIds: z.array(z.string().uuid()).min(1)
});

router.get("/:sessionId", requireAuth, requireRole(["admin", "staff"]), async (req, res) => {
  const { sessionId } = req.params;
  const session = await findSessionForUser(sessionId, req.workspaceId);
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }
  const entries = await prisma.queueEntry.findMany({
    where: { sessionId, status: "queued" },
    orderBy: { position: "asc" },
    include: { players: { include: { player: { include: { team: true } } } } }
  });
  res.json(entries);
});

router.post("/:sessionId/enqueue", requireAuth, requireRole(["admin", "staff"]), async (req, res) => {
  const { sessionId } = req.params;
  const session = await findSessionForUser(sessionId, req.workspaceId);
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }
  const parse = enqueueSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: "Invalid input", details: parse.error.flatten() });
  }
  const { playerIds } = parse.data;
  const type = parse.data.type || session.gameType;
  const teamSize = type === "singles" ? 1 : 2;

  if (new Set(playerIds).size !== playerIds.length) {
    return res.status(400).json({ error: "A player can only appear once in an entry" });
  }

  // An entry is one ready-made side.
  if (playerIds.length !== teamSize) {
    return res.status(400).json({
      error: type === "singles" ? "Singles requires 1 player" : "Doubles requires 2 players"
    });
  }

  const ownedPlayers = await prisma.player.count({
    where: { id: { in: playerIds }, workspaceId: req.workspaceId, deletedAt: null }
  });
  if (ownedPlayers !== playerIds.length) {
    return res.status(404).json({ error: "Player not found" });
  }

  const heldForPayment = await prisma.sessionPlayer.count({
    where: { sessionId, playerId: { in: playerIds }, status: { in: ["pending_payment", "waitlisted"] } }
  });
  if (heldForPayment > 0) {
    return res.status(409).json({ error: "One or more players are awaiting payment confirmation" });
  }

  if (session.mode === "tournament") {
    const players = await prisma.player.findMany({
      where: { id: { in: playerIds }, workspaceId: req.workspaceId, deletedAt: null },
      select: { id: true, teamId: true }
    });
    const missingTeam = players.filter((p) => !p.teamId);
    if (missingTeam.length) {
      return res.status(409).json({ error: "Players must belong to a team in tournament mode" });
    }
    if (type === "doubles") {
      const teamId = players[0]?.teamId || null;
      const sameTeam = teamId && players.every((p) => p.teamId === teamId);
      if (!sameTeam) {
        return res.status(409).json({ error: "Doubles teams must be from the same team" });
      }
    }
  }

  const existing = await prisma.queueEntryPlayer.findMany({
    where: { playerId: { in: playerIds }, entry: { sessionId, status: "queued" } },
    include: { entry: true }
  });
  if (existing.length > 0) {
    return res.status(409).json({ error: "One or more players already in queue" });
  }

  const maxPosition = await prisma.queueEntry.aggregate({
    where: { sessionId },
    _max: { position: true }
  });
  const position = (maxPosition._max.position || 0) + 1;

  const entry = await prisma.queueEntry.create({
    data: {
      sessionId,
      type,
      status: "queued",
      position,
      source: "staff"
    }
  });

  await prisma.queueEntryPlayer.createMany({
    data: playerIds.map((playerId) => ({ entryId: entry.id, playerId }))
  });

  await logQueueEvent(prisma, {
    sessionId,
    entryId: entry.id,
    type: "enqueued",
    actorId: req.user.id,
    payload: { playerIds, position }
  });

  const fullEntry = await prisma.queueEntry.findUnique({
    where: { id: entry.id },
    include: { players: { include: { player: { include: { team: true } } } } }
  });

  res.json(fullEntry);
});

router.post("/:sessionId/dequeue", requireAuth, requireRole(["admin", "staff"]), async (req, res) => {
  const { sessionId } = req.params;
  const session = await findSessionForUser(sessionId, req.workspaceId);
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }
  const parse = dequeueSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: "Invalid input", details: parse.error.flatten() });
  }
  const { entryId } = parse.data;
  const entry = await prisma.queueEntry.findUnique({ where: { id: entryId } });
  if (!entry || entry.sessionId !== sessionId) {
    return res.status(404).json({ error: "Queue entry not found" });
  }
  const updated = await prisma.queueEntry.update({
    where: { id: entryId },
    data: { status: "removed" }
  });
  await logQueueEvent(prisma, {
    sessionId,
    entryId,
    type: "dequeued",
    actorId: req.user.id
  });
  res.json(updated);
});

router.post("/:sessionId/away", requireAuth, requireRole(["admin", "staff"]), async (req, res) => {
  const { sessionId } = req.params;
  const session = await findSessionForUser(sessionId, req.workspaceId);
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }
  const parse = dequeueSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: "Invalid input", details: parse.error.flatten() });
  }
  const { entryId } = parse.data;
  const entry = await prisma.queueEntry.findUnique({ where: { id: entryId } });
  if (!entry || entry.sessionId !== sessionId) {
    return res.status(404).json({ error: "Queue entry not found" });
  }
  const updated = await prisma.queueEntry.update({
    where: { id: entryId },
    data: { status: "removed" }
  });
  await logQueueEvent(prisma, {
    sessionId,
    entryId,
    type: "left_lineup",
    actorId: req.user.id
  });
  res.json(updated);
});

router.post("/:sessionId/reorder", requireAuth, requireRole(["admin", "staff"]), async (req, res) => {
  const { sessionId } = req.params;
  const session = await findSessionForUser(sessionId, req.workspaceId);
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }
  const parse = reorderSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: "Invalid input", details: parse.error.flatten() });
  }

  const existingCount = await prisma.queueEntry.count({
    where: { id: { in: parse.data.orderedEntryIds }, sessionId }
  });
  if (existingCount !== parse.data.orderedEntryIds.length) {
    return res.status(404).json({ error: "Queue entries not found" });
  }

  const updates = parse.data.orderedEntryIds.map((entryId, idx) =>
    prisma.queueEntry.update({
      where: { id: entryId },
      data: { position: idx + 1, manualOrder: true }
    })
  );

  await prisma.$transaction(updates);
  await logQueueEvent(prisma, {
    sessionId,
    type: "reordered",
    actorId: req.user.id,
    payload: { orderedEntryIds: parse.data.orderedEntryIds }
  });
  const entries = await prisma.queueEntry.findMany({
    where: { sessionId, status: "queued" },
    orderBy: { position: "asc" },
    include: { players: { include: { player: { include: { team: true } } } } }
  });
  res.json(entries);
});

// The lineup's paper trail: who was called, who was passed over, who got moved.
router.get("/:sessionId/events", requireAuth, requireRole(["admin", "staff"]), async (req, res) => {
  const { sessionId } = req.params;
  const session = await findSessionForUser(sessionId, req.workspaceId);
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }
  const limit = Math.min(Number(req.query.limit) || 30, 100);
  const events = await prisma.queueEvent.findMany({
    where: { sessionId },
    orderBy: { createdAt: "desc" },
    take: limit
  });
  res.json(events);
});

export default router;
