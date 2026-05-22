// Password gate removed — middleware is a no-op pass-through.
// The matcher is left in place but every request just continues.

import { NextResponse } from "next/server";

export function middleware() {
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|_next/data|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|gif|ico|js|css|woff|woff2|ttf|map)$).*)",
  ],
};
