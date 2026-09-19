import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { proxy } from "../proxy";

function apiRequest(origin?: string) {
  return new NextRequest("http://127.0.0.1:3000/api/brief", {
    headers: {
      host: "127.0.0.1:3000",
      ...(origin ? { origin } : {}),
    },
  });
}

test("proxy allows browser requests only from the exact API origin", () => {
  assert.equal(proxy(apiRequest("http://127.0.0.1:3000")).status, 200);
  assert.equal(proxy(apiRequest("http://127.0.0.1:3001")).status, 403);
  assert.equal(proxy(apiRequest("http://localhost:3000")).status, 403);
  assert.equal(proxy(apiRequest("https://127.0.0.1:3000")).status, 403);
});

test("proxy allows local CLI requests without an Origin header", () => {
  assert.equal(proxy(apiRequest()).status, 200);
});

test("proxy allows LAN IP origins and blocks untrusted public hosts", () => {
  const lanReq = new NextRequest("http://192.168.0.36:3000/api/system", {
    headers: {
      host: "192.168.0.36:3000",
      origin: "http://192.168.0.36:3000",
    },
  });
  assert.equal(proxy(lanReq).status, 200);

  const publicReq = new NextRequest("http://93.184.216.34:3000/api/system", {
    headers: {
      host: "93.184.216.34:3000",
      origin: "http://93.184.216.34:3000",
    },
  });
  assert.equal(proxy(publicReq).status, 403);
});
