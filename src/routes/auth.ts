import { Router } from 'express';

export const authRouter = Router();

// Stub for Wikimedia OAuth 2.0. Swap this handler for the real meta.wikimedia.org
// authorization-code flow once a client id/secret is registered; everything downstream
// (requireAuth, req.session.user) is already shaped for that swap.
authRouter.post('/login', (req, res) => {
  const username = (req.body?.username && String(req.body.username).trim()) || 'TestEditor';
  req.session.user = { username, loggedInAt: new Date().toISOString() };
  res.json({ user: req.session.user });
});

authRouter.post('/logout', (req, res) => {
  req.session.destroy(() => res.status(204).end());
});

authRouter.get('/me', (req, res) => {
  if (!req.session.user) {
    res.status(401).json({ error: 'Not logged in' });
    return;
  }
  res.json({ user: req.session.user });
});