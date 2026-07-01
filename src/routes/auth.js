import express from "express";
import { z } from "zod";
import crypto from "crypto";
import prisma from "../lib/prisma.js";
import { hashPassword, verifyPassword } from "../utils/password.js";
import { signToken, verifyToken } from "../utils/jwt.js";
import { requireAuth } from "../middleware/auth.js";
import { authLimiter } from "../middleware/rateLimit.js";
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
  fullName: z.string().min(1).optional(),
  redirect: z.string().optional()
});

// Only allow same-origin relative paths as post-verification redirects, so an
// attacker can't turn the verification email into an open redirect.
function safeInternalPath(value) {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") ? value : "";
}

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

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6)
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

router.post("/register", authLimiter, async (req, res) => {
  const parse = registerSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: "Invalid input", details: parse.error.flatten() });
  }

  const { email, password, fullName } = parse.data;
  const next = safeInternalPath(parse.data.redirect);
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

  // Every user owns a default workspace. Create one (and make it active) if the
  // user doesn't have any yet — covers new sign-ups and unverified re-registers.
  const ownedCount = await prisma.workspace.count({ where: { ownerId: user.id } });
  if (ownedCount === 0) {
    const base = (user.fullName || "").trim() || user.email.split("@")[0];
    const workspace = await prisma.workspace.create({
      data: { name: `${base}'s workspace`, ownerId: user.id }
    });
    await prisma.user.update({
      where: { id: user.id },
      data: { activeWorkspaceId: workspace.id }
    });
  }

  await sendVerificationEmail({ to: user.email, token, next });

  return res.json({
    status: "verification_sent",
    email: user.email
  });
});

router.post("/login", authLimiter, async (req, res) => {
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

  // Auto-login on verify: clicking the emailed link proves email ownership, so
  // hand back a session token and let the client continue to its destination.
  const roles = await getUserRoles(user.id);
  const token2 = signToken({ id: user.id, email: user.email, roles });

  return res.json({
    verified: true,
    token: token2,
    user: { id: user.id, email: user.email, fullName: user.fullName, roles }
  });
});

router.post("/password/forgot", authLimiter, async (req, res) => {
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

router.post("/password/reset", authLimiter, async (req, res) => {
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
      passwordChangedAt: new Date(),
      passwordResetTokenHash: null,
      passwordResetTokenExpiresAt: null
    }
  });

  return res.json({ status: "ok" });
});

router.get("/me", requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }
  const roles = await getUserRoles(user.id);
  return res.json({
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    roles,
    emailVerifiedAt: user.emailVerifiedAt,
    createdAt: user.createdAt
  });
});

router.post("/password/change", authLimiter, requireAuth, async (req, res) => {
  const parse = changePasswordSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: "Invalid input", details: parse.error.flatten() });
  }
  const { currentPassword, newPassword } = parse.data;

  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  const ok = await verifyPassword(currentPassword, user.passwordHash);
  if (!ok) {
    return res.status(401).json({ error: "Current password is incorrect" });
  }
  if (currentPassword === newPassword) {
    return res.status(400).json({ error: "New password must be different from the current password" });
  }

  const passwordHash = await hashPassword(newPassword);

  // Issue a fresh token, then anchor passwordChangedAt to that token's `iat`
  // second. requireAuth rejects tokens whose `iat` predates this, so every
  // other session is signed out while this freshly-issued one stays valid.
  // (JWT `iat` has second granularity, so we align to the same second.)
  const roles = await getUserRoles(user.id);
  const token = signToken({ id: user.id, email: user.email, roles });
  const { iat } = verifyToken(token);

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash, passwordChangedAt: new Date(iat * 1000) }
  });

  return res.json({ status: "ok", token });
});

export default router;
