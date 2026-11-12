import net from "node:net";

const LOOPBACK = "127.0.0.1";
const urspruenglich = net.Server.prototype.listen;

net.Server.prototype.listen = function listenNurLoopback(...args) {
  if (typeof args[0] !== "number") return urspruenglich.apply(this, args);
  const rueckrufe = args.filter((arg) => typeof arg === "function");
  return urspruenglich.call(this, args[0], LOOPBACK, ...rueckrufe);
};
