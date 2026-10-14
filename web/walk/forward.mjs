// A tiny TCP forwarder. The development sign-in (POST /auth/dev) only works when the request's Host is the loopback APP_URL
// (http://localhost:<port>), so inside a Job the browser must really be talking to localhost:<port>. This listens there and passes
// the bytes on to the environment's Service, so the browser sees the address the application expects.
import net from "node:net";

/**
 * @param {number} listenPort port on 127.0.0.1 (0 picks one) @param {string} host the target's host @param {number} port the target's port
 * @returns {Promise<net.Server>} the listening server
 */
export function startForwarder(listenPort, host, port) {
  const server = net.createServer((client) => {
    const upstream = net.connect(port, host);
    const close = () => {
      client.destroy();
      upstream.destroy();
    };
    client.on("error", close);
    upstream.on("error", close);
    client.on("close", close);
    upstream.on("close", close);
    client.pipe(upstream);
    upstream.pipe(client);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(listenPort, "127.0.0.1", () => resolve(server));
  });
}
