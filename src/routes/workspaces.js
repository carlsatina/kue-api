import express from "express";
import { z } from "zod";
import prisma from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { findOwnedWorkspace, isWorkspaceMember } from "../utils/access.js";

const router = express.Router();

const nameSchema = z.object({ name: z.string().trim().min(1).max(80) });
const switchSchema = z.object({ workspaceId: z.string().uuid() });

// List every workspace the caller can act in: the ones they own (role "owner")
// plus the ones they've joined as a collaborator. `active` marks the current one.
router.get("/", requireAuth, async (req, res) => {
  const [owned, memberOf] = await Promise.all([
    prisma.workspace.findMany({
      where: { ownerId: req.user.id },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true }
    }),
    prisma.workspaceMember.findMany({
      where: { userId: req.user.id },
      include: { workspace: { select: { id: true, name: true, ownerId: true } } },
      orderBy: { createdAt: "asc" }
    })
  ]);

  const activeId = req.workspaceId; // already resolved by requireAuth
  const workspaces = owned.map((w) => ({
    id: w.id,
    name: w.name,
    role: "owner",
    active: w.id === activeId
  }));
  for (const m of memberOf) {
    if (m.workspace.ownerId === req.user.id) continue; // never list owned twice
    workspaces.push({
      id: m.workspace.id,
      name: m.workspace.name,
      role: "assistant",
      active: m.workspace.id === activeId
    });
  }

  res.json({ workspaces });
});

// Create a new workspace owned by the caller and switch into it.
router.post("/", requireAuth, async (req, res) => {
  const parse = nameSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: "Enter a workspace name" });

  const workspace = await prisma.workspace.create({
    data: { name: parse.data.name, ownerId: req.user.id }
  });
  await prisma.user.update({
    where: { id: req.user.id },
    data: { activeWorkspaceId: workspace.id }
  });

  res.status(201).json({ id: workspace.id, name: workspace.name, role: "owner", active: true });
});

// Rename a workspace (owner only).
router.patch("/:id", requireAuth, async (req, res) => {
  const parse = nameSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: "Enter a workspace name" });

  const ws = await findOwnedWorkspace(req.params.id, req.user.id);
  if (!ws) return res.status(404).json({ error: "Workspace not found" });

  const updated = await prisma.workspace.update({
    where: { id: req.params.id },
    data: { name: parse.data.name }
  });
  res.json({ id: updated.id, name: updated.name });
});

// Delete a workspace (owner only). Blocked if it's the caller's only workspace.
// Deleting cascades all of its data; anyone whose active pointer referenced it
// is reset by the ON DELETE SET NULL foreign key.
router.delete("/:id", requireAuth, async (req, res) => {
  const ws = await findOwnedWorkspace(req.params.id, req.user.id);
  if (!ws) return res.status(404).json({ error: "Workspace not found" });

  // The fallback lookup doubles as the "is this your only workspace?" check:
  // if there's no other owned workspace, deletion is blocked.
  const fallback = await prisma.workspace.findFirst({
    where: { ownerId: req.user.id, id: { not: req.params.id } },
    orderBy: { createdAt: "asc" },
    select: { id: true }
  });
  if (!fallback) {
    return res.status(409).json({ error: "You can't delete your only workspace" });
  }

  await prisma.workspace.delete({ where: { id: req.params.id } });
  // Land the caller in a workspace they still own.
  await prisma.user.update({
    where: { id: req.user.id },
    data: { activeWorkspaceId: fallback.id }
  });

  res.json({ ok: true, activeWorkspaceId: fallback.id });
});

// Switch the caller's active workspace. Validated against ownership/membership.
router.post("/switch", requireAuth, async (req, res) => {
  const parse = switchSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: "Invalid workspace" });
  const { workspaceId } = parse.data;

  const ws = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { ownerId: true }
  });
  if (!ws) return res.status(404).json({ error: "Workspace not found" });

  if (ws.ownerId !== req.user.id && !(await isWorkspaceMember(req.user.id, workspaceId))) {
    return res.status(403).json({ error: "You don't have access to that workspace" });
  }

  await prisma.user.update({
    where: { id: req.user.id },
    data: { activeWorkspaceId: workspaceId }
  });

  res.json({ ok: true, workspaceId });
});

export default router;
