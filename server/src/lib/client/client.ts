import { Buffer } from 'buffer';
import createClient from 'openapi-fetch';
import type { paths } from './schema';

export type Token = {
    access_token: string;
    expires_in: number;
    token_type: string;
}

export default class OstromClient {
    private readonly authClient: ReturnType<typeof createClient<paths>>;

    constructor(authUrl: string) {
          this.authClient = createClient<paths>({ baseUrl: authUrl });
    }

    async authenticate(clientId: string, clientSecret: string): Promise<Token> {
        const token = Buffer.from(`${clientId}:${clientSecret}`, 'binary').toString('base64');

        const { data, error } = await this.authClient.POST('/oauth2/token', {
            body: {
                grant_type: 'client_credentials'
            },
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': 'Basic ' + token
            }
        });

        if (error) {
            throw new Error('Failed to authenticate: ' + JSON.stringify(error));
        }

        return data as Token;
    }
}