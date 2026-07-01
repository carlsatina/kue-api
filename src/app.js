import express from "express";
import cors from "cors";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import authRoutes from "./routes/auth.js";
import sessionRoutes from "./routes/sessions.js";
import courtRoutes from "./routes/courts.js";
import playerRoutes from "./routes/players.js";
import teamRoutes from "./routes/teams.js";
import queueRoutes from "./routes/queue.js";
import matchRoutes from "./routes/matches.js";
import paymentRoutes from "./routes/payments.js";
import shareRoutes from "./routes/shareLinks.js";
import assistantRoutes from "./routes/assistants.js";
import workspaceRoutes from "./routes/workspaces.js";
import publicRoutes from "./routes/public.js";

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Trust the first reverse proxy (nginx/Render/etc.) so rate limiting and IP
// detection use the real client IP from X-Forwarded-For, not the proxy's.
app.set("trust proxy", 1);

const defaultOrigins = [
  "https://kue.arshii.net",
  "https://localhost",
  "http://localhost",
  "https://localhost:5173",
  "http://localhost:5173",
  "https://localhost:5174",
  "http://localhost:5174",
  "capacitor://localhost",
  "ionic://localhost"
];
const rawOrigins = process.env.CORS_ORIGINS;
const parsedOrigins = rawOrigins
  ? rawOrigins.split(",").map((origin) => origin.trim()).filter(Boolean)
  : [];
const mergedOrigins = parsedOrigins.includes("*")
  ? ["*"]
  : [...new Set([...defaultOrigins, ...parsedOrigins])];
const corsOrigins = mergedOrigins.includes("*") ? "*" : mergedOrigins;

const corsOptions = {
  origin: corsOrigins,
  methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));
app.use(express.json({ limit: "1mb" }));
app.use("/uploads", express.static(join(__dirname, "../uploads")));

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/auth", authRoutes);
app.use("/api/sessions", sessionRoutes);
app.use("/api/courts", courtRoutes);
app.use("/api/players", playerRoutes);
app.use("/api/teams", teamRoutes);
app.use("/api/queue", queueRoutes);
app.use("/api/matches", matchRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/share-links", shareRoutes);
app.use("/api/assistants", assistantRoutes);
app.use("/api/workspaces", workspaceRoutes);
app.use("/api/public", publicRoutes);

export default app;
