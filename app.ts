import Homey from 'homey';

export default class OstromApp extends Homey.App {  
  /**
   * onInit is called when the app is initialized.
   */
  async onInit() {
    this.log('Ostrom application has been initialized');
    
    const homeyId = await this.homey.cloud.getHomeyId();
    this.log('Homey id ' + homeyId);
  }

}
