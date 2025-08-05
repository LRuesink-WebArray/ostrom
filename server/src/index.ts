import express, { NextFunction, Request, Response } from 'express';
import { OstromClient } from './lib/client/client.js';
import RateLimiter from './lib/client/ratelimiter.js';
import { OstromAuthenticator } from './lib/client/authenticator.js';
import { body, matchedData, param, query, validationResult } from 'express-validator';
import logger from "./logger.js";
import { DateTime } from 'luxon';
import { readFileSync } from 'fs';

logger.level = 'debug';
logger.info('Starting server...');

const app = express();
app.use(express.json());

const rateLimiter = new RateLimiter();
const authenticator = new OstromAuthenticator(
  process.env.AUTH_URL as string,
  process.env.CLIENT_ID as string,
  process.env.CLIENT_SECRET as string,
  rateLimiter
);

const client = new OstromClient(
  process.env.API_URL as string,
  authenticator,
  rateLimiter
);

const pricesValidator = [
  query('startDate')
    .exists({ checkNull: true, checkFalsy: true })
    .withMessage('startDate is required')
    .isISO8601({ strict: true })
    .withMessage('startDate must be a valid ISO8601 datetime'),

  query('endDate')
    .exists({ checkNull: true, checkFalsy: true })
    .withMessage('endDate is required')
    .isISO8601({ strict: true })
    .withMessage('endDate must be a valid ISO8601 datetime'),

  query('zip')
    .exists({ checkNull: true, checkFalsy: true })
    .withMessage('zip is required')
    .isPostalCode('any')
    .withMessage('zip must be a valid postal code'),
];

app.get('/prices', pricesValidator, async (req: Request, res: Response) => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    res.status(400).json({ errors: errors.array() });
  } else {
    const data = matchedData(req);
    const prices = await client.retrieveSpotPrices(
      DateTime.fromISO(data.startDate),
      DateTime.fromISO(data.endDate),
      data.zip
    );

    res.json(prices);
  }
});

const accountLinkValidator = [
  body('externalUserId')
    .exists({ checkNull: true, checkFalsy: true })
    .withMessage('externalUserId is required')
    .isString()
    .withMessage('externalUserId must be a string'),

  body('redirectUrl')
    .exists({ checkNull: true, checkFalsy: true })
    .withMessage('redirectUrl is required')
    .isString()
    .withMessage('redirectUrl must be a string'),
];

app.post('/account/link', accountLinkValidator, async (req: Request, res: Response) => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    res.status(400).json({ errors: errors.array() });
  } else {
    const data = matchedData(req);
    const link = await client.createAccountLink(
      data.externalUserId,
      data.redirectUrl,
      ["contract:read:data", "order:read:data"]
    );

    res.json({ link });
  }
});

const contractValidator = [
  param('externalUserId')
    .exists().withMessage('externalUserId is required')
    .bail()
    .isString().withMessage('externalUserId must be a string')
    .bail()
    .notEmpty().withMessage('externalUserId cannot be empty')
];

app.get('/users/:externalUserId/contracts', contractValidator, async (req: Request, res: Response) => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    res.status(400).json({ errors: errors.array() });
  } else {
    const data = matchedData(req);
    const contracts = await client.retrieveContracts(data.externalUserId);

    res.json(contracts);
  }
});

const energyConsumptionValidator = [
  param('externalUserId')
    .exists({ checkNull: true, checkFalsy: true })
    .withMessage('externalUserId is required')
    .isString()
    .withMessage('externalUserId must be a string'),

  param('contractId')
    .exists({ checkNull: true, checkFalsy: true })
    .withMessage('contractId is required')
    .isInt()
    .withMessage('contractId must be an integer'),

  body('startDate')
    .exists({ checkNull: true, checkFalsy: true })
    .withMessage('startDate is required')
    .isISO8601({ strict: true })
    .withMessage('startDate must be a valid ISO8601 datetime'),

  body('endDate')
    .exists({ checkNull: true, checkFalsy: true })
    .withMessage('endDate is required')
    .isISO8601({ strict: true })
    .withMessage('endDate must be a valid ISO8601 datetime'),

  body('resolution')
    .exists({ checkNull: true, checkFalsy: true })
    .withMessage('resolution is required')
    .isIn(['HOUR', 'DAY', 'MONTH'])
    .withMessage('resolution must be one of HOUR, DAY, MONTH'),
];

app.post('/users/:externalUserId/contracts/:contractId/energy-consumption', energyConsumptionValidator, async (req: Request, res: Response) => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    res.status(400).json({ errors: errors.array() });
  } else {
    const data = matchedData(req);
    const pricing = await client.retrieveSmartMeterConsumption(
      data.externalUserId,
      data.contractId,
      DateTime.fromISO(data.startDate),
      DateTime.fromISO(data.endDate),
      data.resolution
    );

    res.json(pricing);
  }
});

app.get('/ping', async (req: Request, res: Response) => {
  res.send("pong");
})

app.get('/redirect.html', async (req: Request, res: Response) => {
  const source = readFileSync('public/redirect.html', { encoding: 'utf8' });

  res.set('Content-Type', 'text/html');
  res.send(Buffer.from(source));
});

// app.use(express.static(import.meta.dirname + '/public'));

// Note: error handler has to be defined last.
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  logger.error(err);
  res.status(err.status || 500).json({
    error: {
      message: err.message.trim() || 'Internal server error'
    }
  })
})

// Optional: For local development/testing
const port = process.env.PORT || 3000;
logger.info(`Configuration:
\tAPI url:\t${process.env.API_URL}
\tAUTH url:\t${process.env.AUTH_URL}`);

app.listen(port, () => {
  logger.info(`Server running on port ${port}`);
});
