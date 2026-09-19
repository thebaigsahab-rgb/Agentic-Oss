import { NextResponse, type NextRequest } from "next/server";

const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function isAllowedHost(value: string) {
  try {
    const parsed = new URL(value);
    const hostname = parsed.hostname.toLowerCase();
    if (loopbackHosts.has(hostname)) return true;

    const parts = hostname.split(".").map(Number);
    if (parts.length === 4 && parts.every((p) => !isNaN(p) && p >= 0 && p <= 255)) {
      if (parts[0] === 127) return true;
      if (parts[0] === 10) return true;
      if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
      if (parts[0] === 192 && parts[1] === 168) return true;
      if (parts[0] === 169 && parts[1] === 254) return true;
      if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;
    }

    if (hostname === "::1" || hostname.startsWith("fe80:") || hostname.startsWith("fc") || hostname.startsWith("fd")) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

function isSameOrigin(value: string, request: NextRequest) {
  try {
    const requestUrl = new URL(request.url);
    requestUrl.host = request.headers.get("host") || requestUrl.host;
    return new URL(value).origin === requestUrl.origin;
  } catch {
    return false;
  }
}

export function proxy(request: NextRequest) {
  try {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/webhooks/")) {
      return NextResponse.next();
    }
  } catch {
    // continue to default checks
  }

  const host = request.headers.get("host") || "";
  if (!isAllowedHost(`http://${host}`)) {
    return NextResponse.json(
      { error: "Control Center only accepts requests from this computer or local network." },
      { status: 403 },
    );
  }
  const origin = request.headers.get("origin");
  if (origin && !isSameOrigin(origin, request)) {
    return NextResponse.json(
      { error: "Cross-site requests are blocked." },
      { status: 403 },
    );
  }
  return NextResponse.next();
}

export const config = { matcher: "/api/:path*" };
