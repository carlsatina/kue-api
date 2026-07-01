import express from "express";
import crypto from "crypto";
import { z } from "zod";
import prisma from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { sendAssistantInviteEmail } from "../services/email.js";
import { hashToken, loadAssistantInvite, inviteSummary } from "../utils/invites.js";

const router = express.Router();

const inviteSchema = z.object({ email: z.string().email() });
const ASSISTANT_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// List workspace members (owner + collaborators) and pending email invites.
router.get("/", requireAuth, async (req, res) => {
  const workspaceId = req.workspaceId;

  // These three lookups are independent — run them concurrently.
  const [workspace, memberRows, pending] = await Promise.all([
    prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { ownerId: true, owner: { select: { id: true, email: true, fullName: true } } }
    }),
    prisma.workspaceMember.findMany({
      where: { workspaceId },
      include: { user: { select: { id: true, email: true, fullName: true } } },
      orderBy: { createdAt: "asc" }
    }),
    prisma.sessionAssistantInvite.findMany({
      where: { workspaceId, status: "pending" },
      orderBy: { createdAt: "desc" },
      select: { id: true, email: true, createdAt: true }
    })
  ]);

  const members = [];
  const owner = workspace?.owner;
  if (owner) {
    members.push({ userId: owner.id, email: owner.email, fullName: owner.fullName, role: "owner" });
  }
  for (const m of memberRows) {
    if (owner && m.userId === owner.id) continue;
    members.push({ userId: m.user.id, email: m.user.email, fullName: m.user.fullName, role: "assistant" });
  }

  res.json({ members, pending, isOwner: workspace?.ownerId === req.user.id });
});

// Invite a collaborator by email into the caller's active workspace.
router.post("/invite", requireAuth, async (req, res) => {
  const parse = inviteSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: "Enter a valid email address" });
  const email = parse.data.email.trim().toLowerCase();

  if (req.user.email && email === req.user.email.toLowerCase()) {
    return res.status(409).json({ error: "That's your own email" });
  }

  const workspaceId = req.workspaceId;
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { ownerId: true }
  });

  const existingUser = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existingUser) {
    if (existingUser.id === workspace?.ownerId) {
      return res.status(409).json({ error: "That person owns this workspace" });
    }
    const membership = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: existingUser.id } }
    });
    if (membership) {
      return res.status(409).json({ error: "That person is already a collaborator" });
    }
  }

  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + ASSISTANT_INVITE_TTL_MS);

  // Supersede any prior pending invite for the same email in this workspace.
  await prisma.sessionAssistantInvite.updateMany({
    where: { workspaceId, email, status: "pending" },
    data: { status: "revoked" }
  });
  await prisma.sessionAssistantInvite.create({
    data: { workspaceId, email, tokenHash, invitedBy: req.user.id, expiresAt }
  });

  let emailSent = true;
  try {
    await sendAssistantInviteEmail({ to: email, token, inviterEmail: req.user.email });
  } catch (err) {
    emailSent = false;
    console.error("Failed to send collaborator invite email:", err);
  }

  res.status(201).json({ ok: true, emailSent });
});

// Revoke a pending invite in the caller's active workspace.
router.delete("/invite/:inviteId", requireAuth, async (req, res) => {
  await prisma.sessionAssistantInvite.updateMany({
    where: { id: req.params.inviteId, workspaceId: req.workspaceId, status: "pending" },
    data: { status: "revoked" }
  });
  res.json({ ok: true });
});

// Remove a collaborator from the caller's active workspace.
router.delete("/:userId", requireAuth, async (req, res) => {
  const { userId } = req.params;
  await prisma.workspaceMember.deleteMany({ where: { workspaceId: req.workspaceId, userId } });
  // If the removed user was actively viewing this workspace, drop them out of it.
  await prisma.user.updateMany({
    where: { id: userId, activeWorkspaceId: req.workspaceId },
    data: { activeWorkspaceId: null }
  });
  res.json({ ok: true });
});

// Look up an invite by token (for the accept page). Auth required.
router.get("/invites/:token", requireAuth, async (req, res) => {
  const invite = await loadAssistantInvite(req.params.token);
  if (!invite) return res.status(404).json({ error: "Invite not found" });

  res.json({
    ...inviteSummary(invite),
    emailMatches: (req.user.email || "").toLowerCase() === invite.email.toLowerCase()
  });
});

// Accept an invite — joins the workspace as a collaborator.
router.post("/invites/:token/accept", requireAuth, async (req, res) => {
  const invite = await prisma.sessionAssistantInvite.findUnique({
    where: { tokenHash: hashToken(req.params.token) },
    include: { workspace: { select: { id: true, ownerId: true } } }
  });
  if (!invite) return res.status(404).json({ error: "Invite not found" });
  if (invite.status === "revoked") return res.status(410).json({ error: "This invite is no longer valid" });
  if (invite.expiresAt && invite.expiresAt.getTime() < Date.now()) {
    return res.status(410).json({ error: "This invite has expired" });
  }
  if ((req.user.email || "").toLowerCase() !== invite.email.toLowerCase()) {
    return res.status(403).json({
      error: `This invite was sent to ${invite.email}. Sign in with that email to accept it.`
    });
  }

  const workspace = invite.workspace;
  if (!workspace) return res.status(410).json({ error: "This invite is no longer valid" });
  if (req.user.id === workspace.ownerId) {
    return res.status(409).json({ error: "You already own this workspace" });
  }

  // Add (not replace) a membership: a user can collaborate in many workspaces.
  await prisma.workspaceMember.upsert({
    where: { workspaceId_userId: { workspaceId: workspace.id, userId: req.user.id } },
    update: { invitedBy: invite.invitedBy },
    create: { workspaceId: workspace.id, userId: req.user.id, invitedBy: invite.invitedBy }
  });

  // Drop the accepter into the workspace and mark the invite accepted — these
  // two writes are independent, so run them together.
  await Promise.all([
    prisma.user.update({
      where: { id: req.user.id },
      data: { activeWorkspaceId: workspace.id }
    }),
    ...(invite.status !== "accepted"
      ? [
          prisma.sessionAssistantInvite.update({
            where: { id: invite.id },
            data: { status: "accepted", acceptedAt: new Date(), acceptedUserId: req.user.id }
          })
        ]
      : [])
  ]);

  res.json({ ok: true, workspaceId: workspace.id });
});

export default router;
