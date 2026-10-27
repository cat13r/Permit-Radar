import app from "./app";
import { logger } from "./lib/logger";
import { syncChicagoPermits } from "./lib/chicagoPermits";
import { startDailyPermitJobs } from "./lib/dailyDigests";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  void (async () => {
    try {
      await syncChicagoPermits(14);
    } catch (error) {
      logger.error({ err: error }, "Initial Chicago permit import failed");
    }
    startDailyPermitJobs();
  })();
});
