import express, { NextFunction, Request, Response } from 'express';
import path from 'path';
import session from 'express-session';
import { config } from './config';
import { positionsRouter } from './routes/positions';
import { orgchartRouter } from './routes/orgchart';
import { departmentsRouter } from './routes/departments';
import { wikidataRouter } from './routes/wikidata';
import { wikipediaRouter } from './routes/wikipedia';
import { infoboxRouter } from './routes/infobox';
import { authRouter } from './routes/auth';
import { countriesRouter } from './routes/countries';
import { officeholdersRouter } from './routes/officeholders';
import { version } from './version';

export function createApp() {
  const app = express();

  // No CORS middleware: the frontend is served from this same origin, and allowing credentialed
  // cross-origin requests would leave SameSite=Lax as the only guard on Wikidata edits.
  app.use(express.json());
  app.use(
    session({
      secret: config.sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: { httpOnly: true, sameSite: 'lax' },
    }),
  );

  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.get('/api/version', (_req, res) => res.json(version));
  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.use('/api/positions', positionsRouter);
  app.use('/api/orgchart', orgchartRouter);
  app.use('/api/departments', departmentsRouter);
  app.use('/api/wikidata', wikidataRouter);
  app.use('/api/wikipedia', wikipediaRouter);
  app.use('/api/infobox', infoboxRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/countries', countriesRouter);
  app.use('/api/officeholders', officeholdersRouter);

  app.use((req: Request, res: Response) => {
    res.status(404).json({ error: `No route for ${req.method} ${req.path}` });
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
