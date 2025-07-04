import { DateTime } from "luxon";
import { OstromClient } from "./lib/client/client";

export default class PriceCache {
    private pricesToday: any = null;

    constructor(private client: OstromClient) {}

    async getToday() {
        if (!this.pricesToday) {
            this.pricesToday = await this.client.retrieveSpotPrices(
                DateTime.now().startOf('day'),
                DateTime.now().endOf('day')
              );
        }

        return this.pricesToday;
    }
}
