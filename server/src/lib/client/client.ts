import createClient from 'openapi-fetch';
import type { paths, components } from './schema.js';
import RateLimiter from './ratelimiter.js';
import { OstromAuthenticator } from './authenticator.js';
import { DateTime } from 'luxon';
import logger from '../../logger.js';

export type Scope = "order:read:data" | "contract:read:data";
export const enum Resolution {
    HOUR = 'HOUR',
    DAY = 'DAY',
    MONTH = 'MONTH'
}

export type Price = components["schemas"]["GetSpotPriceItemResponse"];
export type Contract = components["schemas"]["GetContractsItemResponse"];
export type Consumption = components["schemas"]["GetContractsEnergyConsumptionItemResponse"];

export class OstromClient {
    private static readonly DEFAULT_LANGUAGE = 'en-US';

    private readonly apiClient: ReturnType<typeof createClient<paths>>;

    constructor(apiUrl: string, private authenticator: OstromAuthenticator, private rateLimiter: RateLimiter) {
        this.apiClient = createClient<paths>({ baseUrl: apiUrl });
    }

    createAccountLink(externalUserId: string, redirectUrl: string, scopes: Scope[]): ReturnType<typeof this._createAccountLink> {
        return this.rateLimiter.wrap(this._createAccountLink.bind(this))(externalUserId, redirectUrl, scopes);
    }

    retrieveSmartMeterConsumption(externalUserId: string, contractId: number, startDate: DateTime, endDate: DateTime, resolution: Resolution): ReturnType<typeof this._retrieveSmartMeterConsumption> {
        return this.rateLimiter.wrap(this._retrieveSmartMeterConsumption.bind(this))(externalUserId, contractId, startDate, endDate, resolution);
    }

    retrieveContracts(externalUserId: string): ReturnType<typeof this._retrieveContracts> {
        return this.rateLimiter.wrap(this._retrieveContracts.bind(this))(externalUserId);
    }

    retrieveSpotPrices(startDate: DateTime, endDate: DateTime, zipCode: string|null = null): ReturnType<typeof this._retrieveSpotPrices> {
        return this.rateLimiter.wrap(this._retrieveSpotPrices.bind(this))(startDate, endDate, zipCode);
    }

    private async _retrieveSmartMeterConsumption(externalUserId: string, contractId: number, startDate: DateTime, endDate: DateTime, resolution: Resolution): Promise<Consumption[]> {
        logger.debug('Fetching smart meter consumption for user with id %s and contract id %s (resolution: %s)', externalUserId, contractId, resolution);

        const { data, error } = await this.withAuthCheck(() => this.apiClient.GET('/users/{externalUserId}/contracts/{contractId}/energy-consumption', {            
            params: {
                path: { externalUserId, contractId },
                query: { 
                    startDate: startDate.toUTC().toISO()!, 
                    endDate: endDate.toUTC().toISO()!,
                    resolution: resolution 
                }
            },
            headers: {
                ...this.getAuthenticationHeader()
            }
        }));

        if (error) {
            throw new Error('Failed to retrieve contract information: ' + JSON.stringify(error));
        }

        return data.data as Consumption[];
    }

    private async _retrieveContracts(externalUserId: string): Promise<Contract[]> {
        logger.debug('Fetching contract information for user with id %s', externalUserId);

        const { data, error } = await this.withAuthCheck(() => this.apiClient.GET(`/users/{externalUserId}/contracts`, {
            params: {
                path: { externalUserId }
            },
            headers: {
                ...this.getAuthenticationHeader()
            }
        }));

        if (error) {
            throw new Error('Failed to retrieve contract information: ' + JSON.stringify(error));
        }

        return data.data as Contract[];
    }

    private async _retrieveSpotPrices(startDate: DateTime, endDate: DateTime, zipCode: string|null): Promise<Price[]> {
        logger.debug('Retrieving spot prices between %s and %s (zip: %s)', startDate, endDate, zipCode);

        const { data, error } = await this.withAuthCheck(() => {
            return this.apiClient.GET("/spot-prices", {
                params: {
                    query: {
                        startDate: startDate.toUTC().toISO()!,
                        endDate: endDate.toUTC().toISO()!,
                        resolution: 'HOUR',
                        zip: zipCode ? zipCode : undefined
                    }
                },
                headers: {
                    ...this.getAuthenticationHeader()
                }
            });
        });

        if (error) {
            throw new Error('Failed to fetch spot prices: ' + JSON.stringify(error));
        }

        return data.data as Price[];
    }

    private async _createAccountLink(externalUserId: string, redirectUrl: string, scopes: Scope[]): Promise<string> {
        logger.debug('Creating account link for user with id %s, scopes: %s', externalUserId, scopes);

        const { data, error } = await this.withAuthCheck(() => this.apiClient.POST('/users/link', {
            body: {
                externalUserId: externalUserId,
                language: OstromClient.DEFAULT_LANGUAGE,
                redirectUrl: redirectUrl,
                scopes: scopes
            },
            headers: {
                ...this.getAuthenticationHeader()                
            }
        }));

        if (error) {
            throw new Error('Failed to create account link: ' + JSON.stringify(error));
        }

        return data.linkUrl!!;
    }

    private async withAuthCheck<T>(callback: () => Promise<T>) {
        await this.authenticator.authenticateIfNeeded()
        return await callback();
    }

    private getAuthenticationHeader() {
        return { "authorization": this.authenticator.getAuthenticationHeaderValue() };
    }
}
