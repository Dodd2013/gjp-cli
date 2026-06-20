import { homedir } from "node:os";
import { join } from "node:path";

/** 本地数据目录 ~/.gjp */
export const GJP_DIR = process.env.GJP_HOME
  ? process.env.GJP_HOME
  : join(homedir(), ".gjp");

export const SESSION_FILE = join(GJP_DIR, "session.json");
export const CREDENTIALS_FILE = join(GJP_DIR, "credentials.json");
export const CONFIG_FILE = join(GJP_DIR, "config.json");
