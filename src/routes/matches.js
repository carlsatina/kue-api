import express from "express";
import { z } from "zod";
import prisma from "../lib/prisma.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { suggestMatch } from "../services/queue.js";
import { findSessionForUser } from "../utils/access.js";

const router = express.Router();

const suggestSchema = z.object({
  matchType: z.enum(["singles", "doubles"]).default("doubles")
});

const startSchema = z.object({
  courtSessionId: z.string().uuid(),
  matchType: z.enum(["singles", "doubles"]),
  teams: z.array(z.array(z.string().uuid())).length(2),
  entryIds: z.array(z.string().uuid()).optional()
});

const endSchema = z.object({
  matchId: z.string().uuid(),
  score: z.any().optional(),
  winnerTeam: z.number().int().min(1).max(2).optional()
});

const updateResultSchema = z.object({
  matchId: z.string().uuid(),
  score: z.any().optional(),
  winnerTeam: z.number().int().min(1).max(2).nullable().optional()
});

const cancelSchema = z.object({
  matchId: z.string().uuid()
});

router.get("/:id", requireAuth, requireRole(["admin", "staff"]), async (req, res) => {
  const match = await prisma.match.findFirst({
    where: { id: req.params.id, session: { createdBy: req.user.id } },
    include: { participants: { include: { player: { include: { team: true } } } } }
  });
  if (!match) {
    return res.status(404).json({ error: "Match not found" });
  }
  res.json(match);
});

router.post("/:sessionId/suggest", requireAuth, requireRole(["admin", "staff"]), async (req, res) => {
  const session = await findSessionForUser(req.params.sessionId, req.user.id);
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }
  const parse = suggestSchema.safeParse(req.body || {});
  if (!parse.success) {
    return res.status(400).json({ error: "Invalid input", details: parse.error.flatten() });
  }
  const { matchType } = parse.data;
  const suggestion = await suggestMatch(req.params.sessionId, matchType);
  if (!suggestion) {
    return res.status(404).json({ error: "Not enough eligible players" });
  }
  res.json(suggestion);
});

router.post("/:sessionId/start", requireAuth, requireRole(["admin", "staff"]), async (req, res) => {
  const { sessionId } = req.params;
  const session = await findSessionForUser(sessionId, req.user.id);
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }
  const parse = startSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: "Invalid input", details: parse.error.flatten() });
  }

  const { courtSessionId, matchType, teams, entryIds } = parse.data;

  const courtSession = await prisma.courtSession.findFirst({
    where: { id: courtSessionId, sessionId }
  });
  if (!courtSession) {
    return res.status(404).json({ error: "Court session not found" });
  }

  if (matchType === "singles") {
    if (teams.some((team) => team.length !== 1)) {
      return res.status(400).json({ error: "Singles requires 1 player per team" });
    }
  }
  if (matchType === "doubles") {
    if (teams.some((team) => team.length !== 2)) {
      return res.status(400).json({ error: "Doubles requires 2 players per team" });
    }
  }

  const allPlayerIds = teams.flat();
  const ownedPlayers = await prisma.player.count({
    where: { id: { in: allPlayerIds }, createdBy: req.user.id, deletedAt: null }
  });
  if (ownedPlayers !== allPlayerIds.length) {
    return res.status(404).json({ error: "Player not found" });
  }

  let teamIds = [null, null];
  if (session.mode === "tournament") {
    const players = await prisma.player.findMany({
      where: { id: { in: allPlayerIds }, createdBy: req.user.id, deletedAt: null },
      select: { id: true, teamId: true }
    });
    const teamMap = new Map(players.map((player) => [player.id, player.teamId]));
    const resolveTeamId = (team) => {
      const ids = team.map((playerId) => teamMap.get(playerId) || null);
      if (ids.some((id) => !id)) return null;
      const unique = new Set(ids);
      if (unique.size !== 1) return null;
      return ids[0];
    };
    teamIds = teams.map(resolveTeamId);
    if (teamIds.some((id) => !id)) {
      return res.status(409).json({ error: "Teams must belong to a single team in tournament mode" });
    }
    if (teamIds[0] === teamIds[1]) {
      return res.status(409).json({ error: "Teams must be different in tournament mode" });
    }
  }

  const match = await prisma.match.create({
    data: {
      sessionId,
      courtSessionId,
      status: "active",
      matchType,
      startedAt: new Date()
    }
  });

  const participants = teams.flatMap((team, idx) =>
    team.map((playerId) => ({
      matchId: match.id,
      playerId,
      teamNumber: idx + 1,
      teamId: session.mode === "tournament" ? teamIds[idx] : null
    }))
  );

  await prisma.matchParticipant.createMany({ data: participants });

  await prisma.courtSession.update({
    where: { id: courtSessionId },
    data: { status: "in_match", currentMatchId: match.id }
  });

  if (entryIds?.length) {
    await prisma.queueEntry.updateMany({
      where: { id: { in: entryIds } },
      data: { status: "assigned" }
    });
  } else {
    await prisma.queueEntry.updateMany({
      where: {
        sessionId,
        status: "queued",
        players: { some: { playerId: { in: teams.flat() } } }
      },
      data: { status: "assigned" }
    });
  }

  res.json({ matchId: match.id });
});

router.post("/:sessionId/end", requireAuth, requireRole(["admin", "staff"]), async (req, res) => {
  const { sessionId } = req.params;
  const session = await findSessionForUser(sessionId, req.user.id);
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }
  const parse = endSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: "Invalid input", details: parse.error.flatten() });
  }

  const { matchId, score, winnerTeam } = parse.data;
  const existingMatch = await prisma.match.findUnique({ where: { id: matchId } });
  if (!existingMatch || existingMatch.sessionId !== sessionId) {
    return res.status(404).json({ error: "Match not found" });
  }
  const match = await prisma.match.update({
    where: { id: matchId },
    data: {
      status: "ended",
      endedAt: new Date(),
      scoreJson: score || undefined,
      winnerTeam
    }
  });

  const participants = await prisma.matchParticipant.findMany({
    where: { matchId }
  });

  if (match.courtSessionId) {
    await prisma.courtSession.update({
      where: { id: match.courtSessionId },
      data: { status: "available", currentMatchId: null, nextMatchId: null }
    });
  }

  await prisma.sessionPlayer.updateMany({
    where: { sessionId, playerId: { in: participants.map((p) => p.playerId) } },
    data: {
      gamesPlayed: { increment: 1 },
      lastPlayedAt: new Date(),
      status: "checked_in"
    }
  });

  if (winnerTeam === 1 || winnerTeam === 2) {
    const winners = participants.filter((p) => p.teamNumber === winnerTeam).map((p) => p.playerId);
    const losers = participants.filter((p) => p.teamNumber !== winnerTeam).map((p) => p.playerId);
    if (winners.length) {
      await prisma.sessionPlayer.updateMany({
        where: { sessionId, playerId: { in: winners } },
        data: { wins: { increment: 1 } }
      });
    }
    if (losers.length) {
      await prisma.sessionPlayer.updateMany({
        where: { sessionId, playerId: { in: losers } },
        data: { losses: { increment: 1 } }
      });
    }
  }

  // End match sets players back to idle (checked_in) without re-queueing.

  res.json({ matchId });
});

router.patch("/:sessionId/result", requireAuth, requireRole(["admin", "staff"]), async (req, res) => {
  const { sessionId } = req.params;
  const session = await findSessionForUser(sessionId, req.user.id);
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }
  const parse = updateResultSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: "Invalid input", details: parse.error.flatten() });
  }

  const winnerProvided = Object.prototype.hasOwnProperty.call(parse.data, "winnerTeam");
  const scoreProvided = Object.prototype.hasOwnProperty.call(parse.data, "score");

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const match = await tx.match.findUnique({
        where: { id: parse.data.matchId },
        include: { participants: true }
      });

      if (!match || match.sessionId !== sessionId) {
        throw Object.assign(new Error("Match not found"), { statusCode: 404 });
      }
      if (match.status !== "ended") {
        throw Object.assign(new Error("Match is not ended"), { statusCode: 400 });
      }

      const nextWinner = winnerProvided ? parse.data.winnerTeam ?? null : match.winnerTeam;

      if (winnerProvided && match.winnerTeam !== nextWinner) {
        const team1Ids = match.participants
          .filter((p) => p.teamNumber === 1)
          .map((p) => p.playerId);
        const team2Ids = match.participants
          .filter((p) => p.teamNumber === 2)
          .map((p) => p.playerId);

        const adjust = async (ids, field, op) => {
          if (!ids.length) return;
          await tx.sessionPlayer.updateMany({
            where: { sessionId, playerId: { in: ids } },
            data: { [field]: { [op]: 1 } }
          });
        };

        if (match.winnerTeam === 1) {
          await adjust(team1Ids, "wins", "decrement");
          await adjust(team2Ids, "losses", "decrement");
        } else if (match.winnerTeam === 2) {
          await adjust(team2Ids, "wins", "decrement");
          await adjust(team1Ids, "losses", "decrement");
        }

        if (nextWinner === 1) {
          await adjust(team1Ids, "wins", "increment");
          await adjust(team2Ids, "losses", "increment");
        } else if (nextWinner === 2) {
          await adjust(team2Ids, "wins", "increment");
          await adjust(team1Ids, "losses", "increment");
        }
      }

      const updates = {};
      if (winnerProvided) updates.winnerTeam = nextWinner;
      if (scoreProvided) updates.scoreJson = parse.data.score ?? null;

      return tx.match.update({
        where: { id: match.id },
        data: updates
      });
    });

    res.json(updated);
  } catch (err) {
    const status = err.statusCode || 500;
    res.status(status).json({ error: err.message || "Unable to update match result" });
  }
});

router.post("/:sessionId/cancel", requireAuth, requireRole(["admin", "staff"]), async (req, res) => {
  const { sessionId } = req.params;
  const session = await findSessionForUser(sessionId, req.user.id);
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }
  const parse = cancelSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: "Invalid input", details: parse.error.flatten() });
  }

  const { matchId } = parse.data;
  const existingMatch = await prisma.match.findUnique({ where: { id: matchId } });
  if (!existingMatch || existingMatch.sessionId !== sessionId) {
    return res.status(404).json({ error: "Match not found" });
  }
  const match = await prisma.match.update({
    where: { id: matchId },
    data: {
      status: "cancelled",
      endedAt: new Date()
    }
  });

  const participants = await prisma.matchParticipant.findMany({
    where: { matchId }
  });

  if (match.courtSessionId) {
    await prisma.courtSession.update({
      where: { id: match.courtSessionId },
      data: { status: "available", currentMatchId: null, nextMatchId: null }
    });
  }

  if (session.returnToQueue) {
    const teams = participants.reduce((acc, p) => {
      acc[p.teamNumber - 1].push(p.playerId);
      return acc;
    }, [[], []]);

    const maxPosition = await prisma.queueEntry.aggregate({
      where: { sessionId },
      _max: { position: true }
    });

    let position = (maxPosition._max.position || 0) + 1;
    for (const team of teams) {
      const entry = await prisma.queueEntry.create({
        data: {
          sessionId,
          type: match.matchType,
          status: "queued",
          position
        }
      });
      position += 1;
      await prisma.queueEntryPlayer.createMany({
        data: team.map((playerId) => ({ entryId: entry.id, playerId }))
      });
    }
  }

  res.json({ matchId });
});

router.get("/:sessionId/history", requireAuth, requireRole(["admin", "staff"]), async (req, res) => {
  const { sessionId } = req.params;
  const session = await findSessionForUser(sessionId, req.user.id);
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }
  const matches = await prisma.match.findMany({
    where: { sessionId, status: { in: ["ended", "cancelled"] } },
    include: { participants: { include: { player: true } } },
    orderBy: { endedAt: "desc" }
  });

  const courtSessionIds = matches
    .map((m) => m.courtSessionId)
    .filter(Boolean);

  const courtSessions = courtSessionIds.length
    ? await prisma.courtSession.findMany({
        where: { id: { in: courtSessionIds } },
        include: { court: true }
      })
    : [];

  const courtMap = new Map(courtSessions.map((cs) => [cs.id, cs]));
  const enriched = matches.map((m) => ({
    ...m,
    courtSession: m.courtSessionId ? courtMap.get(m.courtSessionId) || null : null
  }));

  res.json(enriched);
});

export default router;
