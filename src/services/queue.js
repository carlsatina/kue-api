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
  const session = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!session) return null;

  const entries = await prisma.queueEntry.findMany({
    where: { sessionId, status: "queued", type: matchType },
    include: { players: { include: { player: true } } },
    orderBy: { position: "asc" }
  });

  if (entries.length < 2) return null;

  const sessionPlayers = await prisma.sessionPlayer.findMany({ where: { sessionId } });
  const playerMap = new Map(
    sessionPlayers.map((sp) => [sp.playerId, sp])
  );

  const isTournament = session.mode === "tournament";
  const teamIdCache = new Map();
  const entryTeamId = (entry) => {
    if (teamIdCache.has(entry.id)) return teamIdCache.get(entry.id);
    const teamIds = entry.players.map((p) => p.player?.teamId || null);
    if (teamIds.some((id) => !id)) {
      teamIdCache.set(entry.id, null);
      return null;
    }
    const unique = new Set(teamIds);
    if (unique.size !== 1) {
      teamIdCache.set(entry.id, null);
      return null;
    }
    const teamId = teamIds[0];
    teamIdCache.set(entry.id, teamId);
    return teamId;
  };

  const eligible = entries.filter((entry) => {
    if (!entry.players.every((p) => playerMap.get(p.playerId)?.status === "checked_in")) {
      return false;
    }
    if (!isTournament) return true;
    return Boolean(entryTeamId(entry));
  });

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

  let first = null;
  let second = null;
  if (isTournament) {
    for (let i = 0; i < sorted.length; i += 1) {
      const candidate = sorted[i];
      const teamA = entryTeamId(candidate);
      if (!teamA) continue;
      for (let j = i + 1; j < sorted.length; j += 1) {
        const opponent = sorted[j];
        const teamB = entryTeamId(opponent);
        if (!teamB) continue;
        if (teamA !== teamB) {
          first = candidate;
          second = opponent;
          break;
        }
      }
      if (first && second) break;
    }
  } else {
    [first, second] = sorted;
  }

  if (!first || !second) return null;
  return {
    matchType,
    teams: [
      first.players.map((p) => p.playerId),
      second.players.map((p) => p.playerId)
    ],
    entryIds: [first.id, second.id]
  };
}
