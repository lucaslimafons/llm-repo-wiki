import { Suspense } from "react";
import { PageFallback } from "@/app/(wiki)/fallback";
import { ExplainView } from "@/components/viz/ExplainView";

async function ExplainPageContent({ searchParams }: Pick<PageProps<"/explain">, "searchParams">) {
  const { q } = await searchParams;
  const query = typeof q === "string" ? q.slice(0, 500) : "";
  return <ExplainView key={query} initialQuery={query} />;
}

export default function ExplainPage({ searchParams }: PageProps<"/explain">) {
  return (
    <Suspense fallback={<PageFallback />}>
      <ExplainPageContent searchParams={searchParams} />
    </Suspense>
  );
}
