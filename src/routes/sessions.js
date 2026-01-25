import express from "express";
import { z } from "zod";
import prisma from "../lib/prisma.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { findSessionForUser } from "../utils/access.js";

const router = express.Router();

const createSchema = z.object({
  name: z.string().min(1),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().optional(),
  gameType: z.enum(["singles", "doubles"]).default("doubles"),
  defaultBracketType: z.enum(["single", "double", "round_robin"]).optional(),
  feeMode: z.enum(["flat", "per_game"]).default("flat"),
  feeAmount: z.number().nonnegative().default(0),
  regularJoinLimit: z.number().int().nonnegative().default(0),
  newJoinerLimit: z.number().int().nonnegative().default(0),
  returnToQueue: z.boolean().default(true),
  announcements: z.string().optional()
});

const feeSchema = z.object({
  feeMode: z.enum(["flat", "per_game"]).optional(),
  feeAmount: z.number().nonnegative().optional()
});

const updateSessionSchema = z.object({
  name: z.string().min(1).optional(),
  gameType: z.enum(["singles", "doubles"]).optional(),
  defaultBracketType: z.enum(["single", "double", "round_robin"]).nullable().optional(),
  feeAmount: z.number().nonnegative().optional(),
  regularJoinLimit: z.number().int().nonnegative().optional(),
  newJoinerLimit: z.number().int().nonnegative().optional(),
  announcements: z.string().optional()
});

const bracketOverrideSchema = z.object({
  matchId: z.string().min(1),
  bracketType: z.enum(["single", "double", "round_robin"]),
  matchFormat: z.enum(["singles", "doubles"]),
  winnerId: z.string().optional().nullable(),
  score: z.any().optional()
});

const bracketOverrideQuerySchema = z.object({
  bracketType: z.enum(["single", "double", "round_robin"]).optional(),
  matchFormat: z.enum(["singles", "doubles"]).optional()
});

router.post("/", requireAuth, requireRole(["admin"]), async (req, res) => {
  const parse = createSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: "Invalid input", details: parse.error.flatten() });
  }
  const data = parse.data;
  const session = await prisma.session.create({
    data: {
      name: data.name,
      startsAt: data.startsAt ? new Date(data.startsAt) : null,
      endsAt: data.endsAt ? new Date(data.endsAt) : null,
      feeMode: data.feeMode,
      feeAmount: data.feeAmount,
      gameType: data.gameType,
      defaultBracketType: data.defaultBracketType ?? null,
      regularJoinLimit: data.regularJoinLimit,
      newJoinerLimit: data.newJoinerLimit,
      returnToQueue: data.returnToQueue,
      announcements: data.announcements,
      status: "draft",
      createdBy: req.user.id
    }
  });
  res.json(session);
});

router.post("/:id/open", requireAuth, requireRole(["admin"]), async (req, res) => {
  const { id } = req.params;
  const owned = await findSessionForUser(id, req.user.id);
  if (!owned) {
    return res.status(404).json({ error: "Session not found" });
  }
  const session = await prisma.session.update({
    where: { id },
    data: { status: "open", closedAt: null }
  });

  const activeCourts = await prisma.court.findMany({
    where: { active: true, deletedAt: null, createdBy: req.user.id }
  });
  await Promise.all(
    activeCourts.map((court) =>
      prisma.courtSession.upsert({
        where: { sessionId_courtId: { sessionId: id, courtId: court.id } },
        update: {},
        create: {
          sessionId: id,
          courtId: court.id,
          status: "available"
        }
      })
    )
  );

  res.json(session);
});

router.post("/:id/close", requireAuth, requireRole(["admin"]), async (req, res) => {
  const { id } = req.params;
  const owned = await findSessionForUser(id, req.user.id);
  if (!owned) {
    return res.status(404).json({ error: "Session not found" });
  }
  const session = await prisma.session.update({
    where: { id },
    data: { status: "closed", closedAt: new Date() }
  });
  res.json(session);
});

router.delete("/:id", requireAuth, requireRole(["admin"]), async (req, res) => {
  const { id } = req.params;
  const session = await findSessionForUser(id, req.user.id);
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }
  if (session.status === "open") {
    return res.status(409).json({ error: "Close the session before deleting it" });
  }

  await prisma.session.delete({ where: { id } });
  res.json({ deleted: true });
});

router.get("/active", requireAuth, requireRole(["admin", "staff"]), async (req, res) => {
  const session = await prisma.session.findFirst({
    where: { status: "open", createdBy: req.user.id },
    orderBy: { createdAt: "desc" }
  });
  if (!session) {
    return res.json(null);
  }

  const courtSessions = await prisma.courtSession.findMany({
    where: {
      sessionId: session.id,
      court: { deletedAt: null, active: true }
    },
    include: { court: true }
  });

  const matchIds = courtSessions
    .map((cs) => cs.currentMatchId)
    .filter(Boolean);

  const matches = matchIds.length
    ? await prisma.match.findMany({
        where: { id: { in: matchIds } },
        include: { participants: { include: { player: true } } }
      })
    : [];

  const matchMap = new Map(matches.map((m) => [m.id, m]));
  const enrichedCourtSessions = courtSessions.map((cs) => ({
    ...cs,
    currentMatch: cs.currentMatchId ? matchMap.get(cs.currentMatchId) || null : null
  }));

  res.json({ ...session, courtSessions: enrichedCourtSessions });
});

router.get("/", requireAuth, requireRole(["admin", "staff"]), async (req, res) => {
  const { status } = req.query;
  const where = status
    ? { status: String(status), createdBy: req.user.id }
    : { createdBy: req.user.id };
  const sessions = await prisma.session.findMany({
    where,
    orderBy: { createdAt: "desc" }
  });
  res.json(sessions);
});

router.get("/:id", requireAuth, requireRole(["admin", "staff"]), async (req, res) => {
  const { id } = req.params;
  const session = await findSessionForUser(id, req.user.id);
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }

  const courtSessions = await prisma.courtSession.findMany({
    where: {
      sessionId: session.id,
      court: { deletedAt: null, active: true }
    },
    include: { court: true }
  });

  const matchIds = courtSessions
    .map((cs) => cs.currentMatchId)
    .filter(Boolean);

  const matches = matchIds.length
    ? await prisma.match.findMany({
        where: { id: { in: matchIds } },
        include: { participants: { include: { player: true } } }
      })
    : [];

  const matchMap = new Map(matches.map((m) => [m.id, m]));
  const enrichedCourtSessions = courtSessions.map((cs) => ({
    ...cs,
    currentMatch: cs.currentMatchId ? matchMap.get(cs.currentMatchId) || null : null
  }));

  res.json({ ...session, courtSessions: enrichedCourtSessions });
});

router.patch("/:id/fee", requireAuth, requireRole(["admin"]), async (req, res) => {
  const parse = feeSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: "Invalid input", details: parse.error.flatten() });
  }
  if (parse.data.feeMode == null && parse.data.feeAmount == null) {
    return res.status(400).json({ error: "No fee updates provided" });
  }

  const session = await findSessionForUser(req.params.id, req.user.id);
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }
  if (session.status !== "open") {
    return res.status(409).json({ error: "Only open sessions can update fees" });
  }

  const updated = await prisma.session.update({
    where: { id: req.params.id },
    data: {
      feeMode: parse.data.feeMode ?? session.feeMode,
      feeAmount: parse.data.feeAmount ?? session.feeAmount
    }
  });
  res.json(updated);
});

router.patch("/:id", requireAuth, requireRole(["admin"]), async (req, res) => {
  const { id } = req.params;
  const parse = updateSessionSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: "Invalid input", details: parse.error.flatten() });
  }
  const data = parse.data;
  const updates = {
    name: data.name,
    gameType: data.gameType,
    defaultBracketType: data.defaultBracketType,
    feeAmount: data.feeAmount,
    regularJoinLimit: data.regularJoinLimit,
    newJoinerLimit: data.newJoinerLimit,
    announcements: data.announcements
  };
  const hasUpdates = Object.values(updates).some((value) => value !== undefined);
  if (!hasUpdates) {
    return res.status(400).json({ error: "No updates provided" });
  }

  const session = await findSessionForUser(id, req.user.id);
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }

  const updated = await prisma.session.update({
    where: { id },
    data: updates
  });
  res.json(updated);
});

router.get("/:id/players", requireAuth, requireRole(["admin", "staff"]), async (req, res) => {
  const { id } = req.params;
  const session = await findSessionForUser(id, req.user.id);
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }
  const sessionPlayers = await prisma.sessionPlayer.findMany({
    where: { sessionId: id },
    include: { player: true }
  });
  res.json(sessionPlayers);
});

router.get("/:id/rankings", requireAuth, requireRole(["admin", "staff"]), async (req, res) => {
  const { id } = req.params;
  const session = await findSessionForUser(id, req.user.id);
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }
  const sessionPlayers = await prisma.sessionPlayer.findMany({
    where: { sessionId: id },
    include: { player: true }
  });

  const ranked = sessionPlayers
    .map((sp) => {
      const winPct = sp.gamesPlayed > 0 ? sp.wins / sp.gamesPlayed : 0;
      return {
        playerId: sp.playerId,
        player: sp.player,
        gamesPlayed: sp.gamesPlayed,
        wins: sp.wins,
        losses: sp.losses,
        winPct
      };
    })
    .sort((a, b) => {
      if (b.winPct !== a.winPct) return b.winPct - a.winPct;
      if (b.wins !== a.wins) return b.wins - a.wins;
      if (b.gamesPlayed !== a.gamesPlayed) return b.gamesPlayed - a.gamesPlayed;
      return (a.player.fullName || "").localeCompare(b.player.fullName || "");
    })
    .map((item, idx) => ({ ...item, rank: idx + 1 }));

  res.json({ sessionId: id, totalPlayers: ranked.length, players: ranked });
});

router.get("/:id/bracket-overrides", requireAuth, requireRole(["admin", "staff"]), async (req, res) => {
  const { id } = req.params;
  const session = await findSessionForUser(id, req.user.id);
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }
  const parse = bracketOverrideQuerySchema.safeParse(req.query);
  if (!parse.success) {
    return res.status(400).json({ error: "Invalid query", details: parse.error.flatten() });
  }
  const where = {
    sessionId: id,
    ...(parse.data.bracketType ? { bracketType: parse.data.bracketType } : {}),
    ...(parse.data.matchFormat ? { matchFormat: parse.data.matchFormat } : {})
  };
  const overrides = await prisma.bracketOverride.findMany({
    where,
    orderBy: { createdAt: "asc" }
  });
  res.json(overrides);
});

router.post("/:id/bracket-overrides", requireAuth, requireRole(["admin", "staff"]), async (req, res) => {
  const { id } = req.params;
  const session = await findSessionForUser(id, req.user.id);
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }
  const parse = bracketOverrideSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: "Invalid input", details: parse.error.flatten() });
  }
  const { matchId, bracketType, matchFormat, winnerId, score } = parse.data;
  const override = await prisma.bracketOverride.upsert({
    where: {
      sessionId_matchId_bracketType_matchFormat: {
        sessionId: id,
        matchId,
        bracketType,
        matchFormat
      }
    },
    update: {
      winnerId: winnerId ?? null,
      scoreJson: score ?? null
    },
    create: {
      sessionId: id,
      matchId,
      bracketType,
      matchFormat,
      winnerId: winnerId ?? null,
      scoreJson: score ?? null
    }
  });
  res.json(override);
});

router.delete("/:id/bracket-overrides", requireAuth, requireRole(["admin", "staff"]), async (req, res) => {
  const { id } = req.params;
  const session = await findSessionForUser(id, req.user.id);
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }
  const parse = bracketOverrideSchema.pick({
    matchId: true,
    bracketType: true,
    matchFormat: true
  }).safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: "Invalid input", details: parse.error.flatten() });
  }
  const { matchId, bracketType, matchFormat } = parse.data;
  const result = await prisma.bracketOverride.deleteMany({
    where: { sessionId: id, matchId, bracketType, matchFormat }
  });
  res.json({ deleted: result.count });
});

export default router;
