import { Request, Response, NextFunction } from "express";
import { ZodType, ZodTypeDef, ZodError } from "zod";

function formatZodError(error: ZodError) {
  return error.errors.map((e) => ({
    field: e.path.join("."),
    message: e.message,
  }));
}

/**
 * Returns middleware that validates `req.query` against the given Zod schema.
 * On failure, responds with 400 and a structured error body before the handler runs.
 * Accepts schemas with transformations or defaults (ZodType with any input type).
 */
export function validateQuery<T>(schema: ZodType<T, ZodTypeDef, unknown>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      res.status(400).json({
        error: "Invalid query parameters",
        details: formatZodError(result.error),
      });
      return;
    }
    // Replace query with coerced/parsed values
    req.query = result.data as Record<string, string>;
    next();
  };
}

/**
 * Returns middleware that validates `req.body` against the given Zod schema.
 * On failure, responds with 400 and a structured error body before the handler runs.
 * Accepts schemas with transformations or defaults (ZodType with any input type).
 */
export function validateBody<T>(schema: ZodType<T, ZodTypeDef, unknown>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({
        error: "Invalid request body",
        details: formatZodError(result.error),
      });
      return;
    }
    req.body = result.data;
    next();
  };
}
