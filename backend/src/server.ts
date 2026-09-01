import { createApp } from "./app";
import { env } from "./config/env";
import { scheduleDailyAccrual, runDailyAccrual } from "./jobs/dailyAccrual.job";

const app = createApp();

app.listen(env.PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Zawadi API listening on :${env.PORT} (${env.NODE_ENV})`);
});

scheduleDailyAccrual();

runDailyAccrual().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error("Startup accrual failed:", err);
});