import { verifyToken } from "../utils/jwt.js";

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: "Missing auth token" });
  }
  try {
    const payload = verifyToken(token);
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
