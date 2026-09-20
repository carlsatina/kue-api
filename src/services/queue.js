import prisma from "../lib/prisma.js";
import { pickNextMatch } from "./pairing.js";

// How far back the avoid_repeat strategy looks for partnerships to break up.
const RECENT_MATCH_WINDOW = 8;

function minutesBetween(dateA, dateB) {
  const diffMs = Math.max(0, dateA.getTime() - dateB.getTime());
  return diffMs / 60000;
}

function computeFairnessScore({ now, queuedAt, lastPlayedAt }) {
  const waitMinutes = minutesBetween(now, queuedAt);
  const sincePlayed = lastPlayedAt ? minutesBetween(now, lastPlayedAt) : 999999;
  return waitMinutes + sincePlayed;
}

// Open play: the lineup is a queue of rackets, and a court call takes whole
// entries off the head until it has a full court. Reads the rows, hands plain
// objects to the pure pairing engine, and returns the same shape as
// suggestMatch so the match-start path doesn't care which mode produced it.
// Takes a client so a court call can run the whole read-decide-write in one
// transaction.
export async function suggestOpenPlayMatch(sessionId, client = prisma) {
  const session = await client.session.findUnique({ where: { id: sessionId } });
  if (!session) return null;

  const teamSize = session.gameType === "singles" ? 1 : 2;

  const entries = await client.queueEntry.findMany({
    where: { sessionId, status: "queued" },
    orderBy: { position: "asc" },
    include: { players: true }
  });
  if (!entries.length) return null;

  const playerIds = [...new Set(entries.flatMap((e) => e.players.map((p) => p.playerId)))];

  const [sessionPlayers, playerRows, recentMatches] = await Promise.all([
    client.sessionPlayer.findMany({ where: { sessionId, playerId: { in: playerIds } } }),
    client.player.findMany({
      where: { id: { in: playerIds } },
      select: { id: true, skillLevel: true }
    }),
    client.match.findMany({
      where: { sessionId, status: "ended" },
      orderBy: { endedAt: "desc" },
      take: RECENT_MATCH_WINDOW,
      include: { participants: { select: { playerId: true, teamNumber: true } } }
    })
  ]);

  const stateByPlayer = new Map(sessionPlayers.map((sp) => [sp.playerId, sp]));
  const skillByPlayer = new Map(playerRows.map((p) => [p.id, p.skillLevel]));

  const players = new Map(
    playerIds.map((id) => {
      const state = stateByPlayer.get(id);
      return [
        id,
        {
          skillLevel: skillByPlayer.get(id),
          wins: state?.wins || 0,
          losses: state?.losses || 0
        }
      ];
    })
  );

  // Only rackets whose players are all present and free to be called.
  const eligible = entries
    .filter((entry) =>
      entry.players.every((p) => stateByPlayer.get(p.playerId)?.status === "checked_in")
    )
    .map((entry) => ({
      id: entry.id,
      playerIds: entry.players.map((p) => p.playerId),
      lockedTeams: entry.lockedTeams,
      teams: entry.lockedTeams
        ? [1, 2].map((teamNo) =>
            entry.players.filter((p) => p.teamNo === teamNo).map((p) => p.playerId)
          )
        : null
    }));

  const history = recentMatches.map((match) => ({
    teams: [1, 2].map((teamNo) =>
      match.participants.filter((p) => p.teamNumber === teamNo).map((p) => p.playerId)
    )
  }));

  const picked = pickNextMatch({
    entries: eligible,
    players,
    history,
    strategy: session.pairingStrategy,
    teamSize
  });
  if (!picked) return null;

  return { matchType: session.gameType, ...picked };
}

export async function suggestMatch(sessionId, matchType) {
  const session = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!session) return null;
  if (session.queueMode === "open_play") return suggestOpenPlayMatch(sessionId);

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
