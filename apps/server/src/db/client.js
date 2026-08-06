import { neon } from "@neondatabase/serverless";
import { config } from "../config.js";

export const sql = neon(config.databaseUrl);

