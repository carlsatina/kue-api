import prisma from "../lib/prisma.js";

// Find the workspace's existing roster entry for a self-registering player, or
// create one. Matching is by contact first (the stronger signal) then by exact
// name, so someone who signs up for a second session or joins a group they're
// already on doesn't create a duplicate. Shared by the session-invite and
// group-invite public flows.
export async function findOrCreatePlayer({ workspaceId, fullName, nickname, contact, createdBy = null }) {
  let player = null;

  if (contact) {
    player = await prisma.player.findFirst({
      where: { contact, deletedAt: null, workspaceId }
    });
  }
  if (!player) {
    player = await prisma.player.findFirst({
      where: { fullName, deletedAt: null, workspaceId }
    });
  }

  if (!player) {
    return prisma.player.create({
      data: { fullName, nickname, contact, workspaceId, createdBy }
    });
  }

  if (nickname || contact) {
    return prisma.player.update({
      where: { id: player.id },
      data: {
        nickname: nickname || player.nickname,
        contact: contact || player.contact
      }
    });
  }

  return player;
}
