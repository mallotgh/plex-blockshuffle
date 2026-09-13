import { config } from './config.js';
import { openDb } from './db.js';
import { buildServer } from './server.js';
import { scheduleBackups } from './services/backup.js';

const db = openDb(config.dataDir);
const app = buildServer({
  db,
  staticDir: config.staticDir,
  secureCookies: config.appBaseUrl.startsWith('https://'),
});

scheduleBackups(db, config.dataDir, {
  info: (m) => app.log.info(m),
  warn: (m) => app.log.warn(m),
});



if (!config.appBaseUrl) {
  app.log.warn('APP_BASE_URL ist nicht gesetzt — der Plex-Login wird fehlschlagen, bis sie konfiguriert ist.');
} else {
  app.log.info(`Basis-URL: ${config.appBaseUrl}`);
}

app
  .listen({ port: config.port, host: config.host })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
