import { BookOpen } from "lucide-react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { wikiStore } from "@/wiki/store";
import { wikiRoute } from "@/wiki/routes";
import { Suspense } from "react";
import { PageFallback } from "@/app/(wiki)/fallback";

/** Wiki home: the first root page (first entry of the root .order), or how to get one. */
async function HomePageContent() {
  await connection();
  const [first] = await wikiStore.listTree();
  if (first) redirect(wikiRoute(first.path));
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center px-8 py-24 text-center">
      <BookOpen className="mb-4 size-10 text-muted" />
      <h1 className="text-2xl font-semibold">Your wiki is empty</h1>
      <p className="mt-2 text-muted">
        Add a GitHub repository in the sidebar. Once it syncs, the agent proposes an outline and pages, which
        show up under Proposals for review. You can also create a page yourself, or ask the chat to write one.
      </p>
    </div>
  );
}

export default function HomePage() {
  return (
    <Suspense fallback={<PageFallback />}>
      <HomePageContent />
    </Suspense>
  );
}
