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
    oauthCodeVerifier?: string;
  }
}
