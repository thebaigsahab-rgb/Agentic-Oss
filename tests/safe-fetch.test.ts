import assert from "node:assert/strict";
import { createServer, type Socket } from "node:net";
import test from "node:test";
import { isNonPublicIpAddress } from "../lib/server/public-address";
import { fetchPinned, fetchPinnedAddress, type PinnedAddress } from "../lib/server/pinned-fetch";

test("network source validation blocks non-public IPv4 address classes", () => {
  for (const address of [
    "0.0.0.0",
    "10.0.0.1",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.0.0.1",
    "192.0.2.1",
    "192.168.0.1",
    "198.18.0.1",
    "198.51.100.1",
    "203.0.113.1",
    "224.0.0.1",
    "255.255.255.255",
  ]) assert.equal(isNonPublicIpAddress(address), true, address);
});

test("network source validation blocks mapped, local, special, and reserved IPv6", () => {
  for (const address of [
    "::",
    "::1",
    "::ffff:127.0.0.1",
    "::ffff:169.254.169.254",
    "::ffff:7f00:1",
    "::ffff:0:7f00:1",
    "fc00::1",
    "fd00::1",
    "fe80::1",
    "fe90::1",
    "febf::1",
    "fec0::1",
    "ff02::1",
    "100::1",
    "2001:db8::1",
    "3fff::1",
    "64:ff9b:1::1",
    "64:ff9b::127.0.0.1",
    "4000::1",
    "8000::1",
  ]) assert.equal(isNonPublicIpAddress(address), true, address);
});

test("network source validation allows ordinary public IP addresses", () => {
  for (const address of [
    "1.1.1.1",
    "8.8.8.8",
    "192.0.0.9",
    "::ffff:8.8.8.8",
    "2606:4700:4700::1111",
    "2001:4860:4860::8888",
    "3fff:1000::1",
    "64:ff9b::8.8.8.8",
  ]) assert.equal(isNonPublicIpAddress(address), false, address);
});

test("network source validation fails closed for malformed addresses", () => {
  for (const address of ["", "not-an-ip", "999.1.1.1", "2001:::1"])
    assert.equal(isNonPublicIpAddress(address), true, address);
});

test("pinned fetch connects to the exact public address returned by validation", async () => {
  let lookupCalls = 0;
  const connectedAddresses: string[] = [];
  const response = await fetchPinned("https://news.example/feed.xml", {}, {
    lookup: async (hostname) => {
      lookupCalls += 1;
      assert.equal(hostname, "news.example");
      return [{ address: "93.184.216.34", family: 4 }];
    },
    fetch: async (url, address) => {
      assert.equal(url.hostname, "news.example");
      connectedAddresses.push(address.address);
      return new Response("ok");
    },
  });

  assert.equal(await response.text(), "ok");
  assert.equal(lookupCalls, 1);
  assert.deepEqual(connectedAddresses, ["93.184.216.34"]);
});

test("pinned fetch cannot re-resolve a validated host to a private address", async () => {
  let lookupCalls = 0;
  const connectedAddresses: string[] = [];
  await fetchPinned("https://rebind.example/feed.xml", {}, {
    lookup: async () => {
      lookupCalls += 1;
      return lookupCalls === 1
        ? [{ address: "93.184.216.34", family: 4 }]
        : [{ address: "127.0.0.1", family: 4 }];
    },
    fetch: async (_url, address) => {
      connectedAddresses.push(address.address);
      return new Response("ok");
    },
  });

  assert.equal(lookupCalls, 1);
  assert.deepEqual(connectedAddresses, ["93.184.216.34"]);
});

test("pinned fetch refuses mixed public and non-public DNS answers before connecting", async () => {
  let connected = false;
  await assert.rejects(fetchPinned("https://mixed.example/feed.xml", {}, {
    lookup: async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ],
    fetch: async () => {
      connected = true;
      return new Response("unexpected");
    },
  }), /Private or non-public network sources are blocked/);
  assert.equal(connected, false);
});

test("pinned fetch reaches a healthy address when the first validated address stalls", async () => {
  const attempted: string[] = [];
  const response = await fetchPinned("https://multi.example/feed.xml", {
    signal: AbortSignal.timeout(1_000),
  }, {
    lookup: async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "1.1.1.1", family: 4 },
    ],
    attemptDelayMs: 1,
    fetch: async (_url, address, init) => {
      attempted.push(address.address);
      if (address.address === "1.1.1.1") return new Response("fallback");
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      });
    },
  });

  assert.equal(await response.text(), "fallback");
  assert.deepEqual(attempted, ["93.184.216.34", "1.1.1.1"]);
});

test("pinned fetch request timeout includes DNS resolution", async () => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException("The operation was aborted due to timeout", "TimeoutError")), 20);
  try {
    await assert.rejects(fetchPinned("https://slow-dns.example/feed.xml", {
      signal: controller.signal,
    }, {
      lookup: async () => new Promise<PinnedAddress[]>((resolve) => {
        controller.signal.addEventListener("abort", () => resolve([]), { once: true });
      }),
      fetch: async () => new Response("unexpected"),
    }), (error: unknown) => error instanceof DOMException && error.name === "TimeoutError");
  } finally {
    clearTimeout(timer);
  }
});

test("the pinned socket transport rejects an invalid upstream status without crashing", async () => {
  let connection: Socket | undefined;
  const server = createServer((socket) => {
    connection = socket;
    socket.end("HTTP/1.1 700 Invalid\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    await assert.rejects(fetchPinnedAddress(
      new URL(`http://source.example:${address.port}/feed.xml`),
      { address: "127.0.0.1", family: 4 },
      { signal: AbortSignal.timeout(1_000) },
    ), /invalid HTTP status \(700\)/);
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      connection?.destroy();
    });
  }
});
