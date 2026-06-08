import type { Request } from "express";
import { getAuth } from "@clerk/express";

// Optional auth: returns the Clerk user id when the request is authenticated,
// otherwise null. All course routes are public, so activity is attributed to a
// user when we have one and falls back to anonymous/global otherwise.
export function getUserId(req: Request): string | null {
  try {
    return getAuth(req).userId ?? null;
  } catch {
    return null;
  }
}
