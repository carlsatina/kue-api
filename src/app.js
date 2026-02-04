import express from "express";
import cors from "cors";
import authRoutes from "./routes/auth.js";
import sessionRoutes from "./routes/sessions.js";
import courtRoutes from "./routes/courts.js";
import playerRoutes from "./routes/players.js";
import teamRoutes from "./routes/teams.js";
import queueRoutes from "./routes/queue.js";
import matchRoutes from "./routes/matches.js";
import paymentRoutes from "./routes/payments.js";
import shareRoutes from "./routes/shareLinks.js";
import publicRoutes from "./routes/public.js";

const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

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
app.use("/api/public", publicRoutes);

export default app;
