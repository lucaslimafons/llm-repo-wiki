import { db } from "@/db/client";
import { searchKnowledge } from "@/search";
import { wikiStore } from "@/wiki/store";
import type { ChatDeps } from "./chat";
import { authorModel, chatModel, toolApprovalSecret } from "./models";

/** The production wiring of the chat route; tests build ChatDeps from fakes instead. */
export function chatDeps(): ChatDeps {
  return {
    db: db(),
    store: wikiStore,
    search: searchKnowledge,
    model: chatModel(),
    summaryModel: authorModel(),
    approvalSecret: toolApprovalSecret(),
  };
}
