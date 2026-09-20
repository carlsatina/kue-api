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

async function main() {
  await seedRoles();
  const admin = await seedAdmin();
  const workspace = await seedWorkspace(admin);
  await seedCourtsPlayers(workspace.id, admin.id);
  await seedSession(workspace.id, admin.id);
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
