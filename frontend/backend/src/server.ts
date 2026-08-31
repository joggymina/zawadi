import { createApp } from "./app";
import { env } from "./config/env";
import { scheduleDailyAccrual } from "./jobs/dailyAccrual.job";

const app = createApp();

app.listen(env.PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Zawadi API listening on :${env.PORT} (${env.NODE_ENV})`);
});

// See the comment in dailyAccrual.job.ts — fine for early development,
// but move this to a dedicated worker before running more than one API
// instance, or interest will be accrued once per instance per day.
scheduleDailyAccrual();
