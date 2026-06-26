import { verifyToken } from "../utils/jwt.js";
import prisma from "../lib/prisma.js";

export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: "Missing auth token" });
  }
  try {
    const payload = verifyToken(token);

    // Invalidate any token issued before the user's last password change so
    // changing a password signs out all other existing sessions. A 1s grace
    // covers JWT `iat` second-granularity vs. the millisecond timestamp.
    const user = await prisma.user.findUnique({
      where: { id: payload.id },
      select: { passwordChangedAt: true }
    });
    if (!user) {
      return res.status(401).json({ error: "Invalid token" });
    }
    if (
      user.passwordChangedAt &&
      payload.iat &&
      payload.iat * 1000 < user.passwordChangedAt.getTime()
    ) {
      return res.status(401).json({ error: "Session expired, please sign in again" });
    }

    req.user = payload;
    return next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid token" });
  }
}

export function requireRole(roles = []) {
  return (req, res, next) => {
    const userRoles = req.user?.roles || [];
    const ok = roles.some((role) => userRoles.includes(role));
    if (!ok) {
      return res.status(403).json({ error: "Forbidden" });
    }
    return next();
  };
}
