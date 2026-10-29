import { db } from "@/db/client";
import { searchKnowledge } from "@/search";
import { wikiStore } from "@/wiki/store";
import type { ChatDeps } from "./chat";
import { authorModel, chatModel, toolApprovalSecret } from "./models";

/** The production wiring of the chat route for one wiki; tests build ChatDeps from fakes instead. */
export function chatDeps({ id: wikiId, slug }: { id: string; slug: string }): ChatDeps {
  return {
    db: db(),
    wikiId,
    wikiSlug: slug,
    store: wikiStore(wikiId),
    search: (input) => searchKnowledge({ ...input, wikiId }),
    model: chatModel(),
    summaryModel: authorModel(),
    approvalSecret: toolApprovalSecret(),
  };
}
