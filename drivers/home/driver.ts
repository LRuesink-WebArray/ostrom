import Homey from 'homey';
import OstromServerClient from '../../lib/OstromServerClient.js';

module.exports = class OstromHomeDriver extends Homey.Driver {
  // Views
  private static readonly LOADING_VIEW = 'loading';
  private static readonly ACCOUNT_LINK_VIEW = 'account_link';

  // View event
  private static readonly ACCOUNT_LINK_INIT_EVENT = 'account_link_init';

  public client!: OstromServerClient;

  /**
   * onInit is called when the driver is initialized.
   */
  async onInit() {
    this.client = new OstromServerClient(this.homey);
    this.log('Ostrom home driver has been initialized');
  }

  async onPair(session: Homey.Driver.PairSession): Promise<void> {
    let link: string|null = null;

    session.setHandler('list_devices', async () => {
      const contracts = await this.client.getContracts();

      return contracts.map(contract => <any> {
        name: contract.address?.street + ' ' + contract.address?.houseNumber,
        store: { contract },
        data: {
          id: contract.id
        }
      });
    });

    session.setHandler('showView', async (view) => {
      if (view === OstromHomeDriver.LOADING_VIEW) {
        this.log('Creating account link');

        link = await this.client.createAccountLink();
        
        await session.nextView();
      } else if (view === OstromHomeDriver.ACCOUNT_LINK_VIEW) {
        if (!link) {
          throw new Error('Expected link to be available when enetering the account link view');
        }

        session.emit(OstromHomeDriver.ACCOUNT_LINK_INIT_EVENT, link);        
      }
    });
  }
}
