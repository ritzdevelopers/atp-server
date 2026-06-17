import dns from "dns";

console.log("Before:", dns.getServers());

dns.setServers(["8.8.8.8", "8.8.4.4"]);

console.log("After:", dns.getServers());

dns.resolveSrv(
  "_mongodb._tcp.cluster0.gj2shd9.mongodb.net",
  (err, data) => {
    console.log("ERR =", err);
    console.log("DATA =", data);
  }
);