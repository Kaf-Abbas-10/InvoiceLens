import { NextResponse, type NextRequest } from "next/server";

const API_URL = process.env.INVOICELENS_API_URL ?? "http://127.0.0.1:8200";

// Everything the engine serves (extraction API, samples, original PDFs, OpenAPI docs) is
// forwarded to the Python backend.
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const headers = new Headers(request.headers);
  headers.set("ngrok-skip-browser-warning", "1");
  return NextResponse.rewrite(new URL(`${pathname}${search}`, API_URL), { request: { headers } });
}

export const config = {
  matcher: ["/api/:path*", "/docs", "/openapi.json"],
};
