import { createApp } from './app';
import { config } from './config';
import { redisStore } from './redisStore';

redisStore?.connect();

const app = createApp();
app.listen(config.port, () => {
  console.log(`WikiGovTool backend listening on port ${config.port}`);
});
