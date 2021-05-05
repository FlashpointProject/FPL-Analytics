import * as flashpoint from 'flashpoint-launcher';
import ua from 'universal-analytics';
import { v4 as uuid } from 'uuid';
import open from 'open';

export async function activate(context: flashpoint.ExtensionContext) {
  const registerSub = (d: flashpoint.Disposable) => { flashpoint.registerDisposable(context.subscriptions, d)};

  const config = {
    basic: () => flashpoint.getExtConfigValue('com.analytics.basic'),
    games: () => flashpoint.getExtConfigValue('com.analytics.games')
  }

  const firstLaunch = !flashpoint.getExtConfigValue('com.analytics.setup-complete');
  const firstConnect = true;
  flashpoint.onDidConnect(async () => {
    if (firstConnect) {
      if (firstLaunch) {
        const trackingInfoHuman = [
          'When you launch Flashpoint',
          'How long you use Flashpoint for',
          'The version of Flashpoint you are running',
          'What games you launch'
        ];
        const res = await flashpoint.dialogs.showMessageBox({
          message: `Enable the collection of Flashpoint Analytics?\nThese are listed below and configurable on the Config page.\n\n - ${trackingInfoHuman.join('\n - ')}\n\nThis information is tied to a randomized User ID, no personally identifitable information is collected however you can request deletion via the Config page.\n\nAbsolutely NOTHING will be tracked if you click Disable All.\nIf you want to delete this extension to be sure, go to /Data/Extensions and delete the Analytics folder.`,
          buttons: ['Disable All', 'Enable All'],
          cancelId: 0
        });
        if (res === 1) {
          await flashpoint.setExtConfigValue('com.analytics.basic', true);
          await flashpoint.setExtConfigValue('com.analytics.games', true);
        } else {
          await flashpoint.setExtConfigValue('com.analytics.basic', false);
          await flashpoint.setExtConfigValue('com.analytics.games', false);
        }
        flashpoint.setExtConfigValue('com.analytics.setup-complete', true);
      }

      if (config.basic()) {
        let userId: string | undefined = flashpoint.getExtConfigValue('com.analytics.user-id');
        if (!userId) {
          userId = uuid();
          flashpoint.setExtConfigValue('com.analytics.user-id', userId);
        }

        const visitor = ua('UA-196216429-1', { uid: userId });
        visitor.event('Basic', 'launch').send();
        visitor.event('Basic', 'version', flashpoint.dataVersion || '?');

        registerSub(flashpoint.games.onDidLaunchGame((game) => {
          if (config.games()) {
            visitor.event('Games', 'gameLaunch', game.id).send();
          }
        }));
      }

      registerSub(flashpoint.commands.registerCommand('com.analytics.deletion-request', async () => {
        await flashpoint.setExtConfigValue('com.analytics.basic', false);
        await flashpoint.setExtConfigValue('com.analytics.games', false);
        let userId = flashpoint.getExtConfigValue('com.analytics.user-id');
        const deletionFormUrl = `https://docs.google.com/forms/d/e/1FAIpQLScPeAKFmieGuHdu3FcyiSXqDdfcEFAfjIpM7nzlUsJbi9NYuw/viewform?entry.818267307=${userId}`;
        userId = uuid();
        await flashpoint.setExtConfigValue('com.analytics.user-id', userId);
        open(deletionFormUrl);
      }))
            
    }
  })
}