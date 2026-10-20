import { RequestHandler } from 'express';

export const requireAuth: RequestHandler = (req, res, next) => {
  if (!req.session.user) {
    res.status(401).json({ error: 'Login required (stub auth: POST /api/auth/login)' });
    return;
  }
  next();
};