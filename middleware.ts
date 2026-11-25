import { NextRequest, NextResponse } from "next/server";
import { isSameOriginWrite, validBasicCredential } from "./lib/migration-access";

export async function middleware(request: NextRequest) {
  if (request.nextUrl.pathname === "/api/health" && request.method === "GET") {
    return NextResponse.next();
  }
  const expectedHash = process.env.MIGRATION_ACCESS_CREDENTIAL_SHA256 || "";
  if (process.env.MIGRATION_ACCESS_ENABLED !== "1" && !expectedHash) return NextResponse.next();
  if (!/^[a-f0-9]{64}$/i.test(expectedHash)) {
    return new NextResponse("Access is not configured", { status: 503 });
  }
  if (!(await validBasicCredential(request.headers.get("authorization"), expectedHash))) {
    return new NextResponse("Authentication required", {
      status: 401,
      headers: {
        "WWW-Authenticate": 'Basic realm="Migration Review", charset="UTF-8"',
        "Cache-Control": "no-store",
      },
    });
  }
  if (!isSameOriginWrite(request.method, request.headers.get("origin"), request.headers.get("host"))) {
    return new NextResponse("Forbidden origin", { status: 403 });
  }
  const response = NextResponse.next();
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = { matcher: "/:path*" };
