import prisma from "../lib/prisma.js";

// A session needs somewhere to play, and open play in particular is pointless
// on a single court — the lineup never rotates. Seeding gives a fresh install
// three courts, but a workspace created later starts with none, so the first
// session in it would open with nothing to call. Top the workspace up instead.
const MINIMUM_COURTS = 2;

export async function ensureMinimumCourts(workspaceId, createdBy = null, minimum = MINIMUM_COURTS) {
  const existing = await prisma.court.findMany({
    where: { workspaceId, deletedAt: null },
    select: { name: true, active: true }
  });

  // Only a court that's actually playable counts towards the minimum.
  const shortfall = minimum - existing.filter((court) => court.active).length;
  if (shortfall <= 0) return [];

  // Number past the "Court N" names already in use, including inactive ones, so
  // a top-up never produces two courts sharing a name.
  const taken = new Set(existing.map((court) => court.name.trim().toLowerCase()));
  const toCreate = [];
  let n = 1;
  while (toCreate.length < shortfall) {
    const name = `Court ${n}`;
    if (!taken.has(name.toLowerCase())) {
      toCreate.push({ name, workspaceId, createdBy });
      taken.add(name.toLowerCase());
    }
    n += 1;
  }

  await prisma.court.createMany({ data: toCreate });
  return toCreate;
}
