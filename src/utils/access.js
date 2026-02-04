import prisma from "../lib/prisma.js";

export async function findSessionForUser(sessionId, userId) {
  if (!sessionId || !userId) return null;
  return prisma.session.findFirst({
    where: { id: sessionId, createdBy: userId }
  });
}

export async function findCourtForUser(courtId, userId) {
  if (!courtId || !userId) return null;
  return prisma.court.findFirst({
    where: { id: courtId, createdBy: userId, deletedAt: null }
  });
}

export async function findPlayerForUser(playerId, userId) {
  if (!playerId || !userId) return null;
  return prisma.player.findFirst({
    where: { id: playerId, createdBy: userId, deletedAt: null }
  });
}

export async function findTeamForUser(teamId, userId) {
  if (!teamId || !userId) return null;
  return prisma.team.findFirst({
    where: { id: teamId, createdBy: userId, deletedAt: null }
  });
}

export async function findShareLinkForUser(linkId, userId) {
  if (!linkId || !userId) return null;
  return prisma.shareLink.findFirst({
    where: { id: linkId, session: { createdBy: userId } }
  });
}

export async function findSessionShareLinkForUser(linkId, userId) {
  if (!linkId || !userId) return null;
  return prisma.sessionShareLink.findFirst({
    where: { id: linkId, session: { createdBy: userId } }
  });
}

export async function findSessionInviteLinkForUser(linkId, userId) {
  if (!linkId || !userId) return null;
  return prisma.sessionInviteLink.findFirst({
    where: { id: linkId, session: { createdBy: userId } }
  });
}
