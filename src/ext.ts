import * as flashpoint from 'flashpoint-launcher';
import ua from 'universal-analytics';
import { v4 as uuid } from 'uuid';
import open from 'open';
import * as os from 'os';

export async function activate(context: flashpoint.ExtensionContext) {
  const registerSub = (d: flashpoint.Disposable) => { flashpoint.registerDisposable(context.subscriptions, d)};

  const config = {
    basic: () => flashpoint.getExtConfigValue('com.analytics.basic'),
    games: () => flashpoint.getExtConfigValue('com.analytics.games'),
    phpReporting: () => flashpoint.getExtConfigValue('com.analytics.php-reporting'),
    hardware: () => flashpoint.getExtConfigValue('com.analytics.hardware'),
    hardwareSent: () => flashpoint.getExtConfigValue('com.analytics.hardware-sent'),
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
          'What games you launch',
          'Which URLs games request, to help with repacking legacy games',
        ];
        const res = await flashpoint.dialogs.showMessageBox({
          message: `Enable the collection of Flashpoint Analytics?\nThese are listed below and configurable on the Config page.\n\n - ${trackingInfoHuman.join('\n - ')}\n\nThis information is tied to a randomized User ID, no personally identifitable information is collected however you can request deletion via the Config page.\n\nAbsolutely NOTHING will be tracked if you click Disable All.\nIf you want to delete this extension to be sure, go to /Data/Extensions and delete the Analytics folder.`,
          buttons: ['Disable All', 'Enable All'],
          cancelId: 0
        });
        if (res === 1) {
          await flashpoint.setExtConfigValue('com.analytics.basic', true);
          await flashpoint.setExtConfigValue('com.analytics.hardware', true);
          await flashpoint.setExtConfigValue('com.analytics.games', true);
          await flashpoint.setExtConfigValue('com.analytics.php-reporting', true);
        } else {
          await flashpoint.setExtConfigValue('com.analytics.basic', false);
          await flashpoint.setExtConfigValue('com.analytics.hardware', false);
          await flashpoint.setExtConfigValue('com.analytics.games', false);
          await flashpoint.setExtConfigValue('com.analytics.php-reporting', false);
        }
        await flashpoint.setExtConfigValue('com.analytics.setup-complete', true);
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

        if (config.hardware() && !config.hardwareSent()) {
          let totalmem = os.totalmem();
          let simplifiedTotalMem = "unknown";
          if      (totalmem > 17179000000) { simplifiedTotalMem = '>= 16GB';       }
          else if (totalmem > 8589900000)  { simplifiedTotalMem = '>= 8GB < 16GB'; }
          else if (totalmem > 4294900000)  { simplifiedTotalMem = '>= 4GB < 8GB';  }
          else if (totalmem > 2147400000)  { simplifiedTotalMem = '>= 2GB < 4GB';  }
          else if (totalmem > 10000)       { simplifiedTotalMem = '< 2GB';         }
          visitor.event('Hardware', 'arch', os.arch()).send();
          visitor.event('Hardware', 'operatingSystem', os.version()).send();
          visitor.event('Hardware', 'memory', simplifiedTotalMem).send();
          await flashpoint.setExtConfigValue('com.analytics.hardware-sent', true);
        }

        registerSub(flashpoint.games.onDidLaunchGame((game) => {
          if (config.games()) {
            visitor.event('Games', 'gameLaunch', game.id).send();
          }
        }));
        flashpoint.log.onLog((entry) => {
          if (entry.source === 'Server') {
            let urlSubstring = "";
            const baseIdx = entry.content.indexOf('Serving File From Base URLs:');
            if (baseIdx !== -1) {
              urlSubstring = entry.content.substring(baseIdx + 'Serving File From Base URLs:'.length + 2);
            } else {
              const htdocsIdx = entry.content.indexOf('Serving File From HTDOCS:');
              if (htdocsIdx !== -1) {
                urlSubstring = entry.content.substring(htdocsIdx + 'Serving File From HTDOCS:'.length + 8);
              }
            }
            if (urlSubstring && config.phpReporting()) {
              // Check if a singular game is running
              const games = flashpoint.services.getServices().filter(s => s.id.startsWith('game.'));
              if (games.length === 1) {
                const gameId = games[0].id.substring(5);
                visitor.event('Repack', 'phpReport', `gameId:${gameId}, path:${urlSubstring}`).send();
              }
            }
          }
        });
      }

      registerSub(flashpoint.commands.registerCommand('com.analytics.deletion-request', async () => {
        await flashpoint.setExtConfigValue('com.analytics.basic', false);
        await flashpoint.setExtConfigValue('com.analytics.games', false);
        await flashpoint.setExtConfigValue('com.analytics.hardware', false);
        await flashpoint.setExtConfigValue('com.analytics.php-reporting', false);
        let userId = flashpoint.getExtConfigValue('com.analytics.user-id');
        const deletionFormUrl = `https://docs.google.com/forms/d/e/1FAIpQLScPeAKFmieGuHdu3FcyiSXqDdfcEFAfjIpM7nzlUsJbi9NYuw/viewform?entry.818267307=${userId}`;
        userId = uuid();
        await flashpoint.setExtConfigValue('com.analytics.user-id', userId);
        open(deletionFormUrl);
      }))
            
    }
  });
}