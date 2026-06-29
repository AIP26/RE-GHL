import { Router } from 'express';

const r = Router();

r.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'mktscaled-listings',
    version: '0.1.0',
    timestamp: new Date().toISOString(),
  });
});

export default r;
