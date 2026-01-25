import prisma from "../lib/prisma.js";

function minutesBetween(dateA, dateB) {
  const diffMs = Math.max(0, dateA.getTime() - dateB.getTime());
  return diffMs / 60000;
}

function computeFairnessScore({ now, queuedAt, lastPlayedAt }) {
  const waitMinutes = minutesBetween(now, queuedAt);
  const sincePlayed = lastPlayedAt ? minutesBetween(now, lastPlayedAt) : 999999;
  return waitMinutes + sincePlayed;
}

export async function suggestMatch(sessionId, matchType) {
  const entries = await prisma.queueEntry.findMany({
    where: { sessionId, status: "queued", type: matchType },
    include: { players: true },
    orderBy: { position: "asc" }
  });

  if (entries.length < 2) return null;

  const sessionPlayers = await prisma.sessionPlayer.findMany({ where: { sessionId } });
  const playerMap = new Map(
    sessionPlayers.map((sp) => [sp.playerId, sp])
  );

  const eligible = entries.filter((entry) =>
    entry.players.every((p) => playerMap.get(p.playerId)?.status === "checked_in")
  );

  if (eligible.length < 2) return null;

  const manualOverride = eligible.some((entry) => entry.manualOrder);
  let sorted = eligible;

  if (manualOverride) {
    sorted = [...eligible].sort((a, b) => a.position - b.position);
  } else {
    const now = new Date();
    sorted = [...eligible].sort((a, b) => {
      const aTimes = a.players
        .map((p) => playerMap.get(p.playerId)?.lastPlayedAt?.getTime())
        .filter((t) => typeof t === "number");
      const bTimes = b.players
        .map((p) => playerMap.get(p.playerId)?.lastPlayedAt?.getTime())
        .filter((t) => typeof t === "number");
      const aLast = aTimes.length ? new Date(Math.min(...aTimes)) : null;
      const bLast = bTimes.length ? new Date(Math.min(...bTimes)) : null;

      const aScore = computeFairnessScore({
        now,
        queuedAt: a.createdAt,
        lastPlayedAt: aLast
      });
      const bScore = computeFairnessScore({
        now,
        queuedAt: b.createdAt,
        lastPlayedAt: bLast
      });

      if (bScore !== aScore) return bScore - aScore;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });
  }

  const [first, second] = sorted;
  return {
    matchType,
    teams: [
      first.players.map((p) => p.playerId),
      second.players.map((p) => p.playerId)
    ],
    entryIds: [first.id, second.id]
  };
}
