import { RequestHandler } from 'express';

export const requireAuth: RequestHandler = (req, res, next) => {
  if (!req.session.user || !req.session.oauth?.accessToken) {
    res.status(401).json({ error: 'Login required with Wikimedia OAuth' });
    return;
  }
  next();
};