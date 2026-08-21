import type { NextFunction, Request, RequestHandler, Response } from "express";

type AsyncRouteHandler = (
  request: Request,
  response: Response,
  next: NextFunction,
) => Promise<unknown>;

/**
 * Wrap an async Express route handler so a rejected Promise is forwarded to
 * `next`, letting the boundary error middleware produce the response.
 */
export function asyncHandler(handler: AsyncRouteHandler): RequestHandler {
  return (request, response, next) => {
    void handler(request, response, next).catch((error) => {
      next(error);
    });
  };
}
