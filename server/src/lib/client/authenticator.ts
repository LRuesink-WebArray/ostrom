import { Buffer } from 'buffer';
import RateLimiter from './ratelimiter';
import createClient from 'openapi-fetch';
import type { paths } from './schema';
import logger from '../../logger';

export type Token = {
    access_token: string;
    expires_in: number;
    token_type: string;
}

export class OstromAuthenticator {
    private readonly authClient: ReturnType<typeof createClient<paths>>;
    private token: Token|null = null;
    private tokenExpiresAt: number|null = null;
    
    constructor(authUrl: string, private clientId: string, private clientSecret: string, private rateLimiter: RateLimiter) {
        this.authClient = createClient<paths>({ baseUrl: authUrl });
    }

    async authenticateIfNeeded() {
        if (!this.token || this.getNowAsTimestamp() > this.tokenExpiresAt!!) {
            logger.info('(Re-)authentication required, retrieving token...');
            await this.authenticate();
        }        
    }

    authenticate(): ReturnType<typeof this._authenticate> {
        return this.rateLimiter.wrap(this._authenticate.bind(this))(this.clientId, this.clientSecret);
    }

    getToken(): Token|null {
        return this.token;
    }

    getAuthenticationHeaderValue(): string {        
        return "Bearer " + this.getToken()?.access_token;
    }

    private getNowAsTimestamp(): number {
        return Math.floor(Date.now() / 1000);
    }

    private async _authenticate(clientId: string, clientSecret: string): Promise<void> {
        logger.info('Authenticating against Ostrom API');

        const basicAuthHeaderValue = Buffer.from(`${clientId}:${clientSecret}`, 'binary').toString('base64');

        const { data, error } = await this.authClient.POST('/oauth2/token', {
            body: {
                grant_type: 'client_credentials'
            },
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': 'Basic ' + basicAuthHeaderValue
            }
        });

        if (error) {
            throw new Error('Failed to authenticate: ' + JSON.stringify(error));
        }

        logger.info('Authentication successful');
        
        const token = data as Token;
        
        this.tokenExpiresAt = this.getNowAsTimestamp() + token.expires_in;
        this.token = token;
    }
}
