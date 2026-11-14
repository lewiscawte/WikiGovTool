import { Request, Response, Router } from 'express';
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
  // Send client_id/client_secret in the token request body, as Wikimedia's OAuth 2 docs do,
  // rather than simple-oauth2's default HTTP Basic header.
  options: {
    authorizationMethod: 'body',
  },
});

export const authRouter = Router();

// Where to send the user after login: the page they came from, if it's a path on this site.
// Anything else (another site, "//evil.example", "/\\evil.example") goes to the home page, so
// the login can't be used to redirect someone elsewhere.
export function safeReturnTo(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length > 2000) return '/';
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\') || /[\u0000-\u001f\\]/.test(raw)) return '/';
  try {
    const url = new URL(raw, 'http://localhost');
    if (url.origin !== 'http://localhost') return '/';
    // Checked again after parsing: dot segments can turn "/.//evil.example" into "//evil.example",
    // which a browser reads as another site.
    const out = `${url.pathname}${url.search}${url.hash}`;
    if (!out.startsWith('/') || out.startsWith('//') || out.includes('\\')) return '/';
    return out;
  } catch {
    return '/';
  }
}

// Stores the user's profile in the session, using the access token already in req.session.oauth.
async function loadProfile(req: Request): Promise<void> {
  const oauth = req.session.oauth!;
  const profileResp = await fetch(config.oauth.profileUrl, {
    headers: {
      Authorization: `${oauth.tokenType} ${oauth.accessToken}`,
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
}

type OAuthSession = NonNullable<Request['session']['oauth']>;

// Logs the user in on a brand-new session (fresh id), so a session id known before login,
// e.g. one planted on the victim, never becomes an authenticated session.
function startLoggedInSession(req: Request, oauth: OAuthSession): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) {
        reject(err);
        return;
      }
      req.session.oauth = oauth;
      loadProfile(req).then(resolve, reject);
    });
  });
}

// Owner-only consumer login (OAUTH_OWNER_ONLY=true): no redirect, the session just takes the
// consumer's own access token. For local testing — see config.oauth.ownerOnly.
async function ownerOnlyLogin(req: Request, res: Response, returnTo: string): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    res.status(403).json({ error: 'Owner-only login is disabled in production' });
    return;
  }
  if (!config.oauth.ownerAccessToken) {
    res.status(500).json({
      error: 'OAuth not configured',
      detail: 'OAUTH_OWNER_ONLY is on: set OAUTH_OWNER_ACCESS_TOKEN to the owner-only consumer\'s access token',
    });
    return;
  }
  await startLoggedInSession(req, {
    accessToken: config.oauth.ownerAccessToken,
    tokenType: 'Bearer',
  });
  res.redirect(returnTo);
}

// GET /api/auth/login?returnTo=/departments.html?country=Q924 — returnTo is where to come back to.
authRouter.get('/login', (req, res, next) => {
  const returnTo = safeReturnTo(req.query.returnTo);
  if (config.oauth.ownerOnly) {
    ownerOnlyLogin(req, res, returnTo).catch(next);
    return;
  }

  if (!config.oauth.clientId || !config.oauth.clientSecret) {
    res.status(500).json({
      error: 'OAuth not configured',
      detail: 'Set OAUTH_CLIENT_ID and OAUTH_CLIENT_SECRET in environment variables',
    });
    return;
  }

  const state = crypto.randomBytes(16).toString('hex');
  req.session.oauthState = state;
  req.session.oauthReturnTo = returnTo;

  // Omit scope entirely when unset (= the consumer's registered grants): simple-oauth2
  // would otherwise send the literal string "undefined".
  const authorizationUri = client.authorizeURL({
    redirect_uri: config.oauth.callbackUrl,
    state,
    ...(config.oauth.scope ? { scope: config.oauth.scope } : {}),
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
    // Read before the session is replaced by the logged-in one.
    const returnTo = safeReturnTo(req.session.oauthReturnTo);
    delete req.session.oauthReturnTo;

    const tokenParams = {
      code,
      redirect_uri: config.oauth.callbackUrl,
    };

    const accessToken = await client.getToken(tokenParams);
    const token = accessToken.token as any;

    await startLoggedInSession(req, {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: token.expires_at,
      tokenType: token.token_type || 'Bearer',
    });

    res.redirect(returnTo);
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