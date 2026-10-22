import { connection } from "next/server";
import { createChat, listChats } from "@/agent/chat-store";
import { db } from "@/db/client";

export async function GET() {
  await connection();
  return Response.json(await listChats(db()));
}

export async function POST() {
  return Response.json(await createChat(db()), { status: 201 });
}
