import { Router } from 'express';
import crypto from 'crypto';
import { AuthorizationCode } from 'simple-oauth2';
import { config, userAgent } from '../config';

const client = new AuthorizationCode({
  client: {
    id: config.oauth.clientId,
    secret: config.oauth.clientSecret,
  },
  auth: {
    tokenHost: config.oauth.authBase,
    tokenPath: '/w/rest.php/oauth2/access_token',
    authorizePath: '/w/rest.php/oauth2/authorize',
  },
});

export const authRouter = Router();

authRouter.get('/login', (req, res) => {
  if (!config.oauth.clientId || !config.oauth.clientSecret) {
    res.status(500).json({
      error: 'OAuth not configured',
      detail: 'Set OAUTH_CLIENT_ID and OAUTH_CLIENT_SECRET in environment variables',
    });
    return;
  }

  const state = crypto.randomBytes(16).toString('hex');
  req.session.oauthState = state;

  const authorizationUri = client.authorizeURL({
    redirect_uri: config.oauth.callbackUrl,
    scope: config.oauth.scope || undefined,
    state,
  });

  res.redirect(authorizationUri);
});

authRouter.get('/callback', async (req, res, next) => {
  try {
    const { code, state } = req.query as { code?: string; state?: string };

    if (!code || !state) {
      res.status(400).json({ error: 'Missing code or state' });
      return;
    }

    if (!req.session.oauthState || state !== req.session.oauthState) {
      res.status(400).json({ error: 'Invalid OAuth state' });
      return;
    }

    delete req.session.oauthState;

    const tokenParams = {
      code,
      redirect_uri: config.oauth.callbackUrl,
    };

    const accessToken = await client.getToken(tokenParams);
    const token = accessToken.token as any;

    req.session.oauth = {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: token.expires_at,
      tokenType: token.token_type || 'Bearer',
    };

    const profileResp = await fetch(config.oauth.profileUrl, {
      headers: {
        Authorization: `${req.session.oauth.tokenType} ${req.session.oauth.accessToken}`,
        'User-Agent': userAgent(),
      },
    });

    if (!profileResp.ok) {
      throw new Error(`Profile fetch failed: ${profileResp.status}`);
    }

    const profile = (await profileResp.json()) as any;

    req.session.user = {
      username: profile.username || profile.sub || 'Unknown',
      loggedInAt: new Date().toISOString(),
      centralId: profile.sub,
      email: profile.email,
      rights: profile.rights,
      groups: profile.groups,
    };

    res.redirect('/');
  } catch (err) {
    next(err);
  }
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