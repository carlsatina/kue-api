import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function seedRoles() {
  await prisma.role.upsert({
    where: { name: "admin" },
    update: {},
    create: { name: "admin" }
  });
  await prisma.role.upsert({
    where: { name: "staff" },
    update: {},
    create: { name: "staff" }
  });
}

async function seedAdmin() {
  const email = process.env.ADMIN_EMAIL || "admin@kue.local";
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return existing;

  const password = process.env.ADMIN_PASSWORD || "password123";
  const passwordHash = await bcrypt.hash(password, 10);

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      fullName: "Queue Master"
    }
  });

  const adminRole = await prisma.role.findUnique({ where: { name: "admin" } });
  await prisma.userRole.create({
    data: {
      userId: user.id,
      roleId: adminRole.id
    }
  });

  return user;
}

// Every user owns a default workspace, and all courts/players/sessions are
// scoped to one. Mirror what registration does so the seeded admin lands in a
// workspace instead of resolving to none.
async function seedWorkspace(admin) {
  const existing = await prisma.workspace.findFirst({ where: { ownerId: admin.id } });
  const workspace =
    existing ||
    (await prisma.workspace.create({
      data: {
        name: `${(admin.fullName || "").trim() || admin.email.split("@")[0]}'s workspace`,
        ownerId: admin.id
      }
    }));

  if (admin.activeWorkspaceId !== workspace.id) {
    await prisma.user.update({
      where: { id: admin.id },
      data: { activeWorkspaceId: workspace.id }
    });
  }

  return workspace;
}

async function seedCourtsPlayers(workspaceId, createdBy) {
  const courtCount = await prisma.court.count({ where: { workspaceId } });
  if (courtCount === 0) {
    await prisma.court.createMany({
      data: [
        { name: "Court 1", notes: "Main court" },
        { name: "Court 2", notes: "Side court" },
        { name: "Court 3", notes: "Warm-up" }
      ].map((court) => ({ ...court, workspaceId, createdBy }))
    });
  }

  const playerCount = await prisma.player.count({ where: { workspaceId } });
  if (playerCount === 0) {
    await prisma.player.createMany({
      data: [
        { fullName: "Alex Rivera", nickname: "Alex" },
        { fullName: "Mia Santos", nickname: "Mia" },
        { fullName: "Jordan Lee", nickname: "J" },
        { fullName: "Chris Park", nickname: "Chris" },
        { fullName: "Sam Patel", nickname: "Sam" },
        { fullName: "Jamie Cruz", nickname: "Jamie" },
        { fullName: "Riley Tan", nickname: "Riley" },
        { fullName: "Taylor Kim", nickname: "TK" }
      ].map((player) => ({ ...player, workspaceId, createdBy }))
    });
  }
}

async function seedSession(workspaceId, createdBy) {
  const openSession = await prisma.session.findFirst({
    where: { status: "open", workspaceId }
  });
  if (openSession) return;

  const session = await prisma.session.create({
    data: {
      name: "Demo Session",
      status: "open",
      feeMode: "flat",
      feeAmount: 100,
      returnToQueue: true,
      workspaceId,
      createdBy
    }
  });

  const courts = await prisma.court.findMany({
    where: { workspaceId, deletedAt: null, active: true }
  });
  await prisma.courtSession.createMany({
    data: courts.map((court) => ({
      sessionId: session.id,
      courtId: court.id,
      status: "available"
    }))
  });

  const players = await prisma.player.findMany({
    where: { workspaceId, deletedAt: null }
  });
  await prisma.sessionPlayer.createMany({
    data: players.map((player) => ({
      sessionId: session.id,
      playerId: player.id,
      status: "checked_in"
    }))
  });
}


// ── Scale fixture ────────────────────────────────────────────────────────────
// A second account carrying the sizes the small demo data never reaches: a
// 100-member group, and a session with 80 players already in it. Useful for
// checking the group roster, the "Add from group" picker and the fees list
// behave at a realistic club size rather than at eight players.

const SCALE_FIRST_NAMES = [
  "Alex", "Bea", "Carlo", "Dana", "Elias", "Faye", "Gabe", "Hana", "Ivan", "Jules",
  "Kiko", "Lira", "Marco", "Nina", "Omar", "Pia", "Quinn", "Rafa", "Sari", "Tomas"
];
const SCALE_LAST_NAMES = ["Abad", "Bautista", "Cruz", "Delgado", "Esguerra", "Fajardo", "Gomez"];
const SCALE_SKILLS = ["Beginner", "Intermediate", "Advance", "Elite"];

// Deterministic so a re-seed produces the same roster: 20 x 7 = 140 unique names.
function scalePlayerData(index) {
  const first = SCALE_FIRST_NAMES[index % SCALE_FIRST_NAMES.length];
  const last = SCALE_LAST_NAMES[Math.floor(index / SCALE_FIRST_NAMES.length) % SCALE_LAST_NAMES.length];
  return {
    fullName: `${first} ${last}`,
    // Only some players have a nickname, so both display paths get exercised.
    nickname: index % 3 === 0 ? first : null,
    skillLevel: SCALE_SKILLS[index % SCALE_SKILLS.length]
  };
}

const SCALE_PLAYER_COUNT = 140;
const SCALE_GROUPS = [
  { name: "Tuesday Regulars", description: "The big midweek crowd.", start: 0, size: 100 },
  { name: "Weekend Social", description: "Saturday morning casuals.", start: 100, size: 24 },
  { name: "Coaching Squad", description: "Drills and ladder matches.", start: 124, size: 12 }
];
const SCALE_SESSION_PLAYERS = 80;

async function seedScaleUser() {
  const email = process.env.SCALE_EMAIL || "scale@kue.local";
  const password = process.env.SCALE_PASSWORD || "password123";

  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    user = await prisma.user.create({
      data: { email, passwordHash: await bcrypt.hash(password, 10), fullName: "Scale Tester" }
    });
    const adminRole = await prisma.role.findUnique({ where: { name: "admin" } });
    await prisma.userRole.create({ data: { userId: user.id, roleId: adminRole.id } });
  }

  const workspace = await seedWorkspace(user);
  const workspaceId = workspace.id;
  const createdBy = user.id;

  // Courts
  if ((await prisma.court.count({ where: { workspaceId } })) === 0) {
    await prisma.court.createMany({
      data: [1, 2, 3, 4].map((n) => ({ name: `Court ${n}`, workspaceId, createdBy }))
    });
  }

  // Players
  if ((await prisma.player.count({ where: { workspaceId } })) === 0) {
    await prisma.player.createMany({
      data: Array.from({ length: SCALE_PLAYER_COUNT }, (_, i) => ({
        ...scalePlayerData(i),
        workspaceId,
        createdBy
      }))
    });
  }
  // Ordered by name so the slices below are stable across runs.
  const players = await prisma.player.findMany({
    where: { workspaceId, deletedAt: null },
    orderBy: [{ fullName: "asc" }, { id: "asc" }],
    select: { id: true }
  });

  // Groups
  for (const spec of SCALE_GROUPS) {
    const existing = await prisma.group.findFirst({
      where: { workspaceId, name: spec.name, deletedAt: null }
    });
    if (existing) continue;

    const group = await prisma.group.create({
      data: { name: spec.name, description: spec.description, workspaceId, createdBy }
    });
    const members = players.slice(spec.start, spec.start + spec.size);
    await prisma.groupMember.createMany({
      data: members.map((player, i) => ({
        groupId: group.id,
        playerId: player.id,
        // One owner and two managers, so the roster shows every role badge.
        role: i === 0 ? "owner" : i < 3 ? "manager" : "member"
      }))
    });
  }

  // Session with players already in it
  const sessionName = "Friday Night Open";
  const existingSession = await prisma.session.findFirst({ where: { workspaceId, name: sessionName } });
  if (!existingSession) {
    const session = await prisma.session.create({
      data: {
        name: sessionName,
        status: "open",
        feeMode: "flat",
        feeAmount: 150,
        gameType: "doubles",
        returnToQueue: true,
        workspaceId,
        createdBy
      }
    });

    const courts = await prisma.court.findMany({
      where: { workspaceId, deletedAt: null, active: true }
    });
    await prisma.courtSession.createMany({
      data: courts.map((court) => ({ sessionId: session.id, courtId: court.id, status: "available" }))
    });

    // Stagger check-in over the two hours before now. Nobody has played yet, so
    // they all tie on idle time and check-in order is what decides who Auto Q
    // picks first — identical timestamps would hide that.
    const firstCheckIn = Date.now() - 2 * 60 * 60 * 1000;
    await prisma.sessionPlayer.createMany({
      data: players.slice(0, SCALE_SESSION_PLAYERS).map((player, i) => ({
        sessionId: session.id,
        playerId: player.id,
        status: "checked_in",
        checkedInAt: new Date(firstCheckIn + i * 90 * 1000)
      }))
    });
  }

  console.log(
    `Scale fixture: ${email} / ${password} — ${SCALE_PLAYER_COUNT} players, ` +
      `${SCALE_GROUPS.length} groups (largest ${SCALE_GROUPS[0].size}), ` +
      `"${sessionName}" with ${SCALE_SESSION_PLAYERS} players`
  );
}

async function main() {
  await seedRoles();
  const admin = await seedAdmin();
  const workspace = await seedWorkspace(admin);
  await seedCourtsPlayers(workspace.id, admin.id);
  await seedSession(workspace.id, admin.id);
  await seedScaleUser();
}

main()
  .then(async () => {
    await prisma.$disconnect();
    console.log("Seed complete");
  })
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
