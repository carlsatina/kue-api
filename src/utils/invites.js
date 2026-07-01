import crypto from "crypto";
import prisma from "../lib/prisma.js";

export function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// Load an assistant invite by its raw token, with the workspace owner needed to
// render the invite summary. Returns null if no invite matches.
export function loadAssistantInvite(token) {
  return prisma.sessionAssistantInvite.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { workspace: { select: { owner: { select: { fullName: true, email: true } } } } }
  });
}

// Shape the public-facing invite summary shared by the authed and unauthed
// accept-page lookups.
export function inviteSummary(invite) {
  const owner = invite.workspace?.owner || null;
  return {
    email: invite.email,
    ownerName: owner?.fullName || owner?.email || "a Kue organizer",
    status: invite.status,
    expired: invite.expiresAt ? invite.expiresAt.getTime() < Date.now() : false
  };
}
