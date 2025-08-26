import { App } from 'homey';
import { DateTime } from 'luxon';
import fetch from 'cross-fetch';

type Homey = InstanceType<typeof App>["homey"];

interface AccountLinkResponse {
    link: string
}

export interface Contract {
    /** @description The id of the contract */
    id?: number;
    /** @description type of the contract */
    type?: string;
    /** @description Product code of the contract */
    productCode?: string;
    /** @description Status of the contract */
    status?: string;
    /** @description Customer first name */
    customerFirstName?: string;
    /** @description Customer last name */
    customerLastName?: string;
    /** @description Start date of the contract in ISO format */
    startDate?: string;
    /** @description Current monthly deposit amount in EUR of the contract */
    currentMonthlyDepositAmount?: string;
    address?: {
        /** @description The zip code of the address */
        zip?: string;
        /** @description The city of the address */
        city?: string;
        /** @description The street of the address */
        street?: string;
        /** @description The house number of the address */
        houseNumber?: string;
    }
}

export interface Price {
    /**
     * @description The date of the day-ahead spot price data (start from)
     * @example 2023-10-22T01:00:00.000Z
     */
    date?: string;
    /**
     * @description The MWh day-ahead spot price without VAT in EUR
     * @example 926
     */
    netMwhPrice?: number;
    /**
     * @description The kWh day-ahead spot price without VAT in cents
     * @example 92.6
     */
    netKwhPrice?: number;
    /**
     * @description The kWh day-ahead spot price with VAT in cents
     * @example 110.2
     */
    grossKwhPrice?: number;
    /**
     * @description The kWh taxes and levies day-ahead spot price without VAT in cents
     * @example 16.2
     */
    netKwhTaxAndLevies?: number;
    /**
     * @description The kWh taxes and levies day-ahead spot price with VAT in cents
     * @example 19.28
     */
    grossKwhTaxAndLevies?: number;
    /**
     * @description The monthly Ostrom base fee without VAT in EUR
     * @example 5.04
     */
    netMonthlyOstromBaseFee?: number;
    /**
     * @description The monthly Ostrom base fee with VAT in EUR
     * @example 6
     */
    grossMonthlyOstromBaseFee?: number;
    /**
     * @description The monthly grid fees without VAT in EUR
     * @example 3.84
     */
    netMonthlyGridFees?: number;
    /**
     * @description The monthly grid fees with VAT in EUR
     * @example 4.57
     */
    grossMonthlyGridFees?: number;
}

export interface Consumption {
    /**
     * @description The date of the energy consumption data (start from)
     * @example 2023-10-22T01:00:00.000Z
     */
    date?: string;
    /**
     * @description The energy consumption in kWh
     * @example 0.48
     */
    kWh?: number;
}

export const enum Resolution {
    HOUR = 'HOUR',
    DAY  = 'DAY',
    MONTH = 'MONTH'
}

export default class OstromServerClient {
    private static readonly LINK_ENDPOINT = '/account/link';
    private static readonly USER_CONTRACTS_ENDPOINT = '/users/:externalUserId/contracts';
    private static readonly USER_CONTRACT_ENERGY_CONSUMPTION_ENDPOINT = '/users/:externalUserId/contracts/:contractId/energy-consumption';
    private static readonly PRICES_PATH = '/prices';
    private static readonly CALLBACK_PATH = '/redirect.html';

    // TODO: from environment
    private readonly serverUrl = "http://10.58.1.216:3000";
    //private readonly serverUrl = "https://ostrom.athom.com";

    constructor(private homey: Homey) { }

    async createAccountLink(): Promise<string> {
        const externalUserId = await this.homey.cloud.getHomeyId();

        let data: AccountLinkResponse;
        try {
             const response = await fetch(this.serverUrl + OstromServerClient.LINK_ENDPOINT, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ 
                    externalUserId: externalUserId,
                    redirectUrl: this.serverUrl + OstromServerClient.CALLBACK_PATH
                })
            });

            data = await response.json() as AccountLinkResponse;
        } catch (error) {
            this.logAndThrow(error);
        }  

        this.homey.log('Received account link URL: ' + data.link);

        return data.link;
    }

    async getContracts(): Promise<Contract[]> {
        const externalUserId = await this.homey.cloud.getHomeyId();

        let contracts: Contract[];
        try {
            const path = OstromServerClient.USER_CONTRACTS_ENDPOINT.replace(':externalUserId', externalUserId);
            const response = await fetch(this.serverUrl + path, {
                method: 'GET'
            });

            contracts = await response.json() as Contract[];
        } catch (error) {
            this.logAndThrow(error);
        }

        this.homey.log('Retrieved contract information', contracts);

        return contracts;
    }

    async getPrices(startDate: DateTime, endDate: DateTime, zip: string): Promise<Price[]> {
        let prices: Price[];
        try {
            const parameters = {
                startDate: startDate.toUTC().toISO()!,
                endDate: endDate.toUTC().toISO()!,
                zip: zip
            };

            const response = await fetch(this.serverUrl + OstromServerClient.PRICES_PATH + '?' + new URLSearchParams(parameters));
            prices = await response.json() as Price[];                
        } catch (error) {
            this.logAndThrow(error);
        }

        return prices;
    }

    async getEnergyConsumption(contractId: number, startDate: DateTime, endDate: DateTime, resolution: Resolution): Promise<Consumption[]> {
        const externalUserId = await this.homey.cloud.getHomeyId();

        // Check if the period is more than 1 year
        const diffInYears = endDate.diff(startDate, 'years').years;
        
        if (diffInYears <= 1) {
            // Single request for periods of 1 year or less
            return this.fetchEnergyConsumptionChunk(externalUserId, contractId, startDate, endDate, resolution);
        }

        this.homey.log('Breaking up energy consumption call into multiple requests because it spans multipe years');

        // Break up the request into yearly chunks
        const allConsumption: Consumption[] = [];
        let currentStart = startDate;

        while (currentStart < endDate) {
            // Calculate the end date for this chunk (1 year from current start, but not beyond the actual end date)
            const currentEnd = DateTime.min(currentStart.plus({ years: 1 }), endDate);
            
            try {
                const chunkConsumption = await this.fetchEnergyConsumptionChunk(
                    externalUserId, 
                    contractId, 
                    currentStart, 
                    currentEnd, 
                    resolution
                );
                
                allConsumption.push(...chunkConsumption);
            } catch (error) {
                this.homey.error(`Error fetching energy consumption chunk from ${currentStart.toISO()} to ${currentEnd.toISO()}`, error);
                throw error;
            }

            // Move to the next chunk
            currentStart = currentEnd;
        }

        return allConsumption;
    }

    private async fetchEnergyConsumptionChunk(
        externalUserId: string, 
        contractId: number, 
        startDate: DateTime, 
        endDate: DateTime, 
        resolution: Resolution
    ): Promise<Consumption[]> {
        let consumption: Consumption[];
        try {
            const path = OstromServerClient.USER_CONTRACT_ENERGY_CONSUMPTION_ENDPOINT
                .replace(':externalUserId', externalUserId)
                .replace(':contractId', contractId.toString());

            const body = {
                startDate: startDate.toUTC().toISO()!,
                endDate: endDate.toUTC().toISO()!,
                resolution: resolution as string
            };
            
            const response = await fetch(this.serverUrl + path, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
            });

            consumption = await response.json() as Consumption[];
        } catch (error) {
            this.logAndThrow(error);
        }

        return consumption;
    }

    private logAndThrow(error: any): never {
        this.homey.error('Error occurred when calling microserver', error);
        throw new Error(JSON.stringify(error)); 
    }
}
