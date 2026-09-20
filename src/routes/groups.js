import express from "express";
import crypto from "crypto";
import { z } from "zod";
import prisma from "../lib/prisma.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { appBaseUrl } from "../lib/appUrl.js";
import { findGroupForUser, findGroupInviteLinkForUser } from "../utils/access.js";

const router = express.Router();

const createSchema = z.object({
  name: z.string().min(1),
  description: z.string().max(500).optional()
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().max(500).nullable().optional()
});

const membersSchema = z.object({
  playerIds: z.array(z.string().uuid()).min(1)
});

const roleSchema = z.object({
  role: z.enum(["owner", "manager", "member"])
});

const inviteLinkSchema = z.object({
  expiresAt: z.string().datetime().optional()
});

// Members with their player record, ordered the way the roster reads best:
// organizers first, then alphabetically.
const memberInclude = {
  members: {
    where: { player: { deletedAt: null } },
    include: { player: { include: { team: true } } },
    orderBy: [{ role: "asc" }, { player: { fullName: "asc" } }]
  }
};

router.get("/", requireAuth, requireRole(["admin", "staff"]), async (req, res) => {
  const groups = await prisma.group.findMany({
    where: { workspaceId: req.workspaceId, deletedAt: null },
    orderBy: { createdAt: "asc" },
    include: {
      _count: { select: { members: true } }
    }
  });
  res.json(
    groups.map((group) => ({
      id: group.id,
      name: group.name,
      description: group.description,
      createdAt: group.createdAt,
      memberCount: group._count.members
    }))
  );
});

router.post("/", requireAuth, requireRole(["admin", "staff"]), async (req, res) => {
  const parse = createSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: "Invalid input", details: parse.error.flatten() });
  }
  const group = await prisma.group.create({
    data: {
      name: parse.data.name,
      description: parse.data.description || null,
      createdBy: req.user.id,
      workspaceId: req.workspaceId
    }
  });
  res.json({ ...group, memberCount: 0 });
});

router.get("/:id", requireAuth, requireRole(["admin", "staff"]), async (req, res) => {
  const group = await findGroupForUser(req.params.id, req.workspaceId);
  if (!group) {
    return res.status(404).json({ error: "Group not found" });
  }
  const full = await prisma.group.findUnique({
    where: { id: group.id },
    include: {
      ...memberInclude,
      inviteLinks: {
        where: { revokedAt: null },
        orderBy: { createdAt: "desc" },
        take: 1
      }
    }
  });
  res.json({ ...full, appBaseUrl: appBaseUrl() });
});

router.patch("/:id", requireAuth, requireRole(["admin", "staff"]), async (req, res) => {
  const parse = updateSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: "Invalid input", details: parse.error.flatten() });
  }
  const group = await findGroupForUser(req.params.id, req.workspaceId);
  if (!group) {
    return res.status(404).json({ error: "Group not found" });
  }
  const updates = {};
  if (parse.data.name !== undefined) updates.name = parse.data.name;
  if (parse.data.description !== undefined) updates.description = parse.data.description;
  if (!Object.keys(updates).length) {
    return res.status(400).json({ error: "No updates provided" });
  }
  const updated = await prisma.group.update({ where: { id: group.id }, data: updates });
  res.json(updated);
});

// Soft delete. Sessions that pointed at this group keep running with their
// group link cleared, and members go with the group (the players themselves are
// untouched — they stay on the workspace roster).
router.delete("/:id", requireAuth, requireRole(["admin", "staff"]), async (req, res) => {
  const group = await findGroupForUser(req.params.id, req.workspaceId);
  if (!group) {
    return res.status(404).json({ error: "Group not found" });
  }
  await prisma.$transaction([
    prisma.session.updateMany({ where: { groupId: group.id }, data: { groupId: null } }),
    prisma.groupInviteLink.updateMany({
      where: { groupId: group.id, revokedAt: null },
      data: { revokedAt: new Date() }
    }),
    prisma.group.update({ where: { id: group.id }, data: { deletedAt: new Date() } })
  ]);
  res.json({ deleted: true });
});

// Additive, unlike teams — a player can be on many groups, so this adds the
// given players and leaves everyone else on the roster alone.
router.post("/:id/members", requireAuth, requireRole(["admin", "staff"]), async (req, res) => {
  const parse = membersSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: "Invalid input", details: parse.error.flatten() });
  }
  const group = await findGroupForUser(req.params.id, req.workspaceId);
  if (!group) {
    return res.status(404).json({ error: "Group not found" });
  }

  const playerIds = [...new Set(parse.data.playerIds)];
  const ownedCount = await prisma.player.count({
    where: { id: { in: playerIds }, workspaceId: req.workspaceId, deletedAt: null }
  });
  if (ownedCount !== playerIds.length) {
    return res.status(404).json({ error: "Player not found" });
  }

  await prisma.groupMember.createMany({
    data: playerIds.map((playerId) => ({ groupId: group.id, playerId })),
    skipDuplicates: true
  });

  const full = await prisma.group.findUnique({ where: { id: group.id }, include: memberInclude });
  res.json(full);
});

router.patch("/:id/members/:playerId", requireAuth, requireRole(["admin", "staff"]), async (req, res) => {
  const parse = roleSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: "Invalid input", details: parse.error.flatten() });
  }
  const group = await findGroupForUser(req.params.id, req.workspaceId);
  if (!group) {
    return res.status(404).json({ error: "Group not found" });
  }
  const member = await prisma.groupMember.findUnique({
    where: { groupId_playerId: { groupId: group.id, playerId: req.params.playerId } }
  });
  if (!member) {
    return res.status(404).json({ error: "Member not found" });
  }
  const updated = await prisma.groupMember.update({
    where: { id: member.id },
    data: { role: parse.data.role }
  });
  res.json(updated);
});

router.delete("/:id/members/:playerId", requireAuth, requireRole(["admin", "staff"]), async (req, res) => {
  const group = await findGroupForUser(req.params.id, req.workspaceId);
  if (!group) {
    return res.status(404).json({ error: "Group not found" });
  }
  const member = await prisma.groupMember.findUnique({
    where: { groupId_playerId: { groupId: group.id, playerId: req.params.playerId } }
  });
  if (!member) {
    return res.status(404).json({ error: "Member not found" });
  }
  await prisma.groupMember.delete({ where: { id: member.id } });
  res.json({ removed: true });
});

// One shareable link per group at a time: creating a new one revokes the old,
// so a link handed out in a chat thread can be cut off cleanly.
router.post("/:id/invite-link", requireAuth, requireRole(["admin", "staff"]), async (req, res) => {
  const parse = inviteLinkSchema.safeParse(req.body || {});
  if (!parse.success) {
    return res.status(400).json({ error: "Invalid input", details: parse.error.flatten() });
  }
  const group = await findGroupForUser(req.params.id, req.workspaceId);
  if (!group) {
    return res.status(404).json({ error: "Group not found" });
  }

  const token = crypto.randomBytes(24).toString("hex");
  const link = await prisma.$transaction(async (tx) => {
    await tx.groupInviteLink.updateMany({
      where: { groupId: group.id, revokedAt: null },
      data: { revokedAt: new Date() }
    });
    return tx.groupInviteLink.create({
      data: {
        token,
        groupId: group.id,
        expiresAt: parse.data.expiresAt ? new Date(parse.data.expiresAt) : null
      }
    });
  });

  res.json({ ...link, appBaseUrl: appBaseUrl() });
});

router.post("/invite-links/:linkId/revoke", requireAuth, requireRole(["admin", "staff"]), async (req, res) => {
  const link = await findGroupInviteLinkForUser(req.params.linkId, req.workspaceId);
  if (!link) {
    return res.status(404).json({ error: "Link not found" });
  }
  const revoked = await prisma.groupInviteLink.update({
    where: { id: link.id },
    data: { revokedAt: new Date() }
  });
  res.json(revoked);
});

export default router;
