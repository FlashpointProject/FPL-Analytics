import * as flashpoint from 'flashpoint-launcher';
import { v4 as uuid } from 'uuid';
import open from 'open';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import axios from 'axios';
import { URL } from 'url';

let session: Session | undefined;

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
  let firstConnect = true;
  flashpoint.onDidConnect(async () => {
    if (firstConnect) {
      firstConnect = false;
      // First Launch Prompts
      if (firstLaunch) {
        const trackingInfoHuman = [
          'When you launch Flashpoint',
          'How long you use Flashpoint for',
          'The version of Flashpoint you are running',
          'What games you launch and how long you spend playing them',
          'Which URLs games request, to help with finding missing files from games',
          'Simplified Hardware Info (Architecture, Operating System, Available Memory)',
        ];
        const res = await flashpoint.dialogs.showMessageBox({
          message: `Enable the collection of Flashpoint Analytics? These can help us identify ways to improve the Flashpoint Project.\nThese are listed below and configurable on the Config page.\n\n - ${trackingInfoHuman.join('\n - ')}\n\nThis information is tied to a randomized User ID, no personally identifitable information is collected however you can request deletion via the Config page.\n\nAbsolutely NOTHING will be tracked if you click Disable All.\nIf you want to delete this extension to be sure, go to /Data/Extensions and delete the Analytics folder.`,
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
        
        // Create Session
        session = new Session(userId);
        await session.connect();
        session.event('Basic', 'launch', '');
        if (flashpoint.dataVersion) {
          session.event('Basic', 'version', flashpoint.dataVersion);
        }

        // Hardware
        if (config.hardware() && !config.hardwareSent()) {
          let totalmem = os.totalmem();
          let simplifiedTotalMem = "unknown";
          if      (totalmem > 17179000000) { simplifiedTotalMem = '>= 16GB';       }
          else if (totalmem > 8589900000)  { simplifiedTotalMem = '>= 8GB < 16GB'; }
          else if (totalmem > 4294900000)  { simplifiedTotalMem = '>= 4GB < 8GB';  }
          else if (totalmem > 2147400000)  { simplifiedTotalMem = '>= 2GB < 4GB';  }
          else if (totalmem > 10000)       { simplifiedTotalMem = '< 2GB';         }
          Promise.all([
            session.event('Hardware', 'arch', os.arch()),
            session.event('Hardware', 'operatingSystem', os.version()),
            session.event('Hardware', 'memory', simplifiedTotalMem)
          ])
          .then(() => {
            flashpoint.setExtConfigValue('com.analytics.hardware-sent', true);
          })
          .catch((err) => {
            flashpoint.log.error('Error sending Hardware stats, will send on next startup.');
          })
        }

        // Game Launch
        registerSub(flashpoint.games.onDidLaunchGame((game) => {
          if (config.games()) {
            session.event('Games', 'gameLaunch', game.id);
            const timeStart = Date.now();
            const listener = flashpoint.services.onServiceRemove((process) => {
              if (process.id === 'game.' + game.id) {
                session.event('GameTime', 'gameId', ((Date.now() - timeStart) / 1000).toString());
                flashpoint.dispose(listener);
              }
            })
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
                session.event('Repack', gameId, urlSubstring);
              }
            }
          }
        });

        // Wipe User Data
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
        }));
      }     
    }
  });
}

export function deactivate() {
  if (session) {
    session.close();
  }
}

class Session {
  private host?: string;
  private generalToken?: string;
  private sessionId?: string;
  private sessionToken?: string;
  private pingInterval?: NodeJS.Timeout;

  constructor(
    public userId: string
  ) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(flashpoint.extensionPath, 'package.json')).toString());
      this.generalToken = data.config.generalToken;
      this.host = data.config.host;
    } catch (err) {
      flashpoint.log.debug('Failed to read package.json');
    }
  }
  
  async connect() {
    if (this.generalToken && this.host) {
      const url = new URL(`/user/${this.userId}/session`, this.host);
      const res = await axios.get(url.toString(), {
        headers: {
          'Authorization': `Bearer ${this.generalToken}`,
          'Content-Type': 'application/json'
        }
      });
      if (res.data && res.data.session_uuid && res.data.session_token) {
        this.sessionId = res.data.session_uuid;
        this.sessionToken = res.data.session_token;
        this.pingInterval = setInterval(() => {
          this.event('Ping', 'alive', '');
        }, 1000 * 60 * 5);
        this.event('Ping', 'alive', '');
        flashpoint.log.debug('Created Analytics Session');
      } else {
        flashpoint.log.error('Bad Analytics Response getting Session - \n' + JSON.stringify(res.data));
      }
    }
  }

  close() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.sessionId = undefined;
      this.sessionToken = undefined;
    }
  }

  async event(category: string, key: string, value: string) {
    if (this.generalToken && this.host && this.sessionToken) {
      const url = new URL(`/session/${this.sessionId}/event`, this.host);
      const data = { category, key, value };
      await axios.post(url.toString(), data, {
        headers: {
          'Authorization': `Bearer ${this.sessionToken}`,
          'Content-Type': 'application/json'
        }
      })
      .then(() => {
        flashpoint.log.debug(`Event: ${JSON.stringify(data)}`);
      })
      .catch((err) => { flashpoint.log.error(`Failed to send event - Error: ${err.toString()} - Data: \n` + JSON.stringify(data))});
    }
  }
}
