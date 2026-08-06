import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { sql } from "../db/client.js";

export async function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (!token) return res.status(401).json({ error: "Authentication required" });
  try {
    req.auth = jwt.verify(token, config.jwtSecret);
  } catch {
    return res.status(401).json({ error: "Your session has expired" });
  }
  try {
    const [account] = await sql`SELECT employment_status FROM users WHERE id = ${req.auth.userId}`;
    if (!account || (account.employment_status || "active") !== "active") {
      return res.status(401).json({ error: "This employee account is no longer active" });
    }
    next();
  } catch (error) { next(error); }
}
