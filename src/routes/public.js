import express from "express";
import prisma from "../lib/prisma.js";

const router = express.Router();

router.get("/player/:token", async (req, res) => {
  const { token } = req.params;
  const link = await prisma.shareLink.findUnique({
    where: { token },
    include: { player: true, session: true }
  });

  if (!link || link.revokedAt) {
    return res.status(404).json({ error: "Link not found" });
  }
  if (link.expiresAt && new Date(link.expiresAt) < new Date()) {
    return res.status(410).json({ error: "Link expired" });
  }

  const session = link.session;
  const sessionPlayer = await prisma.sessionPlayer.findUnique({
    where: { sessionId_playerId: { sessionId: session.id, playerId: link.playerId } }
  });

  const queueEntry = await prisma.queueEntry.findFirst({
    where: {
      sessionId: session.id,
      status: "queued",
      players: { some: { playerId: link.playerId } }
    }
  });

  const queuePosition = queueEntry?.position || null;
  const isInQueue = Boolean(queueEntry);

  const currentMatch = await prisma.match.findFirst({
    where: {
      sessionId: session.id,
      status: "active",
      participants: { some: { playerId: link.playerId } }
    }
  });

  let court = null;
  if (currentMatch?.courtSessionId) {
    const courtSession = await prisma.courtSession.findUnique({
      where: { id: currentMatch.courtSessionId },
      include: { court: true }
    });
    court = courtSession?.court || null;
  }

  const estimatedWaitMinutes = queuePosition ? Math.max(0, queuePosition - 1) * 15 : null;
  const upNext = queuePosition === 1;

  res.json({
    session: { id: session.id, name: session.name, status: session.status, announcements: session.announcements },
    player: { id: link.player.id, fullName: link.player.fullName, nickname: link.player.nickname },
    status: sessionPlayer?.status || "unknown",
    inQueue: isInQueue,
    queuePosition,
    upNext,
    estimatedWaitMinutes,
    currentCourt: court,
    currentMatchId: currentMatch?.id || null
  });
});

router.get("/board/:sessionId", async (req, res) => {
  const { sessionId } = req.params;
  const session = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!session) return res.status(404).json({ error: "Session not found" });

  const courtSessions = await prisma.courtSession.findMany({
    where: { sessionId },
    include: { court: true }
  });

  const matches = await prisma.match.findMany({
    where: { sessionId, status: "active" },
    include: { participants: { include: { player: true } } }
  });

  const matchMap = new Map(matches.map((m) => [m.id, m]));

  const board = courtSessions.map((cs) => ({
    court: cs.court,
    status: cs.status,
    currentMatch: cs.currentMatchId ? matchMap.get(cs.currentMatchId) || null : null
  }));

  res.json({ session: { id: session.id, name: session.name }, courts: board });
});

router.get("/queue/:token/rankings", async (req, res) => {
  const { token } = req.params;
  const link = await prisma.sessionShareLink.findUnique({
    where: { token },
    include: { session: true }
  });

  if (!link || link.revokedAt) {
    return res.status(404).json({ error: "Link not found" });
  }
  if (link.expiresAt && new Date(link.expiresAt) < new Date()) {
    return res.status(410).json({ error: "Link expired" });
  }

  const session = link.session;
  const sessionPlayers = await prisma.sessionPlayer.findMany({
    where: { sessionId: session.id },
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

  res.json({
    session: { id: session.id, name: session.name },
    totalPlayers: ranked.length,
    players: ranked
  });
});

router.get("/queue/:token/bracket", async (req, res) => {
  const { token } = req.params;
  const link = await prisma.sessionShareLink.findUnique({
    where: { token },
    include: { session: true }
  });

  if (!link || link.revokedAt) {
    return res.status(404).json({ error: "Link not found" });
  }
  if (link.expiresAt && new Date(link.expiresAt) < new Date()) {
    return res.status(410).json({ error: "Link expired" });
  }

  const session = link.session;

  const sessionPlayers = await prisma.sessionPlayer.findMany({
    where: { sessionId: session.id },
    include: { player: true },
    orderBy: { checkedInAt: "asc" }
  });

  const matches = await prisma.match.findMany({
    where: { sessionId: session.id },
    include: { participants: { include: { player: true } } }
  });

  const overrides = await prisma.bracketOverride.findMany({
    where: { sessionId: session.id },
    orderBy: { createdAt: "asc" }
  });

  res.json({
    session: {
      id: session.id,
      name: session.name,
      gameType: session.gameType,
      defaultBracketType: session.defaultBracketType
    },
    players: sessionPlayers,
    matches,
    overrides
  });
});

router.get("/queue/:token", async (req, res) => {
  const { token } = req.params;
  const link = await prisma.sessionShareLink.findUnique({
    where: { token },
    include: { session: true }
  });

  if (!link || link.revokedAt) {
    return res.status(404).json({ error: "Link not found" });
  }
  if (link.expiresAt && new Date(link.expiresAt) < new Date()) {
    return res.status(410).json({ error: "Link expired" });
  }

  const session = link.session;

  const courtSessions = await prisma.courtSession.findMany({
    where: { sessionId: session.id },
    include: { court: true }
  });

  const matches = await prisma.match.findMany({
    where: { sessionId: session.id, status: "active" },
    include: { participants: { include: { player: true } } }
  });

  const matchMap = new Map(matches.map((m) => [m.id, m]));

  const courts = courtSessions.map((cs) => ({
    court: cs.court,
    status: cs.status,
    currentMatch: cs.currentMatchId ? matchMap.get(cs.currentMatchId) || null : null
  }));

  const queueEntries = await prisma.queueEntry.findMany({
    where: { sessionId: session.id, status: "queued" },
    orderBy: { position: "asc" },
    include: { players: { include: { player: true } } }
  });

  res.json({
    session: {
      id: session.id,
      name: session.name,
      gameType: session.gameType,
      defaultBracketType: session.defaultBracketType
    },
    courts,
    queue: queueEntries
  });
});

router.get("/session-invite/:token", async (req, res) => {
  const { token } = req.params;
  const link = await prisma.sessionInviteLink.findUnique({
    where: { token },
    include: { session: true }
  });

  if (!link || link.revokedAt) {
    return res.status(404).json({ error: "Link not found" });
  }
  if (link.expiresAt && new Date(link.expiresAt) < new Date()) {
    return res.status(410).json({ error: "Link expired" });
  }

  res.json({
    session: {
      id: link.session.id,
      name: link.session.name,
      status: link.session.status,
      startsAt: link.session.startsAt,
      endsAt: link.session.endsAt
    }
  });
});

router.get("/session-invite/:token/players", async (req, res) => {
  const { token } = req.params;
  const link = await prisma.sessionInviteLink.findUnique({
    where: { token },
    include: { session: true }
  });

  if (!link || link.revokedAt) {
    return res.status(404).json({ error: "Link not found" });
  }
  if (link.expiresAt && new Date(link.expiresAt) < new Date()) {
    return res.status(410).json({ error: "Link expired" });
  }

  const sessionPlayers = await prisma.sessionPlayer.findMany({
    where: { sessionId: link.session.id, status: { not: "done" } },
    include: { player: true },
    orderBy: { checkedInAt: "asc" }
  });

  res.json({
    session: {
      id: link.session.id,
      name: link.session.name,
      regularJoinLimit: link.session.regularJoinLimit,
      newJoinerLimit: link.session.newJoinerLimit
    },
    players: sessionPlayers.map((sp) => ({
      id: sp.id,
      playerId: sp.playerId,
      checkedInAt: sp.checkedInAt,
      isNewPlayer: sp.isNewPlayer,
      status: sp.status,
      player: {
        id: sp.player.id,
        fullName: sp.player.fullName,
        nickname: sp.player.nickname
      }
    }))
  });
});

router.post("/session-invite/:token/register", async (req, res) => {
  const { token } = req.params;
  const { fullName, nickname, contact, newPlayer } = req.body || {};
  const isNewPlayer = typeof newPlayer === "boolean" ? newPlayer : false;

  if (!fullName || typeof fullName !== "string") {
    return res.status(400).json({ error: "Full name is required" });
  }

  const link = await prisma.sessionInviteLink.findUnique({
    where: { token },
    include: { session: true }
  });

  if (!link || link.revokedAt) {
    return res.status(404).json({ error: "Link not found" });
  }
  if (link.expiresAt && new Date(link.expiresAt) < new Date()) {
    return res.status(410).json({ error: "Link expired" });
  }
  if (link.session.status !== "open") {
    return res.status(409).json({ error: "Session is not open" });
  }

  const ownerId = link.session.createdBy || null;

  let player = null;
  if (contact) {
    player = await prisma.player.findFirst({
      where: {
        contact,
        deletedAt: null,
        ...(ownerId ? { createdBy: ownerId } : {})
      }
    });
  }
  if (!player) {
    player = await prisma.player.findFirst({
      where: {
        fullName,
        deletedAt: null,
        ...(ownerId ? { createdBy: ownerId } : {})
      }
    });
  }

  if (!player) {
    player = await prisma.player.create({
      data: { fullName, nickname, contact, createdBy: ownerId }
    });
  } else if (nickname || contact) {
    player = await prisma.player.update({
      where: { id: player.id },
      data: {
        nickname: nickname || player.nickname,
        contact: contact || player.contact
      }
    });
  }

  const sessionPlayer = await prisma.sessionPlayer.upsert({
    where: { sessionId_playerId: { sessionId: link.session.id, playerId: player.id } },
    update: { status: "checked_in", isNewPlayer },
    create: {
      sessionId: link.session.id,
      playerId: player.id,
      status: "checked_in",
      isNewPlayer
    }
  });

  res.json({
    player: { id: player.id, fullName: player.fullName, nickname: player.nickname, contact: player.contact },
    sessionPlayer
  });
});

export default router;
