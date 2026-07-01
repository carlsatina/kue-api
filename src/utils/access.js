import prisma from "../lib/prisma.js";

// Is `userId` a member (assistant) of `workspaceId`? Shared by resolution and
// the /switch access check so "may act here" lives in one place.
export async function isWorkspaceMember(userId, workspaceId) {
  const membership = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
    select: { id: true }
  });
  return Boolean(membership);
}

// Load a workspace only if `userId` owns it (else null) — the load+guard used by
// the owner-only rename/delete routes.
export async function findOwnedWorkspace(workspaceId, userId) {
  if (!workspaceId || !userId) return null;
  return prisma.workspace.findFirst({
    where: { id: workspaceId, ownerId: userId },
    select: { id: true, ownerId: true }
  });
}

// Resolve which workspace a request acts in, given the caller and their selected
// workspace (already loaded from User.activeWorkspace as `{ id, ownerId }`, or
// null). A selection is valid if the caller owns it or is a member. If it's
// missing or stale, fall back to the caller's default (oldest owned) workspace
// and report `stale` so the dangling selection can be repaired.
export async function resolveWorkspace(userId, activeWorkspace) {
  if (activeWorkspace) {
    if (activeWorkspace.ownerId === userId) return { workspaceId: activeWorkspace.id, stale: false };
    if (await isWorkspaceMember(userId, activeWorkspace.id)) {
      return { workspaceId: activeWorkspace.id, stale: false };
    }
    // Selection points at a workspace the caller can no longer access.
  }

  const owned = await prisma.workspace.findFirst({
    where: { ownerId: userId },
    orderBy: { createdAt: "asc" },
    select: { id: true }
  });
  if (owned) return { workspaceId: owned.id, stale: Boolean(activeWorkspace) };

  // No owned workspace (unexpected) — fall back to any workspace they assist in.
  const anyMembership = await prisma.workspaceMember.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { workspaceId: true }
  });
  return {
    workspaceId: anyMembership ? anyMembership.workspaceId : null,
    stale: Boolean(activeWorkspace)
  };
}

export async function findSessionForUser(sessionId, workspaceId) {
  if (!sessionId || !workspaceId) return null;
  return prisma.session.findFirst({ where: { id: sessionId, workspaceId } });
}

export async function findCourtForUser(courtId, workspaceId) {
  if (!courtId || !workspaceId) return null;
  return prisma.court.findFirst({ where: { id: courtId, workspaceId, deletedAt: null } });
}

export async function findPlayerForUser(playerId, workspaceId) {
  if (!playerId || !workspaceId) return null;
  return prisma.player.findFirst({ where: { id: playerId, workspaceId, deletedAt: null } });
}

export async function findTeamForUser(teamId, workspaceId) {
  if (!teamId || !workspaceId) return null;
  return prisma.team.findFirst({ where: { id: teamId, workspaceId, deletedAt: null } });
}

export async function findShareLinkForUser(linkId, workspaceId) {
  if (!linkId || !workspaceId) return null;
  return prisma.shareLink.findFirst({ where: { id: linkId, session: { workspaceId } } });
}

export async function findSessionShareLinkForUser(linkId, workspaceId) {
  if (!linkId || !workspaceId) return null;
  return prisma.sessionShareLink.findFirst({ where: { id: linkId, session: { workspaceId } } });
}

export async function findSessionInviteLinkForUser(linkId, workspaceId) {
  if (!linkId || !workspaceId) return null;
  return prisma.sessionInviteLink.findFirst({ where: { id: linkId, session: { workspaceId } } });
}
