import 'express-session';

declare module 'express-session' {
  interface SessionData {
    user?: {
      username: string;
      loggedInAt: string;
      centralId?: string;
      email?: string;
      rights?: string[];
      groups?: string[];
    };
    oauth?: {
      accessToken: string;
      refreshToken?: string;
      expiresAt?: number;
      tokenType?: string;
    };
    oauthState?: string;
    // The page to go back to once login completes (a path on this site).
    oauthReturnTo?: string;
    oauthCodeVerifier?: string;
  }
}
