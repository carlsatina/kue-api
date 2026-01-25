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
  const count = await prisma.user.count();
  if (count > 0) return;

  const email = process.env.ADMIN_EMAIL || "admin@kue.local";
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
}

async function seedCourtsPlayers() {
  const courtCount = await prisma.court.count();
  if (courtCount === 0) {
    await prisma.court.createMany({
      data: [
        { name: "Court 1", notes: "Main court" },
        { name: "Court 2", notes: "Side court" },
        { name: "Court 3", notes: "Warm-up" }
      ]
    });
  }

  const playerCount = await prisma.player.count();
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
      ]
    });
  }
}

async function seedSession() {
  const openSession = await prisma.session.findFirst({ where: { status: "open" } });
  if (openSession) return;

  const admin = await prisma.user.findFirst();
  const session = await prisma.session.create({
    data: {
      name: "Demo Session",
      status: "open",
      feeMode: "flat",
      feeAmount: 100,
      returnToQueue: true,
      createdBy: admin?.id || null
    }
  });

  const courts = await prisma.court.findMany({ where: { deletedAt: null, active: true } });
  await prisma.courtSession.createMany({
    data: courts.map((court) => ({
      sessionId: session.id,
      courtId: court.id,
      status: "available"
    }))
  });

  const players = await prisma.player.findMany();
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
  await seedAdmin();
  await seedCourtsPlayers();
  await seedSession();
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
