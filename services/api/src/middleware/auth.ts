import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

interface JwtPayload {
  sub?: string;
  role?: string;
  [key: string]: unknown;
}

/**
 * Returns middleware that verifies the Bearer JWT and enforces the required role.
 *
 * - 401 if the Authorization header is missing, malformed, or the token is
 *   invalid/expired.
 * - 403 if the token is valid but does not carry the required role claim.
 */
export function requireRole(role: string, jwtSecret: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const token = authHeader.slice(7);
    let payload: JwtPayload;

    try {
      payload = jwt.verify(token, jwtSecret) as JwtPayload;
    } catch {
      res.status(401).json({ error: "Invalid or expired token" });
      return;
    }

    if (payload.role !== role) {
      res.status(403).json({ error: "Insufficient permissions" });
      return;
    }

    next();
  };
}
