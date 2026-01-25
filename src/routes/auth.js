import express from "express";
import { z } from "zod";
import crypto from "crypto";
import prisma from "../lib/prisma.js";
import { hashPassword, verifyPassword } from "../utils/password.js";
import { signToken } from "../utils/jwt.js";
import {
  generateResetToken,
  generateVerificationToken,
  sendPasswordResetEmail,
  sendVerificationEmail
} from "../services/email.js";

const router = express.Router();

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  fullName: z.string().min(1).optional()
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6)
});

const verifySchema = z.object({
  token: z.string().min(10)
});

const resetRequestSchema = z.object({
  email: z.string().email()
});

const resetSchema = z.object({
  token: z.string().min(10),
  password: z.string().min(6)
});

async function ensureRoles() {
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

async function getUserRoles(userId) {
  const roles = await prisma.userRole.findMany({
    where: { userId },
    include: { role: true }
  });
  return roles.map((r) => r.role.name);
}

router.post("/register", async (req, res) => {
  const parse = registerSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: "Invalid input", details: parse.error.flatten() });
  }

  const { email, password, fullName } = parse.data;
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing?.emailVerifiedAt) {
    return res.status(409).json({ error: "Email already in use" });
  }

  await ensureRoles();
  const { token, tokenHash, expiresAt } = generateVerificationToken();

  let user = existing;
  if (!existing) {
    const passwordHash = await hashPassword(password);
    user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        fullName,
        emailVerifiedAt: null,
        emailVerifyTokenHash: tokenHash,
        emailVerifyTokenExpiresAt: expiresAt
      }
    });
  } else {
    user = await prisma.user.update({
      where: { id: existing.id },
      data: {
        emailVerifyTokenHash: tokenHash,
        emailVerifyTokenExpiresAt: expiresAt
      }
    });
  }

  if (!existing) {
    const adminRole = await prisma.role.findUnique({ where: { name: "admin" } });
    await prisma.userRole.create({
      data: { userId: user.id, roleId: adminRole.id }
    });
  }

  await sendVerificationEmail({ to: user.email, token });

  return res.json({
    status: "verification_sent",
    email: user.email
  });
});

router.post("/login", async (req, res) => {
  const parse = loginSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: "Invalid input", details: parse.error.flatten() });
  }

  const { email, password } = parse.data;
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    return res.status(401).json({ error: "Invalid credentials" });
  }
  if (!user.emailVerifiedAt && user.emailVerifyTokenHash) {
    return res.status(403).json({ error: "Please verify your email before logging in" });
  }
  if (!user.emailVerifiedAt && !user.emailVerifyTokenHash) {
    await prisma.user.update({
      where: { id: user.id },
      data: { emailVerifiedAt: new Date() }
    });
  }

  const roles = await getUserRoles(user.id);
  const token = signToken({ id: user.id, email: user.email, roles });

  return res.json({
    token,
    user: { id: user.id, email: user.email, fullName: user.fullName, roles }
  });
});

router.get("/verify", async (req, res) => {
  const parse = verifySchema.safeParse(req.query);
  if (!parse.success) {
    return res.status(400).json({ error: "Invalid token" });
  }
  const { token } = parse.data;
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const user = await prisma.user.findFirst({
    where: {
      emailVerifyTokenHash: tokenHash,
      emailVerifyTokenExpiresAt: { gt: new Date() }
    }
  });
  if (!user) {
    return res.status(400).json({ error: "Verification link is invalid or expired" });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      emailVerifiedAt: new Date(),
      emailVerifyTokenHash: null,
      emailVerifyTokenExpiresAt: null
    }
  });

  return res.json({ verified: true });
});

router.post("/password/forgot", async (req, res) => {
  const parse = resetRequestSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: "Invalid input", details: parse.error.flatten() });
  }

  const { email } = parse.data;
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return res.json({ status: "ok" });
  }

  const { token, tokenHash, expiresAt } = generateResetToken();
  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordResetTokenHash: tokenHash,
      passwordResetTokenExpiresAt: expiresAt
    }
  });

  await sendPasswordResetEmail({ to: user.email, token });
  return res.json({ status: "ok" });
});

router.post("/password/reset", async (req, res) => {
  const parse = resetSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: "Invalid input", details: parse.error.flatten() });
  }
  const { token, password } = parse.data;
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const user = await prisma.user.findFirst({
    where: {
      passwordResetTokenHash: tokenHash,
      passwordResetTokenExpiresAt: { gt: new Date() }
    }
  });
  if (!user) {
    return res.status(400).json({ error: "Reset link is invalid or expired" });
  }

  const passwordHash = await hashPassword(password);
  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash,
      passwordResetTokenHash: null,
      passwordResetTokenExpiresAt: null
    }
  });

  return res.json({ status: "ok" });
});

export default router;
