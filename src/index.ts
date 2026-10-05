import { SERVICE_NAME, VERSION, listenHost, listenPort } from "./config.js";
import { createApp } from "./http.js";

const host = listenHost();
const port = listenPort();
const app = createApp(undefined, { listenHost: host });

app.listen(port, host, () => {
  process.stderr.write(
    `${SERVICE_NAME} ${VERSION} listening on ${host}:${port}\n`,
  );
});
