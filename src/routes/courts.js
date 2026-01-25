import express from "express";
import { z } from "zod";
import prisma from "../lib/prisma.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { findCourtForUser, findSessionForUser } from "../utils/access.js";

const router = express.Router();

const createSchema = z.object({
  name: z.string().min(1),
  notes: z.string().optional(),
  active: z.boolean().optional()
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  notes: z.string().optional(),
  active: z.boolean().optional()
});

const statusSchema = z.object({
  sessionId: z.string().uuid(),
  status: z.enum(["available", "in_match", "maintenance"])
});

router.get("/", requireAuth, requireRole(["admin", "staff"]), async (req, res) => {
  const courts = await prisma.court.findMany({
    where: { deletedAt: null, createdBy: req.user.id }
  });
  res.json(courts);
});

router.post("/", requireAuth, requireRole(["admin"]), async (req, res) => {
  const parse = createSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: "Invalid input", details: parse.error.flatten() });
  }
  const court = await prisma.court.create({
    data: { ...parse.data, createdBy: req.user.id }
  });

  const activeSession = await prisma.session.findFirst({
    where: { status: "open", createdBy: req.user.id }
  });
  if (activeSession) {
    await prisma.courtSession.create({
      data: {
        sessionId: activeSession.id,
        courtId: court.id,
        status: "available"
      }
    });
  }

  res.json(court);
});

router.patch("/:id", requireAuth, requireRole(["admin"]), async (req, res) => {
  const parse = updateSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: "Invalid input", details: parse.error.flatten() });
  }
  const court = await findCourtForUser(req.params.id, req.user.id);
  if (!court) {
    return res.status(404).json({ error: "Court not found" });
  }
  const updated = await prisma.court.update({
    where: { id: court.id },
    data: parse.data
  });
  res.json(updated);
});

router.delete("/:id", requireAuth, requireRole(["admin"]), async (req, res) => {
  const { id } = req.params;
  const court = await findCourtForUser(id, req.user.id);
  if (!court || court.deletedAt) {
    return res.status(404).json({ error: "Court not found" });
  }

  const activeMatch = await prisma.courtSession.findFirst({
    where: { courtId: id, currentMatchId: { not: null } }
  });
  if (activeMatch) {
    return res.status(409).json({ error: "Court has an active match" });
  }

  await prisma.courtSession.deleteMany({
    where: { courtId: id }
  });

  const updated = await prisma.court.update({
    where: { id },
    data: { deletedAt: new Date(), active: false }
  });
  res.json(updated);
});

router.post("/:id/status", requireAuth, requireRole(["admin", "staff"]), async (req, res) => {
  const parse = statusSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: "Invalid input", details: parse.error.flatten() });
  }

  const { sessionId, status } = parse.data;
  const session = await findSessionForUser(sessionId, req.user.id);
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }
  const court = await findCourtForUser(req.params.id, req.user.id);
  if (!court) {
    return res.status(404).json({ error: "Court not found" });
  }
  const courtSession = await prisma.courtSession.update({
    where: { sessionId_courtId: { sessionId, courtId: court.id } },
    data: { status }
  });
  res.json(courtSession);
});

export default router;
