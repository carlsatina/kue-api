import express from "express";
import { randomUUID } from "crypto";
import prisma from "../lib/prisma.js";
import { upload, compressToTarget } from "../lib/imageUpload.js";
import { saveProof } from "../lib/storage.js";
import { reconcileGatedSession, getCapacityState, deadlinePassed } from "../services/joinGate.js";
import { loadAssistantInvite, inviteSummary } from "../utils/invites.js";

const router = express.Router();

// Unauthenticated lookup of an assistant invite, so the accept page can greet a
// signed-out invitee and prefill their email before they sign up or sign in.
router.get("/assistant-invite/:token", async (req, res) => {
  const invite = await loadAssistantInvite(req.params.token);
  if (!invite) return res.status(404).json({ error: "Invite not found" });
  res.json(inviteSummary(invite));
});

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

  res.json({ session: { id: session.id, name: session.name, location: session.location, startsAt: session.startsAt, endsAt: session.endsAt }, courts: board });
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

router.get("/queue/:token/team-stats", async (req, res) => {
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
  if (session.mode !== "tournament") {
    return res.json({
      session: { id: session.id, name: session.name, mode: session.mode },
      scope: "all",
      totalTeams: 0,
      teams: [],
      champion: null
    });
  }

  const matchWhere = session.workspaceId
    ? {
        status: "ended",
        session: { workspaceId: session.workspaceId, mode: "tournament" }
      }
    : { sessionId: session.id, status: "ended" };

  const matches = await prisma.match.findMany({
    where: matchWhere,
    include: { participants: { include: { team: true } } }
  });

  const stats = new Map();
  const teamInfo = new Map();
  const ensureTeam = (teamId) => {
    if (stats.has(teamId)) return stats.get(teamId);
    const info = teamInfo.get(teamId) || {};
    const entry = {
      id: teamId,
      name: info.name || "Team",
      color: info.color || null,
      gamesPlayed: 0,
      wins: 0,
      losses: 0,
      points: 0,
      winPct: 0,
      rank: 0
    };
    stats.set(teamId, entry);
    return entry;
  };

  const resolveTeamId = (participants, teamNumber) => {
    const ids = participants
      .filter((p) => p.teamNumber === teamNumber)
      .map((p) => p.teamId)
      .filter(Boolean);
    if (!ids.length) return null;
    const unique = new Set(ids);
    if (unique.size !== 1) return null;
    return ids[0];
  };

  matches.forEach((match) => {
    if (match.winnerTeam !== 1 && match.winnerTeam !== 2) return;
    match.participants.forEach((participant) => {
      if (participant.teamId && participant.team) {
        teamInfo.set(participant.teamId, {
          name: participant.team.name,
          color: participant.team.color
        });
      }
    });

    const team1Id = resolveTeamId(match.participants, 1);
    const team2Id = resolveTeamId(match.participants, 2);
    if (!team1Id || !team2Id) return;
    if (team1Id === team2Id) return;

    const team1 = ensureTeam(team1Id);
    const team2 = ensureTeam(team2Id);

    team1.gamesPlayed += 1;
    team2.gamesPlayed += 1;

    if (match.winnerTeam === 1) {
      team1.wins += 1;
      team2.losses += 1;
      team1.points += 10;
      team2.points += 6;
    } else if (match.winnerTeam === 2) {
      team2.wins += 1;
      team1.losses += 1;
      team2.points += 10;
      team1.points += 6;
    }
  });

  const rows = [...stats.values()].map((team) => ({
    ...team,
    winPct: team.gamesPlayed ? team.wins / team.gamesPlayed : 0
  }));

  rows.sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (b.points !== a.points) return b.points - a.points;
    return a.name.localeCompare(b.name);
  });

  const ranked = rows.map((team, idx) => ({ ...team, rank: idx + 1 }));
  const champion = ranked[0] || null;

  res.json({
    session: { id: session.id, name: session.name, mode: session.mode },
    scope: ownerId ? "all" : "session",
    totalTeams: ranked.length,
    teams: ranked,
    champion
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
    include: { participants: { include: { player: true, team: true } } }
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
      defaultBracketType: session.defaultBracketType,
      mode: session.mode
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
      location: session.location,
      startsAt: session.startsAt,
      endsAt: session.endsAt,
      gameType: session.gameType,
      defaultBracketType: session.defaultBracketType,
      mode: session.mode
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

  await reconcileGatedSession(link.session.id);
  const session = await prisma.session.findUnique({ where: { id: link.session.id } });
  const { hasRoom } = await getCapacityState(session);

  res.json({
    session: {
      id: session.id,
      name: session.name,
      status: session.status,
      location: session.location,
      startsAt: session.startsAt,
      endsAt: session.endsAt,
      requirePaymentToJoin: session.requirePaymentToJoin,
      fee: Number(session.feeAmount),
      paymentDeadline: session.paymentDeadline,
      deadlinePassed: deadlinePassed(session),
      hasRoom
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
    where: { sessionId: link.session.id, status: { notIn: ["done", "pending_payment", "waitlisted"] } },
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

// ── Public Fees (session-scoped) ──────────────────────────────────────────────

async function resolveSessionLink(token) {
  const link = await prisma.sessionShareLink.findUnique({
    where: { token },
    include: { session: true }
  });
  if (!link || link.revokedAt) return null;
  if (link.expiresAt && new Date(link.expiresAt) < new Date()) return null;
  return link;
}

function buildPlayerBalance(session, sp, payments) {
  const mine = payments.filter((p) => p.playerId === sp.playerId);
  const paid = mine.filter((p) => p.status === "confirmed").reduce((sum, p) => sum + Number(p.amount), 0);
  const due = session.feeMode === "flat"
    ? Number(session.feeAmount)
    : Number(session.feeAmount) * sp.gamesPlayed;
  const sorted = mine.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const pending  = sorted.find((p) => p.status === "pending")  || null;
  const rejected = sorted.find((p) => p.status === "rejected") || null;
  const fmt = (p) => p ? { id: p.id, method: p.method, proofImageUrl: p.proofImageUrl, createdAt: p.createdAt } : null;
  return {
    playerId: sp.playerId,
    player: { id: sp.player.id, fullName: sp.player.fullName, nickname: sp.player.nickname },
    status: sp.status,
    waitlisted: sp.status === "waitlisted",
    due,
    paid,
    remaining: Math.max(0, due - paid),
    pendingPayment: fmt(pending),
    rejectedPayment: fmt(rejected)
  };
}

router.get("/fees-session/:token", async (req, res) => {
  const link = await resolveSessionLink(req.params.token);
  if (!link) return res.status(404).json({ error: "Link not found or expired" });

  const { session } = link;
  await reconcileGatedSession(session.id);
  const sessionPlayers = await prisma.sessionPlayer.findMany({
    where: { sessionId: session.id },
    include: { player: true }
  });
  const payments = await prisma.payment.findMany({ where: { sessionId: session.id } });

  const balances = sessionPlayers.map((sp) => buildPlayerBalance(session, sp, payments));
  const { hasRoom } = await getCapacityState(session);

  res.json({
    session: {
      id: session.id,
      name: session.name,
      location: session.location,
      startsAt: session.startsAt,
      endsAt: session.endsAt,
      requirePaymentToJoin: session.requirePaymentToJoin,
      paymentDeadline: session.paymentDeadline,
      deadlinePassed: deadlinePassed(session),
      hasOpenSlot: hasRoom
    },
    balances
  });
});

router.post("/fees-session/:token/proof", upload.single("proof"), async (req, res) => {
  const link = await resolveSessionLink(req.params.token);
  if (!link) return res.status(404).json({ error: "Link not found or expired" });

  const { session } = link;
  const { playerId, method: rawMethod } = req.body || {};

  if (!playerId || typeof playerId !== "string") {
    return res.status(400).json({ error: "playerId is required" });
  }

  await reconcileGatedSession(session.id);

  const sp = await prisma.sessionPlayer.findUnique({
    where: { sessionId_playerId: { sessionId: session.id, playerId } }
  });
  if (!sp) return res.status(404).json({ error: "Player not in this session" });

  // Payment-gated sessions: a waitlisted player can only pay once a slot frees up.
  if (session.requirePaymentToJoin && sp.status === "waitlisted") {
    const { hasRoom } = await getCapacityState(session);
    if (!hasRoom) {
      return res.status(409).json({ error: "The session is full. You're on the waitlist." });
    }
    await prisma.sessionPlayer.update({
      where: { sessionId_playerId: { sessionId: session.id, playerId } },
      data: { status: "pending_payment" }
    });
  }

  const payments = await prisma.payment.findMany({ where: { sessionId: session.id, playerId } });
  const paid = payments.filter((p) => p.status === "confirmed").reduce((s, p) => s + Number(p.amount), 0);
  const due = session.feeMode === "flat"
    ? Number(session.feeAmount)
    : Number(session.feeAmount) * sp.gamesPlayed;
  const remaining = Math.max(0, due - paid);

  if (remaining <= 0) return res.status(409).json({ error: "No outstanding balance" });

  const alreadyPending = payments.some((p) => p.playerId === playerId && p.status === "pending");
  if (alreadyPending) return res.status(409).json({ error: "A proof is already pending admin review" });

  if (!req.file) return res.status(400).json({ error: "Proof image is required" });

  const method = typeof rawMethod === "string" && rawMethod.trim() ? rawMethod.trim() : "online";
  const compressed = await compressToTarget(req.file.buffer);
  const filename = `${randomUUID()}.jpg`;
  const proofImageUrl = await saveProof(compressed, filename);

  const payment = await prisma.payment.create({
    data: {
      sessionId: session.id,
      playerId,
      amount: remaining,
      method,
      proofImageUrl,
      status: "pending"
    }
  });

  res.json({
    id: payment.id,
    method: payment.method,
    proofImageUrl: payment.proofImageUrl,
    createdAt: payment.createdAt
  });
});

// ─────────────────────────────────────────────────────────────────────────────

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

  const workspaceId = link.session.workspaceId;

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
    player = await prisma.player.create({
      data: { fullName, nickname, contact, workspaceId, createdBy: link.session.createdBy || null }
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

  await reconcileGatedSession(link.session.id);
  const session = await prisma.session.findUnique({ where: { id: link.session.id } });

  const existing = await prisma.sessionPlayer.findUnique({
    where: { sessionId_playerId: { sessionId: session.id, playerId: player.id } }
  });
  const alreadyAdmitted = existing && ["checked_in", "present", "away", "done"].includes(existing.status);

  let status;
  if (!session.requirePaymentToJoin || alreadyAdmitted) {
    status = "checked_in";
  } else if (existing && existing.status === "pending_payment") {
    status = "pending_payment";
  } else {
    // New joiner or currently waitlisted: claim a slot if one is free.
    const { hasRoom } = await getCapacityState(session);
    status = hasRoom ? "pending_payment" : "waitlisted";
  }

  const sessionPlayer = await prisma.sessionPlayer.upsert({
    where: { sessionId_playerId: { sessionId: session.id, playerId: player.id } },
    update: { status, isNewPlayer },
    create: {
      sessionId: session.id,
      playerId: player.id,
      status,
      isNewPlayer
    }
  });

  res.json({
    player: { id: player.id, fullName: player.fullName, nickname: player.nickname, contact: player.contact },
    sessionPlayer,
    status,
    canPay: status === "pending_payment",
    waitlisted: status === "waitlisted",
    fee: Number(session.feeAmount),
    paymentDeadline: session.paymentDeadline,
    deadlinePassed: deadlinePassed(session)
  });
});

router.post("/session-invite/:token/proof", upload.single("proof"), async (req, res) => {
  const { token } = req.params;
  const { playerId, method: rawMethod } = req.body || {};

  if (!playerId || typeof playerId !== "string") {
    return res.status(400).json({ error: "playerId is required" });
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

  await reconcileGatedSession(link.session.id);
  const session = await prisma.session.findUnique({ where: { id: link.session.id } });

  const sp = await prisma.sessionPlayer.findUnique({
    where: { sessionId_playerId: { sessionId: session.id, playerId } }
  });
  if (!sp) return res.status(404).json({ error: "Player not in this session" });
  if (["checked_in", "present", "away", "done"].includes(sp.status)) {
    return res.status(409).json({ error: "You're already in this session" });
  }

  // Waitlisted players can only pay once a slot frees up (capacity permitting).
  if (sp.status === "waitlisted") {
    const { hasRoom } = await getCapacityState(session);
    if (!hasRoom) {
      return res.status(409).json({ error: "The session is full. You're on the waitlist." });
    }
    await prisma.sessionPlayer.update({
      where: { sessionId_playerId: { sessionId: session.id, playerId } },
      data: { status: "pending_payment" }
    });
  }

  const payments = await prisma.payment.findMany({ where: { sessionId: session.id, playerId } });
  const alreadyPending = payments.some((p) => p.status === "pending");
  if (alreadyPending) return res.status(409).json({ error: "A proof is already pending admin review" });

  if (!req.file) return res.status(400).json({ error: "Proof image is required" });

  const method = typeof rawMethod === "string" && rawMethod.trim() ? rawMethod.trim() : "online";
  const compressed = await compressToTarget(req.file.buffer);
  const filename = `${randomUUID()}.jpg`;
  const proofImageUrl = await saveProof(compressed, filename);

  const payment = await prisma.payment.create({
    data: {
      sessionId: session.id,
      playerId,
      amount: Number(session.feeAmount),
      method,
      proofImageUrl,
      status: "pending"
    }
  });

  res.json({
    id: payment.id,
    method: payment.method,
    proofImageUrl: payment.proofImageUrl,
    createdAt: payment.createdAt
  });
});

export default router;
