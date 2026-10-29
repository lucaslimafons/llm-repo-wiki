import { BookOpen } from "lucide-react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { wikiStore } from "@/wiki/store";
import { wikiRoute } from "@/wiki/routes";
import { requireWiki } from "@/wikis/server";
import { Suspense } from "react";
import { PageFallback } from "@/app/w/[wiki]/fallback";

/** Wiki home: the first root page in sort order, or how to get one. */
async function HomePageContent({ params }: Pick<PageProps<"/w/[wiki]">, "params">) {
  await connection();
  const wiki = await requireWiki((await params).wiki);
  const [first] = await wikiStore(wiki.id).listTree();
  if (first) redirect(wikiRoute(wiki.slug, first.path));
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center px-8 py-24 text-center">
      <BookOpen className="mb-4 size-10 text-muted" />
      <h1 className="text-2xl font-semibold">{wiki.name} is empty</h1>
      <p className="mt-2 text-muted">
        Add a GitHub repository in the sidebar. Once it syncs, the agent proposes an outline and pages, which
        show up under Proposals for review. You can also create a page yourself, or ask the chat to write one.
      </p>
    </div>
  );
}

export default function HomePage({ params }: PageProps<"/w/[wiki]">) {
  return (
    <Suspense fallback={<PageFallback />}>
      <HomePageContent params={params} />
    </Suspense>
  );
}
