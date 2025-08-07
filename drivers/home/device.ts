import Homey, { FlowCard, FlowCardTriggerDevice } from 'homey';
import OstromServerClient, { Consumption, Contract, Price, Resolution } from '../../lib/OstromServerClient.js';
import { DateTime } from 'luxon';
import { randomInt } from 'crypto';
import Prices from '../../lib/Prices.js';

type TriggerState = { current: Price, prices: Prices };

export default class OstromHomeDevice extends Homey.Device {
  private static readonly MIN_JITTER = 0;
  private static readonly MAX_JITTER = 30;

  private static readonly CAPABILITY_IMPORTED_POWER = 'meter_power.imported';
  private static readonly CAPABILITY_PRICE_CURRENT = 'measure_price_current';
  private static readonly CAPABILITY_PRICE_HIGHEST = 'measure_price_highest';
  private static readonly CAPABILITY_PRICE_LOWEST = 'measure_price_lowest';

  private client!: OstromServerClient;
  private lastFetchedHour: DateTime|null = null;
  private scheduledUpdate: NodeJS.Timeout|null = null;

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

  private isPriceBelowAverage(currentPrice: number, averagePrice: number, percentage: number): boolean {
    const threshold = averagePrice * (1 - percentage / 100);
    return currentPrice <= threshold;
  }

  private isPriceAboveAverage(currentPrice: number, averagePrice: number, percentage: number): boolean {
    const threshold = averagePrice * (1 + percentage / 100);
    return currentPrice >= threshold;
  }

  private isPriceAtLowest(currentPrice: number, lowestPrice: number): boolean {
    return Math.abs(currentPrice - lowestPrice) < 0.001;
  }

  private isPriceAtHighest(currentPrice: number, highestPrice: number): boolean {
    return Math.abs(currentPrice - highestPrice) < 0.001;
  }

  private isPriceAmongLowest(prices: Prices, rankedHours: number): boolean {
    const lowestPrices = prices.getNLowest(rankedHours);
    return lowestPrices.getPriceAtInstant(DateTime.now()) !== undefined;
  }

  private isPriceAmongHighest(prices: Prices, rankedHours: number): boolean {
    const highestPrices = prices.getNHighest(rankedHours);
    return highestPrices.getPriceAtInstant(DateTime.now()) !== undefined;
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
      return this.isPriceBelowAverage(state.current.grossKwhTaxAndLevies!, prices.getAverage(), args.percentage);
    });
    
    this.priceAboveAverageTrigger = this.homey.flow.getDeviceTriggerCard('price_above_avg');
    this.priceAboveAverageTrigger.registerRunListener(async (args, state: TriggerState) => {
      const prices = state.prices.getPricesForNextNHours(DateTime.now(), args.hours);
      return this.isPriceAboveAverage(state.current.grossKwhTaxAndLevies!, prices.getAverage(), args.percentage);
    });

    this.priceBelowAverageTodayTrigger = this.homey.flow.getDeviceTriggerCard('price_below_avg_today');
    this.priceBelowAverageTodayTrigger.registerRunListener(async (args, state: TriggerState) => {
      return this.isPriceBelowAverage(state.current.grossKwhTaxAndLevies!, state.prices.getAverage(), args.percentage);
    });
    
    this.priceAboveAverageTodayTrigger = this.homey.flow.getDeviceTriggerCard('price_above_avg_today');
    this.priceAboveAverageTodayTrigger.registerRunListener(async (args, state: TriggerState) => {
      return this.isPriceAboveAverage(state.current.grossKwhTaxAndLevies!, state.prices.getAverage(), args.percentage);
    });
        
    this.priceAtLowestTrigger = this.homey.flow.getDeviceTriggerCard('price_at_lowest');
    this.priceAtLowestTrigger.registerRunListener(async (args, state: TriggerState) => {
      const prices = state.prices.getPricesForNextNHours(DateTime.now(), args.hours);
      return this.isPriceAtLowest(state.current.grossKwhTaxAndLevies!, prices.getLowest());
    });
    
    this.priceAtHighestTrigger = this.homey.flow.getDeviceTriggerCard('price_at_highest');
    this.priceAtHighestTrigger.registerRunListener(async (args, state: TriggerState) => {
      const prices = state.prices.getPricesForNextNHours(DateTime.now(), args.hours);
      return this.isPriceAtHighest(state.current.grossKwhTaxAndLevies!, prices.getHighest());
    });
    
    this.priceAtLowestTodayTrigger = this.homey.flow.getDeviceTriggerCard('price_at_lowest_today');
    this.priceAtLowestTodayTrigger.registerRunListener(async (args, state: TriggerState) => {
      return this.isPriceAtLowest(state.current.grossKwhTaxAndLevies!, state.prices.getLowest());
    });

    this.priceAtHighestTodayTrigger = this.homey.flow.getDeviceTriggerCard('price_at_highest_today');
    this.priceAtHighestTodayTrigger.registerRunListener(async (args, state: TriggerState) => {
      return this.isPriceAtHighest(state.current.grossKwhTaxAndLevies!, state.prices.getHighest());
    });

    this.priceAmongLowestTrigger = this.homey.flow.getDeviceTriggerCard('price_among_lowest_today');
    this.priceAmongLowestTrigger.registerRunListener(async (args, state: TriggerState) => {
      return this.isPriceAmongLowest(state.prices, args.ranked_hours);
    });

    this.priceAmongHighestTrigger = this.homey.flow.getDeviceTriggerCard('price_among_highest_today');
    this.priceAmongHighestTrigger.registerRunListener(async (args, state: TriggerState) => {
      return this.isPriceAmongHighest(state.prices, args.ranked_hours);
    });
    
    // Conditions with the same helper functions
    this.currentPriceBelowCondition = this.homey.flow.getConditionCard('current_price_below');
    this.currentPriceBelowCondition.registerRunListener(async (args, state: TriggerState) => {
      return state.current.grossKwhTaxAndLevies! < args.price;
    });

    this.currentPriceBelowAverageCondition = this.homey.flow.getConditionCard('cond_price_below_avg');
    this.currentPriceBelowAverageCondition.registerRunListener(async (args, state: TriggerState) => {
      const prices = state.prices.getPricesForNextNHours(DateTime.now(), args.hours);
      return this.isPriceBelowAverage(state.current.grossKwhTaxAndLevies!, prices.getAverage(), args.percentage);
    });

    this.currentPriceAboveAverageCondition = this.homey.flow.getConditionCard('cond_price_above_avg');
    this.currentPriceAboveAverageCondition.registerRunListener(async (args, state: TriggerState) => {
      const prices = state.prices.getPricesForNextNHours(DateTime.now(), args.hours);
      return this.isPriceAboveAverage(state.current.grossKwhTaxAndLevies!, prices.getAverage(), args.percentage);
    });

    this.currentPriceBelowAverageTodayCondition = this.homey.flow.getConditionCard('cond_price_below_avg_today');
    this.currentPriceBelowAverageTodayCondition.registerRunListener(async (args, state: TriggerState) => {
      return this.isPriceBelowAverage(state.current.grossKwhTaxAndLevies!, state.prices.getAverage(), args.percentage);
    });

    this.currentPriceAboveAverageTodayCondition = this.homey.flow.getConditionCard('cond_price_above_avg_today');
    this.currentPriceAboveAverageTodayCondition.registerRunListener(async (args, state: TriggerState) => {
      return this.isPriceAboveAverage(state.current.grossKwhTaxAndLevies!, state.prices.getAverage(), args.percentage);
    });

    this.currentPriceAtLowestCondition = this.homey.flow.getConditionCard('cond_price_at_lowest');
    this.currentPriceAtLowestCondition.registerRunListener(async (args, state: TriggerState) => {
      const prices = state.prices.getPricesForNextNHours(DateTime.now(), args.hours);
      return this.isPriceAtLowest(state.current.grossKwhTaxAndLevies!, prices.getLowest());
    });

    this.currentPriceAtHighestCondition = this.homey.flow.getConditionCard('cond_price_at_highest');
    this.currentPriceAtHighestCondition.registerRunListener(async (args, state: TriggerState) => {
      const prices = state.prices.getPricesForNextNHours(DateTime.now(), args.hours);
      return this.isPriceAtHighest(state.current.grossKwhTaxAndLevies!, prices.getHighest());
    });

    this.currentPriceAtLowestTodayCondition = this.homey.flow.getConditionCard('cond_price_at_lowest_today');
    this.currentPriceAtLowestTodayCondition.registerRunListener(async (args, state: TriggerState) => {
      return this.isPriceAtLowest(state.current.grossKwhTaxAndLevies!, state.prices.getLowest());
    });

    this.currentPriceAtHighestTodayCondition = this.homey.flow.getConditionCard('cond_price_at_highest_today');
    this.currentPriceAtHighestTodayCondition.registerRunListener(async (args, state: TriggerState) => {
      return this.isPriceAtHighest(state.current.grossKwhTaxAndLevies!, state.prices.getHighest());
    });

    this.currentPriceAmongLowestTodayCondition = this.homey.flow.getConditionCard('cond_price_among_lowest_today');
    this.currentPriceAmongLowestTodayCondition.registerRunListener(async (args, state: TriggerState) => {
      return this.isPriceAmongLowest(state.prices, args.ranked_hours);
    });

    this.currentPriceAmongHighestTodayCondition = this.homey.flow.getConditionCard('cond_price_among_highest_today');
    this.currentPriceAmongHighestTodayCondition.registerRunListener(async (args, state: TriggerState) => {
      return this.isPriceAmongHighest(state.prices, args.ranked_hours);
    });

    this.currentPriceAmongLowestWithinTimeFrameCondition = this.homey.flow.getConditionCard('cond_price_among_lowest_during_time');
    this.currentPriceAmongLowestWithinTimeFrameCondition.registerRunListener(async (args, state: TriggerState) => {
      // This one might need custom logic based on time frame
      const timeFramePrices = state.prices.getPricesBetweenTimes(args.start_time, args.end_time);
      return this.isPriceAmongLowest(timeFramePrices, args.ranked_hours);
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

    if (historicalUsage.length === 0) {
      this.error('Could not find any historical usage entries!');
      return;
    }

    this.log(`Fetched ${historicalUsage.length} historical entries`);

    // Set the total consumption based on historical data; because we sum up all usage this should in theory
    // always increase (and as such be cumulative).
    const totalKwh = historicalUsage.reduce((acc, consumption) => acc += consumption.kWh!, 0);
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

    const nextRefresh = this.lastFetchedHour.plus({ hour: 1 }).startOf('hour').plus({ seconds: jitter });
    const seconds = parseInt(nextRefresh.diff(DateTime.now()).as('seconds').toFixed(0));

    this.log(`Next refresh scheduled at ${nextRefresh}, in ${seconds} seconds (jitter: ${jitter})`);

    this.scheduledUpdate = this.homey.setTimeout(async () => {
      await this.updateTotalEnergyConsumption();
      await this.updatePricingInformation();

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

    const prices = new Prices(retrievedPrices);
    const current = prices.getPriceAtInstant(DateTime.now())!.grossKwhTaxAndLevies!;

    await this.setCapabilityValue(OstromHomeDevice.CAPABILITY_PRICE_CURRENT, current);
    await this.setCapabilityValue(OstromHomeDevice.CAPABILITY_PRICE_HIGHEST, prices.getHighest());
    await this.setCapabilityValue(OstromHomeDevice.CAPABILITY_PRICE_LOWEST, prices.getLowest());

    // Actions
    
    // Price below average
    const average = prices.getAverage();
    const state = { prices, current };

    if (current < average) {
      await this.priceBelowAverageTrigger.trigger(this, {}, state);
      await this.priceBelowAverageTodayTrigger.trigger(this, {}, state);
    }

    // Price above average
    if (current > average) {
      await this.priceAboveAverageTrigger.trigger(this, {}, state);
      await this.priceAboveAverageTodayTrigger.trigger(this, {}, state);
    }

    // Always trigger, let run listener handle conditions
    this.priceAtLowestTrigger.trigger(this, {}, state);
    this.priceAtHighestTrigger.trigger(this, {}, state);
    this.priceAtLowestTodayTrigger.trigger(this, {}, state);
    this.priceAtHighestTodayTrigger.trigger(this, {}, state);
    this.priceAmongLowestTrigger.trigger(this, {}, state);
    this.priceAmongHighestTrigger.trigger(this, {}, state);
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

    if (incrementalConsumption.length === 0) {
      this.log('Did not retrieve any incremental consumption data.');
      return;
    }

    const totalConsumption = currentValue + incrementalConsumption.reduce((acc, consumption) => acc += consumption.kWh!, 0);
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
