import { NextResponse } from "next/server";
import { compressFreeText } from "@/lib/profile";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { freeText?: unknown };
    if (typeof body.freeText !== "string" || body.freeText.trim().length < 10) {
      return NextResponse.json({ error: "缺少 freeText（至少 10 字符）" }, { status: 400 });
    }
    const result = await compressFreeText(body.freeText);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "画像压缩失败" }, { status: 500 });
  }
}
