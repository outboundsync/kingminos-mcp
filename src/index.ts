import { listenPort, SERVICE_NAME, VERSION } from "./config.js";
import { createApp } from "./http.js";

const app = createApp();
const port = listenPort();

app.listen(port, () => {
  process.stderr.write(`${SERVICE_NAME} ${VERSION} listening on :${port}\n`);
});
