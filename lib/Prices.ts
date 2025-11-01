import { DateTime } from "luxon";
import { Price } from "./OstromServerClient.js";

export default class Prices {
    private readonly values: number[];
    private _lowest: number|null = null;
    private _highest: number|null = null;
    private _average: number|null = null;

    constructor(private prices: Price[]) {
        if (!Array.isArray(prices)) {
            throw new Error(`Prices constructor requires an array, but received: ${typeof prices}`);
        }
        
        if (prices.length === 0) {
            throw new Error('Prices constructor requires a non-empty array');
        }
        
        this.values = this.prices.map(price => price.netPrice!);
    }

    getPricesForNextNHours(time: DateTime, hours: number): Prices {
        const hour = time.startOf('hour').toMillis();

        // This assumes the prices are sorted!
        const index = this.prices.findIndex(price => DateTime.fromISO(price.date!).toMillis() === hour);

        if (index === -1) {
            throw new Error('Could not find price for the given time.');
        }

        return new Prices(this.prices.slice(index, hours));
    }

    getNLowest(n: number): Prices {
        const sorted = [...this.prices].sort((a, b) => a.netPrice! - b.netPrice!);
        return new Prices(sorted.slice(0, n));
    }

    getNHighest(n: number) {
        const sorted = [...this.prices].sort((a, b) => b.netPrice! - a.netPrice!);
        return new Prices(sorted.slice(0, n));
    }

    getPriceAtInstant(time: DateTime): Price|undefined {
        const hour = time.startOf('hour').toMillis();
        return this.prices.find(price => DateTime.fromISO(price.date!).toMillis() === hour);
    }

    getAverage() {
        if (this.values.length === 0) {
            return 0;
        }

        if (this._average === null) {
            this._average = this.values.reduce((acc, price) => acc + price, 0) / this.values.length;
        }

        return this._average;
    }

    getLowest() {
        if (this._lowest === null) {
            this._lowest = Math.min(...this.values);
        }

        return this._lowest;
    }

    getHighest() {
        if (this._highest === null) {
            this._highest = Math.max(...this.values);
        }
        
        return this._highest;
    }

    getValues() {
        return this.values;
    }

    getPricesBetweenTimes(startTime: string, endTime: string): Prices {
        // Parse time strings (e.g., "08:00", "14:00") to get hours and minutes
        const parseTime = (timeStr: string) => {
            const [hours, minutes] = timeStr.split(':').map(Number);
            return { hours, minutes };
        };

        const start = parseTime(startTime);
        const end = parseTime(endTime);

        const filteredPrices = this.prices.filter(price => {
            const priceDateTime = DateTime.fromISO(price.date!);
            const priceHour = priceDateTime.hour;
            const priceMinute = priceDateTime.minute;

            // Convert time to minutes since midnight for easier comparison
            const priceMinutesSinceMidnight = priceHour * 60 + priceMinute;
            const startMinutesSinceMidnight = start.hours * 60 + start.minutes;
            const endMinutesSinceMidnight = end.hours * 60 + end.minutes;

            // Handle case where time range crosses midnight (e.g., 22:00 to 06:00)
            if (startMinutesSinceMidnight > endMinutesSinceMidnight) {
            // Time range crosses midnight
            return priceMinutesSinceMidnight >= startMinutesSinceMidnight || 
                    priceMinutesSinceMidnight <= endMinutesSinceMidnight;
            } else {
            // Normal time range within the same day
            return priceMinutesSinceMidnight >= startMinutesSinceMidnight && 
                    priceMinutesSinceMidnight <= endMinutesSinceMidnight;
            }
        });

        return new Prices(filteredPrices);
    }
}