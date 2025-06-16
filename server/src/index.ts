import express, { Request, Response } from 'express';
import OstromClient from './lib/client/client';

const app = express();
app.use(express.json());

app.get('/', (req: Request, res: Response) => {
  res.send('Hello, World!');
});

const client = new OstromClient(process.env.AUTH_URL as string);

const token = await client.authenticate(
  process.env.CLIENT_ID as string,
  process.env.CLIENT_SECRET as string
);

console.log(token);

/*app.listen(3000, () => {
  console.log('Configuration:');
  console.log('    API url: ' + process.env.API_URL);
  console.log('    AUTH url: ' + process.env.AUTH_URL);
  console.log('');
  console.log('Ostrom API server is running on port 3000');
});
*/