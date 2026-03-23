import { NextRequest, NextResponse } from "next/server";
import { getContentBySlug } from "@/lib/content";

export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get("slug");
  if (!slug) {
    return NextResponse.json({ error: "Missing slug" }, { status: 400 });
  }

  const content = getContentBySlug(slug);
  if (!content) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(content);
}
