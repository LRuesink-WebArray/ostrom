import Homey, { FlowCard, FlowCardTriggerDevice } from 'homey';
import OstromServerClient, { Consumption, Contract, Price, Resolution } from '../../lib/OstromServerClient.js';
import { DateTime } from 'luxon';
import { randomInt } from 'crypto';
import Prices from '../../lib/Prices.js';
import * as ConditionHandlers from '../../lib/ConditionHandlers.js';

type TriggerState = { current: Price, prices: Prices };

module.exports = class OstromHomeDevice extends Homey.Device {
  private static readonly MIN_JITTER = 0;
  private static readonly MAX_JITTER = 30;

  private static readonly CAPABILITY_IMPORTED_POWER = 'meter_power';
  private static readonly CAPABILITY_PRICE_CURRENT = 'measure_price_current';
  private static readonly CAPABILITY_PRICE_HIGHEST = 'measure_price_highest';
  private static readonly CAPABILITY_PRICE_LOWEST = 'measure_price_lowest';

  private client!: OstromServerClient;
  private lastFetchedHour: DateTime|null = null;
  private scheduledUpdate: NodeJS.Timeout|null = null;
  private currentPrices: Prices|null = null;
  private currentPrice: Price|null = null;

  priceBelowAverageTrigger!: FlowCardTriggerDevice;
  priceAboveAverageTrigger!: FlowCardTriggerDevice;
  priceBelowAverageTodayTrigger!: FlowCardTriggerDevice;
  priceAboveAverageTodayTrigger!: FlowCardTriggerDevice;
  priceAtLowestTrigger!: FlowCardTriggerDevice;
  priceAtHighestTrigger!: FlowCardTriggerDevice;
  priceAtLowestTodayTrigger!: FlowCardTriggerDevice;
  priceAtHighestTodayTrigger!: FlowCardTriggerDevice;
  priceAmongLowestTrigger!: FlowCardTriggerDevice;
  priceAmongHighestTrigger!: FlowCardTriggerDevice;
  currentPriceBelowCondition!: FlowCard;
  currentPriceBelowAverageCondition!: FlowCard;
  currentPriceAboveAverageCondition!: FlowCard;
  currentPriceBelowAverageTodayCondition!: FlowCard;
  currentPriceAboveAverageTodayCondition!: FlowCard;
  currentPriceAtLowestCondition!: FlowCard;
  currentPriceAtHighestCondition!: FlowCard;
  currentPriceAtLowestTodayCondition!: FlowCard;
  currentPriceAtHighestTodayCondition!: FlowCard;
  currentPriceAmongLowestTodayCondition!: FlowCard;
  currentPriceAmongHighestTodayCondition!: FlowCard;
  currentPriceAmongLowestWithinTimeFrameCondition!: FlowCard;

  private getConditionContext(): ConditionHandlers.ConditionContext {
    return {
      currentPrices: this.currentPrices,
      currentPrice: this.currentPrice,
    };
  }

  /**
   * onInit is called when the device is initialized.
   */
  async onInit() {
    this.client = (<any> this.driver).client;

    // Actions
    this.priceBelowAverageTrigger = this.homey.flow.getDeviceTriggerCard('price_below_avg'); 
    this.priceBelowAverageTrigger.registerRunListener(async (args, state: TriggerState) => {
      const prices = state.prices.getPricesForNextNHours(DateTime.now(), args.hours);
      return ConditionHandlers.isPriceBelowAverage(state.current.netPrice!, prices.getAverage(), args.percentage);
    });
    
    this.priceAboveAverageTrigger = this.homey.flow.getDeviceTriggerCard('price_above_avg');
    this.priceAboveAverageTrigger.registerRunListener(async (args, state: TriggerState) => {
      const prices = state.prices.getPricesForNextNHours(DateTime.now(), args.hours);
      return ConditionHandlers.isPriceAboveAverage(state.current.netPrice!, prices.getAverage(), args.percentage);
    });

    this.priceBelowAverageTodayTrigger = this.homey.flow.getDeviceTriggerCard('price_below_avg_today');
    this.priceBelowAverageTodayTrigger.registerRunListener(async (args, state: TriggerState) => {
      return ConditionHandlers.isPriceBelowAverage(state.current.netPrice!, state.prices.getAverage(), args.percentage);
    });
    
    this.priceAboveAverageTodayTrigger = this.homey.flow.getDeviceTriggerCard('price_above_avg_today');
    this.priceAboveAverageTodayTrigger.registerRunListener(async (args, state: TriggerState) => {
      return ConditionHandlers.isPriceAboveAverage(state.current.netPrice!, state.prices.getAverage(), args.percentage);
    });
        
    this.priceAtLowestTrigger = this.homey.flow.getDeviceTriggerCard('price_at_lowest');
    this.priceAtLowestTrigger.registerRunListener(async (args, state: TriggerState) => {
      const prices = state.prices.getPricesForNextNHours(DateTime.now(), args.hours);
      return ConditionHandlers.isPriceAtLowest(state.current.netPrice!, prices.getLowest());
    });
    
    this.priceAtHighestTrigger = this.homey.flow.getDeviceTriggerCard('price_at_highest');
    this.priceAtHighestTrigger.registerRunListener(async (args, state: TriggerState) => {
      const prices = state.prices.getPricesForNextNHours(DateTime.now(), args.hours);
      return ConditionHandlers.isPriceAtHighest(state.current.netPrice!, prices.getHighest());
    });
    
    this.priceAtLowestTodayTrigger = this.homey.flow.getDeviceTriggerCard('price_at_lowest_today');
    this.priceAtLowestTodayTrigger.registerRunListener(async (args, state: TriggerState) => {
      return ConditionHandlers.isPriceAtLowest(state.current.netPrice!, state.prices.getLowest());
    });

    this.priceAtHighestTodayTrigger = this.homey.flow.getDeviceTriggerCard('price_at_highest_today');
    this.priceAtHighestTodayTrigger.registerRunListener(async (args, state: TriggerState) => {
      return ConditionHandlers.isPriceAtHighest(state.current.netPrice!, state.prices.getHighest());
    });

    this.priceAmongLowestTrigger = this.homey.flow.getDeviceTriggerCard('price_among_lowest_today');
    this.priceAmongLowestTrigger.registerRunListener(async (args, state: TriggerState) => {
      return ConditionHandlers.isPriceAmongLowest(state.prices, args.ranked_hours);
    });

    this.priceAmongHighestTrigger = this.homey.flow.getDeviceTriggerCard('price_among_highest_today');
    this.priceAmongHighestTrigger.registerRunListener(async (args, state: TriggerState) => {
      return ConditionHandlers.isPriceAmongHighest(state.prices, args.ranked_hours);
    });
    
    // Conditions with the same helper functions
    this.currentPriceBelowCondition = this.homey.flow.getConditionCard('current_price_below');
    this.currentPriceBelowCondition.registerRunListener(async (args) => {
      const currentPrice = this.getCapabilityValue(OstromHomeDevice.CAPABILITY_PRICE_CURRENT);
      return currentPrice < args.price;
    });

    this.currentPriceBelowAverageCondition = this.homey.flow.getConditionCard('cond_price_below_avg');
    this.currentPriceBelowAverageCondition.registerRunListener(async (args) => {
      return ConditionHandlers.condPriceBelowAvg(this.getConditionContext(), args);
    });

    this.currentPriceAboveAverageCondition = this.homey.flow.getConditionCard('cond_price_above_avg');
    this.currentPriceAboveAverageCondition.registerRunListener(async (args) => {
      return ConditionHandlers.condPriceAboveAvg(this.getConditionContext(), args);
    });

    this.currentPriceBelowAverageTodayCondition = this.homey.flow.getConditionCard('cond_price_below_avg_today');
    this.currentPriceBelowAverageTodayCondition.registerRunListener(async (args) => {
      return ConditionHandlers.condPriceBelowAvgToday(this.getConditionContext(), args);
    });

    this.currentPriceAboveAverageTodayCondition = this.homey.flow.getConditionCard('cond_price_above_avg_today');
    this.currentPriceAboveAverageTodayCondition.registerRunListener(async (args) => {
      return ConditionHandlers.condPriceAboveAvgToday(this.getConditionContext(), args);
    });

    this.currentPriceAtLowestCondition = this.homey.flow.getConditionCard('cond_price_at_lowest');
    this.currentPriceAtLowestCondition.registerRunListener(async (args) => {
      return ConditionHandlers.condPriceAtLowest(this.getConditionContext(), args);
    });

    this.currentPriceAtHighestCondition = this.homey.flow.getConditionCard('cond_price_at_highest');
    this.currentPriceAtHighestCondition.registerRunListener(async (args) => {
      return ConditionHandlers.condPriceAtHighest(this.getConditionContext(), args);
    });

    this.currentPriceAtLowestTodayCondition = this.homey.flow.getConditionCard('cond_price_at_lowest_today');
    this.currentPriceAtLowestTodayCondition.registerRunListener(async () => {
      return ConditionHandlers.condPriceAtLowestToday(this.getConditionContext());
    });

    this.currentPriceAtHighestTodayCondition = this.homey.flow.getConditionCard('cond_price_at_highest_today');
    this.currentPriceAtHighestTodayCondition.registerRunListener(async () => {
      return ConditionHandlers.condPriceAtHighestToday(this.getConditionContext());
    });

    this.currentPriceAmongLowestTodayCondition = this.homey.flow.getConditionCard('cond_price_among_lowest_today');
    this.currentPriceAmongLowestTodayCondition.registerRunListener(async (args) => {
      return ConditionHandlers.condPriceAmongLowestToday(this.getConditionContext(), args);
    });

    this.currentPriceAmongHighestTodayCondition = this.homey.flow.getConditionCard('cond_price_among_highest_today');
    this.currentPriceAmongHighestTodayCondition.registerRunListener(async (args) => {
      return ConditionHandlers.condPriceAmongHighestToday(this.getConditionContext(), args);
    });

    this.currentPriceAmongLowestWithinTimeFrameCondition = this.homey.flow.getConditionCard('cond_price_among_lowest_during_time');
    this.currentPriceAmongLowestWithinTimeFrameCondition.registerRunListener(async (args) => {
      return ConditionHandlers.condPriceAmongLowestDuringTime(this.getConditionContext(), args);
    });
    
    await this.initializeTotalUsage();
    await this.updatePricingInformation();
    
    this.log('Ostrom contract has been initialized');
  }

  onDeleted(): void {
    if (this.scheduledUpdate) {
      this.homey.clearTimeout(this.scheduledUpdate);
    }
  }

  private async initializeTotalUsage() {
    this.log('Fetching historical usage...');
    
    const historicalUsage = await this.getUsageSinceStartOfContract();

    if (!historicalUsage || historicalUsage.length === 0) {
      this.error('Could not find any historical usage entries!');
      return;
    }

    this.log(`Fetched ${historicalUsage.length} historical entries`);

    // Set the total consumption based on historical data; because we sum up all usage this should in theory
    // always increase (and as such be cumulative).
    const totalKwh = historicalUsage.reduce((acc, consumption) => acc + consumption.kWh!, 0);
    this.log(`Starting at ${totalKwh.toFixed(2)} kWh`)
    await this.setCapabilityValue(OstromHomeDevice.CAPABILITY_IMPORTED_POWER, totalKwh);    

    const lastHour = historicalUsage[historicalUsage.length - 1];
    this.lastFetchedHour = DateTime.fromISO(lastHour.date!);

    this.scheduleNextUpdate();
  }

  private async getUsageSinceStartOfContract(): Promise<Consumption[]> {
    const contract = this.getStore().contract as Contract;
    return await this.client.getEnergyConsumption(
      contract.id!,
      DateTime.fromISO(contract.startDate!).startOf('day'),
      DateTime.now().startOf('hour'),
      Resolution.HOUR // TODO: Check if this is even feasible for older contracts!
    );
  }

  private scheduleNextUpdate() {
    if (!this.lastFetchedHour) {
      this.error('Did not fetch historical usage data, can\'t schedule incremental update!');
      return;
    }

    // Since we are subject to a global rate limit on the server, we add some jitter to
    // distribute the calls.
    const jitter = randomInt(OstromHomeDevice.MIN_JITTER, OstromHomeDevice.MAX_JITTER);

    const nextRefresh = DateTime.now().plus({ hour: 1 }).startOf('hour').plus({ seconds: jitter });
    const seconds = parseInt(nextRefresh.diff(DateTime.now()).as('seconds').toFixed(0));

    this.log(`Next refresh scheduled at ${nextRefresh}, in ${seconds} seconds (jitter: ${jitter})`);

    this.scheduledUpdate = this.homey.setTimeout(async () => {
      try {
        await this.updateTotalEnergyConsumption();
      } catch (error) {
        this.error('Failed to update energy consumption:', error);
      }

      try {
        await this.updatePricingInformation();
      } catch (error) {
        this.error('Failed to update pricing information:', error);
      }

      // Always schedule the next update, even if the current one failed
      this.scheduleNextUpdate();
    }, seconds * 1000);
  }

  private async updatePricingInformation() {
    const contract = this.getStore().contract as Contract;

    // We always fetch todays prices.
    // TODO: reduce update frequency?
    const retrievedPrices = await this.client.getPrices(
      DateTime.now().startOf('day'),
      DateTime.now().plus({ days: 1 }).startOf('day'),
      contract.address!.zip!
    );

    if (retrievedPrices.length === 0) {
      this.error('Got an empty list of price values!');
      return;
    }

    this.log(`Retrieved ${retrievedPrices.length} prices from API`);
    if (retrievedPrices.length > 0) {
      const firstPrice = DateTime.fromISO(retrievedPrices[0].date!);
      const lastPrice = DateTime.fromISO(retrievedPrices[retrievedPrices.length - 1].date!);
      this.log(`Price range: ${firstPrice.toISO()} to ${lastPrice.toISO()}`);
    }

    const prices = new Prices(retrievedPrices);
    this.currentPrices = prices;
    const now = DateTime.now();
    const currentHour = now.startOf('hour').toMillis();
    const lowestPrice = Math.min(...retrievedPrices.map(p => p.netPrice!));
    const highestPrice = Math.max(...retrievedPrices.map(p => p.netPrice!));
    
    this.log(`Current time: ${now.toISO()} (local), ${now.toUTC().toISO()} (UTC)`);
    this.log(`Current hour millis: ${currentHour}`);
    
    const hourlyPricingLog = retrievedPrices.map(p => {
      const t = DateTime.fromISO(p.date!);
      const tLocal = t.setZone('local');
      const price = p.netPrice!.toFixed(2);
      const markers: string[] = [];
      
      if (t.toMillis() === currentHour) {
        markers.push('current');
      }
      if (Math.abs(p.netPrice! - lowestPrice) < 0.001) {
        markers.push('lowest');
      }
      if (Math.abs(p.netPrice! - highestPrice) < 0.001) {
        markers.push('highest');
      }
      
      const markerStr = markers.length > 0 ? ` (${markers.join(', ')})` : '';
      return `${tLocal.toFormat('HH:mm')}: ${price}${markerStr} [API: ${t.toISO()}]`;
    }).join('\n');
    this.log(`Today's per-hour prices:\n${hourlyPricingLog}`);
    const current = prices.getPriceAtInstant(now);
    
    if (!current) {
      this.error(`Could not find price for current hour: ${now.toISO()}`);
      return;
    }
    
    this.currentPrice = current;

    const highest = prices.getHighest();
    const lowest = prices.getLowest();

    this.log(`Pricing: [current: ${current.netPrice!}, highest: ${highest}, lowest: ${lowest}]`);

    await this.setCapabilityValue(OstromHomeDevice.CAPABILITY_PRICE_CURRENT, parseFloat(current.netPrice!.toFixed(2)));
    await this.setCapabilityValue(OstromHomeDevice.CAPABILITY_PRICE_HIGHEST, parseFloat(highest.toFixed(2)));
    await this.setCapabilityValue(OstromHomeDevice.CAPABILITY_PRICE_LOWEST, parseFloat(lowest.toFixed(2)));

    // Actions
    const state = { prices, current };

    // Triggers with dynamic time windows (next N hours) - always fire, run listener filters
    await this.priceBelowAverageTrigger.trigger(this, {}, state);
    await this.priceAboveAverageTrigger.trigger(this, {}, state);
    await this.priceAtLowestTrigger.trigger(this, {}, state);
    await this.priceAtHighestTrigger.trigger(this, {}, state);

    // Triggers with fixed scope but variable thresholds - always fire, run listener filters
    await this.priceBelowAverageTodayTrigger.trigger(this, {}, state);
    await this.priceAboveAverageTodayTrigger.trigger(this, {}, state);
    await this.priceAmongLowestTrigger.trigger(this, {}, state);
    await this.priceAmongHighestTrigger.trigger(this, {}, state);

    // Triggers with fixed scope and no thresholds - can pre-filter to reduce evaluations
    if (ConditionHandlers.isPriceAtLowest(current.netPrice!, lowest)) {
      this.log(`[TRIGGER] Price at lowest today: current=${current.netPrice!.toFixed(2)}, lowest=${lowest.toFixed(2)}`);
      await this.priceAtLowestTodayTrigger.trigger(this, {}, state);
    }
    
    if (ConditionHandlers.isPriceAtHighest(current.netPrice!, highest)) {
      this.log(`[TRIGGER] Price at highest today: current=${current.netPrice!.toFixed(2)}, highest=${highest.toFixed(2)}`);
      await this.priceAtHighestTodayTrigger.trigger(this, {}, state);
    }
  }

  private async updateTotalEnergyConsumption() {
    if (!this.lastFetchedHour) {
      this.error('Did not fetch historical usage data, not going to do an incremental update!');
      return;
    }

    if (this.lastFetchedHour.equals(DateTime.now().startOf('hour'))) {
      // this.log('Already fetched consumption for this hour, will not call api');
      return;
    }

    const currentValue = this.getCapabilityValue(OstromHomeDevice.CAPABILITY_IMPORTED_POWER);
    this.log('Current value: ' + currentValue);
    const contract = this.getStore().contract as Contract;
    const incrementalConsumption = await this.client.getEnergyConsumption(
      contract.id!,
      this.lastFetchedHour.plus({ 'hours': 1 }).startOf('hour'),
      DateTime.now().startOf('hour'),
      Resolution.HOUR
    );
    this.log('Retrieved incremental consumption data', incrementalConsumption);

    if (!Array.isArray(incrementalConsumption)) {
      this.error('Retrieved consumption data is not an array:', typeof incrementalConsumption);
      return;
    }

    if (incrementalConsumption.length === 0) {
      this.log('Did not retrieve any incremental consumption data.');
      return;
    }

    const totalConsumption = currentValue + incrementalConsumption.reduce((acc, consumption) => acc + consumption.kWh!, 0);
    this.log('Calculated new total consumption:', totalConsumption);
    await this.setCapabilityValue(OstromHomeDevice.CAPABILITY_IMPORTED_POWER, totalConsumption);
    this.lastFetchedHour = DateTime.fromISO(incrementalConsumption[incrementalConsumption.length - 1].date!);
  }

  /**
   * onAdded is called when the user adds the device, called just after pairing.
   */
  async onAdded() {
    this.log('Ostrom contract has been added');
  }
};
