import prisma from "../lib/prisma.js";

// Statuses that mean a player has secured a spot in the session.
const ADMITTED = ["checked_in", "present", "away", "done"];

export function deadlinePassed(session) {
  return Boolean(session.paymentDeadline) && new Date() >= new Date(session.paymentDeadline);
}

// Lazily reconcile a payment-gated session: once the deadline passes, any slot
// holder who never submitted a proof is released back to the waitlist, freeing
// their slot for waitlisted players. Safe to call on every relevant request.
export async function reconcileGatedSession(sessionId) {
  const session = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!session || !session.requirePaymentToJoin) return session;
  if (!deadlinePassed(session)) return session;

  // Players who submitted any proof (pending or confirmed) kept their slot.
  const payments = await prisma.payment.findMany({
    where: { sessionId, status: { in: ["pending", "confirmed"] } },
    select: { playerId: true }
  });
  const submittedIds = [...new Set(payments.map((p) => p.playerId))];

  await prisma.sessionPlayer.updateMany({
    where: {
      sessionId,
      status: "pending_payment",
      ...(submittedIds.length ? { playerId: { notIn: submittedIds } } : {})
    },
    data: { status: "waitlisted" }
  });
  return session;
}

// How many slots are taken vs available. The cap is the combined Regular + New
// joiner limits; a total of 0 means unlimited (no waitlist).
export async function getCapacityState(session) {
  const sps = await prisma.sessionPlayer.findMany({
    where: { sessionId: session.id },
    select: { status: true }
  });
  const admitted = sps.filter((s) => ADMITTED.includes(s.status)).length;
  const holders = sps.filter((s) => s.status === "pending_payment").length;
  const used = admitted + holders;
  const capacity = (session.regularJoinLimit || 0) + (session.newJoinerLimit || 0);
  const hasRoom = capacity === 0 || used < capacity;
  return { capacity, admitted, holders, used, hasRoom };
}
