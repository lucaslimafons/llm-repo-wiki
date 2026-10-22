import { connection } from "next/server";
import { wikiStore } from "@/wiki/store";

export async function GET() {
  await connection();
  return Response.json(await wikiStore.listProposals());
}
