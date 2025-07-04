import Bottleneck from "bottleneck";
import logger from "../../logger";

export default class RateLimiter {
    private static readonly MAX_REQUESTS_PER_MINUTE = 50;

    private readonly bottleneck = new Bottleneck({
        reservoir: RateLimiter.MAX_REQUESTS_PER_MINUTE,
        reservoirRefreshAmount: RateLimiter.MAX_REQUESTS_PER_MINUTE,
        reservoirRefreshInterval: 60 * 1000 // every minute
    });

    constructor() {
        this.bottleneck.on('empty', () => {
            logger.debug('Rate limiter at full capacity');            
        });

        this.bottleneck.on('depleted', () => {
            logger.warn('Rate limiter depleted');
        });
    }

    public wrap<TArgs extends any[], TReturn>(fn: (...args: TArgs) => Promise<TReturn>): (...args: TArgs) => Promise<TReturn> {
        return this.bottleneck.wrap(fn);
    }
}