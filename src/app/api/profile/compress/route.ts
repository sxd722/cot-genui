import { NextResponse } from "next/server";
import { compressProfile } from "@/lib/profile";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { deviceContext?: unknown };
    if (!body.deviceContext || typeof body.deviceContext !== "object" || Array.isArray(body.deviceContext)) {
      return NextResponse.json({ error: "缺少合法 deviceContext" }, { status: 400 });
    }
    const result = await compressProfile(body.deviceContext as Record<string, unknown>);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "画像压缩失败" }, { status: 500 });
  }
}
