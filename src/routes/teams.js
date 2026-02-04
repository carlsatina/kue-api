import express from "express";
import { z } from "zod";
import prisma from "../lib/prisma.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { findTeamForUser } from "../utils/access.js";

const router = express.Router();

const createSchema = z.object({
  name: z.string().min(1),
  color: z.string().optional()
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  color: z.string().nullable().optional()
});

const membersSchema = z.object({
  playerIds: z.array(z.string().uuid())
});

router.get("/", requireAuth, requireRole(["admin", "staff"]), async (req, res) => {
  const teams = await prisma.team.findMany({
    where: { createdBy: req.user.id, deletedAt: null },
    orderBy: { createdAt: "asc" },
    include: {
      players: {
        where: { deletedAt: null },
        orderBy: { fullName: "asc" }
      }
    }
  });
  res.json(teams);
});

router.post("/", requireAuth, requireRole(["admin", "staff"]), async (req, res) => {
  const parse = createSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: "Invalid input", details: parse.error.flatten() });
  }
  const team = await prisma.team.create({
    data: {
      name: parse.data.name,
      color: parse.data.color || null,
      createdBy: req.user.id
    }
  });
  res.json(team);
});

router.patch("/:id", requireAuth, requireRole(["admin", "staff"]), async (req, res) => {
  const parse = updateSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: "Invalid input", details: parse.error.flatten() });
  }
  const team = await findTeamForUser(req.params.id, req.user.id);
  if (!team) {
    return res.status(404).json({ error: "Team not found" });
  }
  const updates = {};
  if (parse.data.name !== undefined) updates.name = parse.data.name;
  if (parse.data.color !== undefined) updates.color = parse.data.color;
  if (!Object.keys(updates).length) {
    return res.status(400).json({ error: "No updates provided" });
  }
  const updated = await prisma.team.update({
    where: { id: team.id },
    data: updates
  });
  res.json(updated);
});

router.delete("/:id", requireAuth, requireRole(["admin", "staff"]), async (req, res) => {
  const team = await findTeamForUser(req.params.id, req.user.id);
  if (!team) {
    return res.status(404).json({ error: "Team not found" });
  }
  await prisma.$transaction([
    prisma.player.updateMany({
      where: { teamId: team.id },
      data: { teamId: null }
    }),
    prisma.team.update({
      where: { id: team.id },
      data: { deletedAt: new Date() }
    })
  ]);
  res.json({ deleted: true });
});

router.post("/:id/members", requireAuth, requireRole(["admin", "staff"]), async (req, res) => {
  const parse = membersSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: "Invalid input", details: parse.error.flatten() });
  }
  const team = await findTeamForUser(req.params.id, req.user.id);
  if (!team) {
    return res.status(404).json({ error: "Team not found" });
  }

  const playerIds = parse.data.playerIds || [];
  if (playerIds.length) {
    const ownedCount = await prisma.player.count({
      where: { id: { in: playerIds }, createdBy: req.user.id, deletedAt: null }
    });
    if (ownedCount !== playerIds.length) {
      return res.status(404).json({ error: "Player not found" });
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    await tx.player.updateMany({
      where: { teamId: team.id, id: { notIn: playerIds } },
      data: { teamId: null }
    });
    if (playerIds.length) {
      await tx.player.updateMany({
        where: { id: { in: playerIds } },
        data: { teamId: team.id }
      });
    }
    return tx.team.findUnique({
      where: { id: team.id },
      include: {
        players: {
          where: { deletedAt: null },
          orderBy: { fullName: "asc" }
        }
      }
    });
  });

  res.json(updated);
});

export default router;
