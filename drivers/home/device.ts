import Homey from 'homey';
import OstromServerClient, { Consumption, Contract, Resolution } from '../../lib/OstromServerClient.js';
import { DateTime } from 'luxon';
import { randomInt } from 'crypto';

export default class OstromHomeDevice extends Homey.Device {
  private static readonly MIN_JITTER = 0;
  private static readonly MAX_JITTER = 60;

  private client!: OstromServerClient;
  private lastFetchedHour: DateTime|null = null;
  private scheduledUpdate: NodeJS.Timeout|null = null;

  /**
   * onInit is called when the device is initialized.
   */
  async onInit() {
    this.client = (<any> this.driver).client;

    await this.initializeTotalUsage();
    
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

    // Set the total consumption based on historical data; because we sum up all usage this should in theory
    // always increase (and as such be cumulative).
    const totalKwh = historicalUsage.reduce((acc, consumption) => acc += consumption.kWh!, 0);
    this.log(`Starting at ${totalKwh.toFixed(2)} kWh`)
    await this.setCapabilityValue('meter_power.imported', totalKwh);    

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
      this.scheduleNextUpdate();
    }, seconds * 1000);
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

    const currentValue = this.getCapabilityValue('meter_power.imported');
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
    await this.setCapabilityValue('meter_power.imported', totalConsumption);
    this.lastFetchedHour = DateTime.fromISO(incrementalConsumption[incrementalConsumption.length - 1].date!);
  }

  private async getTodaysSpotPrices() {
    const prices = await this.client.getPrices(
      DateTime.now().startOf('day'),
      DateTime.now().plus({ days: 1 }).startOf('day'),
      this.getStore().address.zip
    );
  
    this.log(prices);
  }

  /**
   * onAdded is called when the user adds the device, called just after pairing.
   */
  async onAdded() {
    this.log('Ostrom contract has been added');
  }
};
