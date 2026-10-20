import { Router } from 'express';
import { listCountries } from '../services/countries';

export const countriesRouter = Router();

countriesRouter.get('/', async (_req, res, next) => {
  try {
    const countries = await listCountries();
    res.json({ countries });
  } catch (err) {
    next(err);
  }
});
