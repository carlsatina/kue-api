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

// The status a player lands on when joining `session`, given their existing
// SessionPlayer row (or null) and whether a slot is free. Pure so both the
// public self-registration flow and staff bulk-add stay in lockstep.
export function nextJoinStatus(session, current, hasRoom) {
  const alreadyAdmitted = current && ADMITTED.includes(current.status);
  if (!session.requirePaymentToJoin || alreadyAdmitted) return "checked_in";
  if (current?.status === "pending_payment") return "pending_payment";
  // New joiner or currently waitlisted: claim a slot if one is free.
  return hasRoom ? "pending_payment" : "waitlisted";
}

// Does this status occupy one of the session's limited slots?
function consumesSlot(status) {
  return ADMITTED.includes(status) || status === "pending_payment";
}

// Add several players to a session in one pass, honouring the payment gate and
// join limits. Capacity is tracked locally as we go so a bulk add can't hand
// out more slots than the session has. Returns one result row per player.
export async function admitPlayers(sessionId, playerIds, { isNewPlayer = false } = {}) {
  await reconcileGatedSession(sessionId);
  const session = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!session) return null;

  const existing = await prisma.sessionPlayer.findMany({
    where: { sessionId, playerId: { in: playerIds } }
  });
  const existingByPlayer = new Map(existing.map((sp) => [sp.playerId, sp]));

  const { capacity, used: usedAtStart } = await getCapacityState(session);
  let used = usedAtStart;
  const results = [];

  for (const playerId of playerIds) {
    const current = existingByPlayer.get(playerId) || null;
    const hasRoom = capacity === 0 || used < capacity;
    const status = nextJoinStatus(session, current, hasRoom);
    if (consumesSlot(status) && !(current && consumesSlot(current.status))) {
      used += 1;
    }

    await prisma.sessionPlayer.upsert({
      where: { sessionId_playerId: { sessionId, playerId } },
      update: { status },
      create: { sessionId, playerId, status, isNewPlayer }
    });

    results.push({ playerId, status, alreadyInSession: Boolean(current) });
  }

  return results;
}
