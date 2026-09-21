// Demo fixture for client walkthroughs. Separate from prisma/seed.js on
// purpose: that one bootstraps a usable install, this one builds a venue in
// full swing — matches on court, a queue waiting, fees half collected — so
// every screen has something real on it.
//
//   npm run prisma:seed:demo
//
// Re-running rebuilds the demo workspace from scratch so a walkthrough always
// starts from the same state. It only ever touches the demo accounts below.

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";

const prisma = new PrismaClient();

const OWNER_EMAIL = process.env.DEMO_EMAIL || "demo@kue.local";
const COLLAB_EMAIL = process.env.DEMO_COLLAB_EMAIL || "coach@kue.local";
const PASSWORD = process.env.DEMO_PASSWORD || "demo1234";
const WORKSPACE_NAME = "Smash City Badminton";

// ── deterministic helpers ────────────────────────────────────────────────────
function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260921);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
function shuffled(items) {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
const token = () => crypto.randomBytes(16).toString("hex");
const MIN = 60 * 1000;
const ago = (mins) => new Date(Date.now() - mins * MIN);

// ── roster ───────────────────────────────────────────────────────────────────
const FIRST = [
  "Aaron", "Bianca", "Carlo", "Denise", "Emman", "Farah", "Gio", "Hannah",
  "Ivan", "Jaz", "Kevin", "Lianne", "Miguel", "Nadine", "Oscar", "Paula",
  "Rafa", "Sofia", "Tristan", "Ursula", "Vince", "Wendy", "Xander", "Yana"
];
const LAST = ["Abad", "Bautista", "Cruz", "Delgado", "Esguerra", "Fajardo", "Gomez", "Herrera"];
const NICK = {
  Aaron: "Ron", Carlo: "Caloy", Emman: "Em", Gio: "Gio", Ivan: "Ivs",
  Kevin: "Kev", Miguel: "Migs", Oscar: "Oca", Rafa: "Raf", Tristan: "Tris", Vince: "Vin"
};
const PLAYER_COUNT = 96;
const SESSION_PLAYERS = 80;

// A club's real spread, not four equal quarters.
const SKILL_POOL = shuffled([
  ...Array(16).fill("Beginner"),
  ...Array(40).fill("Intermediate"),
  ...Array(28).fill("Advance"),
  ...Array(12).fill("Elite")
]);

function playerData(i) {
  const first = FIRST[i % FIRST.length];
  const last = LAST[Math.floor(i / FIRST.length) % LAST.length];
  return {
    fullName: `${first} ${last}`,
    nickname: NICK[first] && i % 2 === 0 ? NICK[first] : null,
    skillLevel: SKILL_POOL[i],
    contact: i % 3 === 0 ? `09${String(170000000 + i * 137).slice(0, 9)}` : null
  };
}

async function resetWorkspace() {
  const owner = await prisma.user.findUnique({ where: { email: OWNER_EMAIL } });
  if (owner) {
    const count = await prisma.workspace.count({ where: { ownerId: owner.id } });
    // Cascades through sessions, players, groups, matches, payments and links.
    await prisma.workspace.deleteMany({ where: { ownerId: owner.id } });
    if (count) console.log(`  reset: removed ${count} existing demo workspace(s)`);
  }
}

async function ensureUser(email, fullName, roleName) {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const user = await prisma.user.upsert({
    where: { email },
    update: { fullName, passwordHash },
    create: { email, fullName, passwordHash }
  });
  const role = await prisma.role.findUnique({ where: { name: roleName } });
  if (role) {
    const has = await prisma.userRole.findFirst({ where: { userId: user.id, roleId: role.id } });
    if (!has) await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
  }
  return user;
}

async function main() {
  // Roles are shared with the main seed.
  for (const name of ["admin", "staff"]) {
    await prisma.role.upsert({ where: { name }, update: {}, create: { name } });
  }

  await resetWorkspace();

  const owner = await ensureUser(OWNER_EMAIL, "Rina Cruz", "admin");
  const collaborator = await ensureUser(COLLAB_EMAIL, "Marco Reyes", "staff");

  const workspace = await prisma.workspace.create({
    data: { name: WORKSPACE_NAME, ownerId: owner.id }
  });
  await prisma.user.update({ where: { id: owner.id }, data: { activeWorkspaceId: workspace.id } });
  await prisma.user.update({ where: { id: collaborator.id }, data: { activeWorkspaceId: workspace.id } });

  // ── collaborator + a pending invite, so both states are visible ────────────
  await prisma.workspaceMember.create({
    data: { workspaceId: workspace.id, userId: collaborator.id, invitedBy: owner.id }
  });
  await prisma.sessionAssistantInvite.create({
    data: {
      workspaceId: workspace.id,
      email: "newcoach@kue.local",
      tokenHash: crypto.createHash("sha256").update(token()).digest("hex"),
      status: "pending",
      invitedBy: owner.id,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * MIN)
    }
  });

  // ── courts ─────────────────────────────────────────────────────────────────
  await prisma.court.createMany({
    data: [1, 2, 3, 4, 5, 6].map((n) => ({
      name: `Court ${n}`,
      notes: n === 6 ? "Net needs replacing" : null,
      active: true,
      workspaceId: workspace.id,
      createdBy: owner.id
    }))
  });
  const courts = await prisma.court.findMany({
    where: { workspaceId: workspace.id }, orderBy: { name: "asc" }
  });

  // ── players ────────────────────────────────────────────────────────────────
  await prisma.player.createMany({
    data: Array.from({ length: PLAYER_COUNT }, (_, i) => ({
      ...playerData(i), workspaceId: workspace.id, createdBy: owner.id
    }))
  });
  const players = await prisma.player.findMany({
    where: { workspaceId: workspace.id }, orderBy: { createdAt: "asc" }
  });

  // ── groups ─────────────────────────────────────────────────────────────────
  const groupSpecs = [
    { name: "Tuesday Regulars", description: "The midweek core. Most of Friday's crowd comes from here.", slice: [0, 40] },
    { name: "Weekend Social", description: "Saturday morning casuals, mixed levels.", slice: [40, 68] },
    { name: "Corporate League", description: "Company team — Thursdays, fixed pairs.", slice: [68, 84] }
  ];
  const groups = [];
  for (const spec of groupSpecs) {
    const group = await prisma.group.create({
      data: {
        name: spec.name, description: spec.description,
        workspaceId: workspace.id, createdBy: owner.id
      }
    });
    const members = players.slice(spec.slice[0], spec.slice[1]);
    await prisma.groupMember.createMany({
      data: members.map((p, i) => ({
        groupId: group.id,
        playerId: p.id,
        role: i === 0 ? "owner" : i < 3 ? "manager" : "member"
      }))
    });
    groups.push(group);
  }
  // One live invite link and one revoked, so both states show.
  await prisma.groupInviteLink.create({ data: { token: token(), groupId: groups[0].id } });
  await prisma.groupInviteLink.create({
    data: { token: token(), groupId: groups[1].id, revokedAt: ago(120) }
  });

  // ── the session ────────────────────────────────────────────────────────────
  const today = new Date();
  const startsAt = new Date(today); startsAt.setHours(18, 0, 0, 0);
  const endsAt = new Date(today); endsAt.setHours(22, 0, 0, 0);

  const session = await prisma.session.create({
    data: {
      name: "Friday Night Open Play",
      location: "Smash City Arena, Complex A",
      startsAt, endsAt,
      status: "open",
      mode: "usual",
      gameType: "doubles",
      feeMode: "flat",
      feeAmount: 150,
      requirePaymentToJoin: true,
      paymentDeadline: new Date(startsAt.getTime() - 120 * MIN),
      // 76 slots, so the last few arrivals land on the waitlist.
      regularJoinLimit: 70,
      newJoinerLimit: 6,
      returnToQueue: true,
      matchByLevel: true,
      announcements: "Shuttles are ₱30 per tube. Last call for courts at 9:30pm.",
      groupId: groups[0].id,
      workspaceId: workspace.id,
      createdBy: owner.id
    }
  });

  await prisma.courtSession.createMany({
    data: courts.map((c) => ({
      sessionId: session.id,
      courtId: c.id,
      status: c.name === "Court 6" ? "maintenance" : "available"
    }))
  });
  const courtSessions = await prisma.courtSession.findMany({
    where: { sessionId: session.id }, include: { court: true }, orderBy: { court: { name: "asc" } }
  });

  // ── who's here, and in what state ──────────────────────────────────────────
  // Deliberately mixed so every badge and gate on the Players tab is visible.
  const roster = players.slice(0, SESSION_PLAYERS);
  const plan = [
    ["present", 34], ["played", 26], ["ready", 8],
    ["away", 4], ["done", 3], ["waitlisted", 3], ["pending_payment", 2]
  ];
  const firstCheckIn = Date.now() - 170 * MIN;
  let cursor = 0;
  const sessionPlayerRows = [];
  const playedIds = [];
  const presentIds = [];
  for (const [kind, n] of plan) {
    for (let k = 0; k < n; k += 1) {
      const p = roster[cursor];
      const checkedInAt = new Date(firstCheckIn + cursor * 105 * 1000);
      const row = {
        sessionId: session.id, playerId: p.id, checkedInAt,
        isNewPlayer: cursor % 11 === 0,
        gamesPlayed: 0, wins: 0, losses: 0, totalQueueSeconds: 0
      };
      if (kind === "played") {
        const games = 1 + Math.floor(rand() * 5);
        const wins = Math.floor(rand() * (games + 1));
        Object.assign(row, {
          status: "checked_in",
          lastPlayedAt: ago(4 + Math.floor(rand() * 70)),
          gamesPlayed: games, wins, losses: games - wins,
          totalQueueSeconds: 300 + Math.floor(rand() * 2400)
        });
        playedIds.push(p.id);
      } else if (kind === "present") {
        row.status = "present";
        presentIds.push(p.id);
      } else if (kind === "ready") {
        row.status = "checked_in"; // shows as "Ready" — not yet confirmed at the venue
      } else {
        row.status = kind;
        if (kind === "done" || kind === "away") {
          const games = 2 + Math.floor(rand() * 4);
          const wins = Math.floor(rand() * (games + 1));
          Object.assign(row, {
            lastPlayedAt: ago(20 + Math.floor(rand() * 90)),
            gamesPlayed: games, wins, losses: games - wins
          });
        }
      }
      sessionPlayerRows.push(row);
      cursor += 1;
    }
  }
  await prisma.sessionPlayer.createMany({ data: sessionPlayerRows });

  // ── history: finished matches ──────────────────────────────────────────────
  const playable = shuffled([...playedIds, ...presentIds]);
  let slot = 0;
  const nextFour = () => {
    const four = playable.slice(slot, slot + 4);
    slot = (slot + 4) % Math.max(1, playable.length - 4);
    return four;
  };
  for (let m = 0; m < 18; m += 1) {
    const four = nextFour();
    if (four.length < 4) break;
    const winner = rand() < 0.5 ? 1 : 2;
    const loserScore = 12 + Math.floor(rand() * 9);
    const endedAt = ago(150 - m * 7);
    const match = await prisma.match.create({
      data: {
        sessionId: session.id,
        status: "ended",
        matchType: "doubles",
        startedAt: new Date(endedAt.getTime() - 13 * MIN),
        endedAt,
        winnerTeam: winner,
        scoreJson: winner === 1 ? { a: 21, b: loserScore } : { a: loserScore, b: 21 }
      }
    });
    await prisma.matchParticipant.createMany({
      data: four.map((playerId, i) => ({ matchId: match.id, playerId, teamNumber: i < 2 ? 1 : 2 }))
    });
  }
  // One cancelled, so that path is represented too.
  const cancelledFour = nextFour();
  const cancelled = await prisma.match.create({
    data: {
      sessionId: session.id, status: "cancelled", matchType: "doubles",
      startedAt: ago(96), endedAt: ago(92)
    }
  });
  await prisma.matchParticipant.createMany({
    data: cancelledFour.map((playerId, i) => ({
      matchId: cancelled.id, playerId, teamNumber: i < 2 ? 1 : 2
    }))
  });

  // ── live: four courts mid-match ────────────────────────────────────────────
  const busy = courtSessions.filter((cs) => cs.status === "available").slice(0, 4);
  const onCourt = new Set();
  for (const cs of busy) {
    const four = nextFour();
    if (four.length < 4) break;
    const match = await prisma.match.create({
      data: {
        sessionId: session.id, courtSessionId: cs.id,
        status: "active", matchType: "doubles",
        startedAt: ago(2 + Math.floor(rand() * 11))
      }
    });
    await prisma.matchParticipant.createMany({
      data: four.map((playerId, i) => ({ matchId: match.id, playerId, teamNumber: i < 2 ? 1 : 2 }))
    });
    await prisma.courtSession.update({
      where: { id: cs.id }, data: { status: "in_match", currentMatchId: match.id }
    });
    four.forEach((id) => onCourt.add(id));
  }

  // ── the queue waiting for a court ──────────────────────────────────────────
  const queueable = presentIds.filter((id) => !onCourt.has(id));
  let position = 1;
  for (let i = 0; i + 1 < 12 && i + 1 < queueable.length; i += 2) {
    const pair = [queueable[i], queueable[i + 1]];
    const entry = await prisma.queueEntry.create({
      data: {
        sessionId: session.id, type: "doubles", status: "queued",
        position, source: "staff", createdAt: ago(20 - position)
      }
    });
    await prisma.queueEntryPlayer.createMany({
      data: pair.map((playerId) => ({ entryId: entry.id, playerId }))
    });
    await prisma.queueEvent.create({
      data: {
        sessionId: session.id, entryId: entry.id, type: "enqueued",
        actorType: "staff", actorId: owner.id,
        payload: { playerIds: pair, position }
      }
    });
    position += 1;
  }

  // ── fees: collected, pending proof, and rejected ───────────────────────────
  const paying = roster.filter((_, i) => i < 62);
  const paymentRows = paying.map((p, i) => {
    const status = i < 52 ? "confirmed" : i < 59 ? "pending" : "rejected";
    return {
      sessionId: session.id, playerId: p.id, amount: 150,
      method: pick(["cash", "gcash", "maya", "bank transfer"]),
      note: status === "rejected" ? "Screenshot was for another session" : null,
      // Only the ones awaiting review or rejected carry an uploaded proof.
      proofImageUrl: status === "confirmed" ? null : "https://placehold.co/600x800/png?text=Proof",
      status,
      createdAt: ago(200 - i)
    };
  });
  await prisma.payment.createMany({ data: paymentRows });

  // ── share + invite links ───────────────────────────────────────────────────
  await prisma.sessionShareLink.create({ data: { token: token(), sessionId: session.id } });
  await prisma.sessionInviteLink.create({ data: { token: token(), sessionId: session.id } });
  for (const p of roster.slice(0, 5)) {
    await prisma.shareLink.create({
      data: { token: token(), sessionId: session.id, playerId: p.id }
    });
  }

  // ── a finished tournament, so Manage Sessions and history aren't empty ─────
  const past = await prisma.session.create({
    data: {
      name: "Club Championship (March)",
      location: "Smash City Arena, Complex B",
      startsAt: ago(60 * 24 * 14), endsAt: ago(60 * 24 * 14 - 300),
      status: "closed",
      mode: "tournament",
      gameType: "doubles",
      defaultBracketType: "single",
      feeMode: "flat", feeAmount: 250,
      workspaceId: workspace.id, createdBy: owner.id,
      closedAt: ago(60 * 24 * 14 - 300)
    }
  });
  const TEAM_COLORS = ["#ef4444", "#3b82f6", "#22c55e", "#f59e0b"];
  const teamPlayers = players.slice(84, 96);
  for (let t = 0; t < 4; t += 1) {
    const team = await prisma.team.create({
      data: {
        name: ["Smashers", "Drop Kings", "Net Ninjas", "Rally Co"][t],
        color: TEAM_COLORS[t],
        workspaceId: workspace.id, createdBy: owner.id
      }
    });
    const members = teamPlayers.slice(t * 3, t * 3 + 3);
    await prisma.player.updateMany({
      where: { id: { in: members.map((p) => p.id) } }, data: { teamId: team.id }
    });
    await prisma.sessionPlayer.createMany({
      data: members.map((p) => ({
        sessionId: past.id, playerId: p.id, status: "done",
        gamesPlayed: 3, wins: t < 2 ? 2 : 1, losses: t < 2 ? 1 : 2,
        lastPlayedAt: ago(60 * 24 * 14 - 280)
      }))
    });
  }

  const counts = {
    players: await prisma.player.count({ where: { workspaceId: workspace.id } }),
    groups: groups.length,
    sessionPlayers: await prisma.sessionPlayer.count({ where: { sessionId: session.id } }),
    matches: await prisma.match.count({ where: { sessionId: session.id } }),
    queued: await prisma.queueEntry.count({ where: { sessionId: session.id, status: "queued" } }),
    payments: await prisma.payment.count({ where: { sessionId: session.id } })
  };

  console.log(`
Demo fixture ready — "${WORKSPACE_NAME}"

  Queue master   ${OWNER_EMAIL} / ${PASSWORD}
  Collaborator   ${COLLAB_EMAIL} / ${PASSWORD}

  ${counts.players} players, ${counts.groups} groups, 6 courts (1 in maintenance)
  "Friday Night Open Play" — open, ${counts.sessionPlayers} players
     4 courts mid-match, ${counts.queued} pairs queued, ${counts.matches} matches on record
     ${counts.payments} fee records: collected, awaiting proof, and rejected
     player states include Present, Idle, Ready, Away, Done, Waitlisted
  "Club Championship (March)" — closed tournament with 4 teams
`);
}

main()
  .then(async () => { await prisma.$disconnect(); })
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
