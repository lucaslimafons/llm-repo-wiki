"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  ArrowDown,
  ArrowUp,
  ChevronRight,
  FilePlus,
  GitPullRequestArrow,
  IndentDecrease,
  IndentIncrease,
  ListChecks,
  MoreHorizontal,
  Pencil,
  Plus,
  SearchCode,
  Trash2,
  Workflow,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import type { TreeNode } from "@/core/contracts";
import { useWiki } from "@/components/wikis/WikiContext";
import { queryKeys } from "@/lib/query-keys";
import {
  createPageAction,
  deletePageAction,
  movePageAction,
  renamePageAction,
  type ActionResult,
} from "@/app/w/[wiki]/actions";
import { wikiBase, wikiRoute } from "@/wiki/routes";
import { fetchTree } from "./api";

type Ctx = {
  activePath: string | null;
  collapsed: Set<string>;
  toggle: (id: string) => void;
  menuFor: string | null;
  setMenuFor: (id: string | null) => void;
  renaming: string | null;
  setRenaming: (id: string | null) => void;
  creatingUnder: string | null | undefined;
  setCreatingUnder: (id: string | null | undefined) => void;
  slug: string;
  act: (fn: () => Promise<ActionResult<unknown>>, after?: (data: unknown) => void) => void;
  pending: boolean;
};

function safeDecode(s: string) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** The page path shown in the URL, for /w/<slug>/wiki/… and /w/<slug>/history/… alike. */
function activePathOf(pathname: string): string | null {
  const m = /^\/w\/[^/]+\/(?:wiki|history)\/(.+)$/.exec(pathname);
  return m ? m[1].split("/").map(safeDecode).join("/") : null;
}

export function PageTree({ initialTree, proposalCount }: { initialTree: TreeNode[]; proposalCount: number }) {
  const { slug } = useWiki();
  const base = wikiBase(slug);
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const { data: tree } = useQuery({ queryKey: queryKeys.wiki.tree(slug), queryFn: () => fetchTree(slug), initialData: initialTree });
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [creatingUnder, setCreatingUnder] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async (fn: () => Promise<ActionResult<unknown>>) => {
      const res = await fn();
      if (!res.ok) throw new Error(res.error);
      return res.data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.wiki.all(slug) }),
  });

  const ctx: Ctx = {
    activePath: activePathOf(pathname),
    collapsed,
    toggle: (id) =>
      setCollapsed((prev) => {
        const next = new Set(prev);
        if (!next.delete(id)) next.add(id);
        return next;
      }),
    menuFor,
    setMenuFor,
    renaming,
    setRenaming,
    creatingUnder,
    setCreatingUnder,
    pending: mutation.isPending,
    slug,
    act: (fn, after) => {
      setError(null);
      setMenuFor(null);
      mutation.mutate(fn, { onSuccess: (data) => after?.(data), onError: (e) => setError(e.message) });
    },
  };

  const create = (parentId: string | null, title: string) =>
    ctx.act(
      () => createPageAction({ wiki: slug, parentId, title }),
      (data) => {
        setCreatingUnder(undefined);
        router.push(`${wikiRoute(slug, (data as { path: string }).path)}?edit=1`);
      },
    );

  return (
    <nav className="flex flex-col gap-1 p-2 text-sm" aria-label="Wiki pages">
      <div className="flex items-center justify-between px-2 py-1">
        <span className="text-xs font-medium tracking-wide text-muted uppercase">Pages</span>
        <button
          type="button"
          onClick={() => setCreatingUnder(null)}
          className="rounded p-1 text-muted hover:bg-surface hover:text-foreground"
          title="New page"
          aria-label="New page"
        >
          <FilePlus className="size-4" />
        </button>
      </div>

      {error && (
        <p role="alert" className="mx-2 rounded border border-line bg-surface px-2 py-1 text-xs text-danger">
          {error}
        </p>
      )}

      {tree.length === 0 && creatingUnder === undefined && (
        <p className="px-2 py-1 text-xs text-muted">No pages yet.</p>
      )}
      <ul>
        {tree.map((node, i) => (
          <TreeItem key={node.id} node={node} siblings={tree} index={i} parent={null} grandParentId={null} parentIndex={0} depth={0} ctx={ctx} onCreate={create} />
        ))}
        {creatingUnder === null && (
          <TitleInput depth={0} onSubmit={(t) => create(null, t)} onCancel={() => setCreatingUnder(undefined)} pending={ctx.pending} />
        )}
      </ul>

      <div className="mt-2 flex flex-col border-t border-line pt-2">
        <SideLink href={`${base}/proposals`} pathname={pathname} icon={<GitPullRequestArrow className="size-4" />}>
          Proposals
          {proposalCount > 0 && (
            <span className="ml-auto rounded-full bg-accent px-1.5 text-xs text-accent-foreground">{proposalCount}</span>
          )}
        </SideLink>
        <SideLink href={`${base}/lint`} pathname={pathname} icon={<ListChecks className="size-4" />}>
          Lint
        </SideLink>
        <SideLink href={`${base}/jobs`} pathname={pathname} icon={<Activity className="size-4" />}>
          Jobs
        </SideLink>
        <SideLink href={`${base}/pipeline`} pathname={pathname} icon={<Workflow className="size-4" />}>
          Pipeline
        </SideLink>
        <SideLink href={`${base}/explain`} pathname={pathname} icon={<SearchCode className="size-4" />}>
          How search works
        </SideLink>
      </div>
    </nav>
  );
}

function SideLink({ href, pathname, icon, children }: { href: string; pathname: string; icon: ReactNode; children: ReactNode }) {
  const active = pathname === href;
  return (
    <Link
      href={href}
      className={`flex items-center gap-2 rounded px-2 py-1 ${active ? "bg-surface font-medium text-foreground" : "text-muted hover:bg-surface hover:text-foreground"}`}
    >
      {icon}
      {children}
    </Link>
  );
}

function TreeItem({
  node,
  siblings,
  index,
  parent,
  grandParentId,
  parentIndex,
  depth,
  ctx,
  onCreate,
}: {
  node: TreeNode;
  siblings: TreeNode[];
  index: number;
  parent: TreeNode | null;
  grandParentId: string | null;
  /** The parent's position among its own siblings, for "move out a level". */
  parentIndex: number;
  depth: number;
  ctx: Ctx;
  onCreate: (parentId: string | null, title: string) => void;
}) {
  const router = useRouter();
  const isOpen = !ctx.collapsed.has(node.id) || ctx.creatingUnder === node.id;
  const active = ctx.activePath === node.path;
  const hasChildren = node.children.length > 0;
  const parentId = parent?.id ?? null;
  const pad = { paddingLeft: `${depth * 0.75 + 0.25}rem` };

  if (ctx.renaming === node.id) {
    return (
      <TitleInput
        depth={depth}
        initial={node.title}
        pending={ctx.pending}
        onCancel={() => ctx.setRenaming(null)}
        onSubmit={(title) =>
          ctx.act(
            () => renamePageAction({ wiki: ctx.slug, pageId: node.id, title }),
            (data) => {
              ctx.setRenaming(null);
              if (active) router.replace(wikiRoute(ctx.slug, (data as { path: string }).path));
            },
          )
        }
      />
    );
  }

  const move = (newParentId: string | null, at?: number) =>
    ctx.act(() => movePageAction({ wiki: ctx.slug, pageId: node.id, newParentId, index: at }));

  return (
    <li>
      <div
        className={`group relative flex items-center gap-1 rounded py-0.5 pr-1 ${active ? "bg-surface font-medium text-foreground shadow-sm" : "text-foreground/85 hover:bg-surface"}`}
        style={pad}
      >
        <button
          type="button"
          onClick={() => ctx.toggle(node.id)}
          className={`rounded p-0.5 text-muted hover:text-foreground ${hasChildren ? "" : "invisible"}`}
          aria-label={isOpen ? "Collapse" : "Expand"}
        >
          <ChevronRight className={`size-3.5 transition-transform ${isOpen ? "rotate-90" : ""}`} />
        </button>
        <Link href={wikiRoute(ctx.slug, node.path)} className="min-w-0 flex-1 truncate py-0.5" title={node.path}>
          {node.title}
        </Link>
        {node.hasPendingProposal && (
          <GitPullRequestArrow className="size-3.5 shrink-0 text-accent" aria-label="Pending proposal">
            <title>Pending proposal</title>
          </GitPullRequestArrow>
        )}
        {node.stale && (
          <span className="size-2 shrink-0 rounded-full bg-warning" title="Stale: a cited file changed" aria-label="Stale" />
        )}
        <button
          type="button"
          onClick={() => ctx.setMenuFor(ctx.menuFor === node.id ? null : node.id)}
          className="rounded p-0.5 text-muted opacity-0 group-hover:opacity-100 hover:text-foreground focus:opacity-100"
          aria-label={`Actions for ${node.title}`}
          aria-expanded={ctx.menuFor === node.id}
        >
          <MoreHorizontal className="size-4" />
        </button>
        {ctx.menuFor === node.id && (
          <div
            role="menu"
            className="absolute top-full right-0 z-20 mt-1 w-44 rounded-md border border-line bg-surface py-1 text-sm shadow-lg"
          >
            <MenuItem icon={<Plus />} onClick={() => (ctx.setMenuFor(null), ctx.setCreatingUnder(node.id))}>
              Add child page
            </MenuItem>
            <MenuItem icon={<Pencil />} onClick={() => (ctx.setMenuFor(null), ctx.setRenaming(node.id))}>
              Rename
            </MenuItem>
            <MenuItem icon={<ArrowUp />} disabled={index === 0} onClick={() => move(parentId, index - 1)}>
              Move up
            </MenuItem>
            <MenuItem icon={<ArrowDown />} disabled={index === siblings.length - 1} onClick={() => move(parentId, index + 1)}>
              Move down
            </MenuItem>
            <MenuItem icon={<IndentIncrease />} disabled={index === 0} onClick={() => move(siblings[index - 1]?.id ?? null)}>
              Nest under previous
            </MenuItem>
            <MenuItem icon={<IndentDecrease />} disabled={!parent} onClick={() => move(grandParentId, parentIndex + 1)}>
              Move out a level
            </MenuItem>
            <MenuItem
              icon={<Trash2 />}
              danger
              disabled={hasChildren}
              onClick={() => {
                if (!window.confirm(`Delete "${node.title}" and its history?`)) return ctx.setMenuFor(null);
                ctx.act(
                  () => deletePageAction({ wiki: ctx.slug, pageId: node.id }),
                  () => active && router.push(wikiBase(ctx.slug)),
                );
              }}
            >
              {hasChildren ? "Delete (has children)" : "Delete"}
            </MenuItem>
          </div>
        )}
      </div>
      {isOpen && (hasChildren || ctx.creatingUnder === node.id) && (
        <ul>
          {node.children.map((child, i) => (
            <TreeItem
              key={child.id}
              node={child}
              siblings={node.children}
              index={i}
              parent={node}
              grandParentId={parentId}
              depth={depth + 1}
              parentIndex={index}
              ctx={ctx}
              onCreate={onCreate}
            />
          ))}
          {ctx.creatingUnder === node.id && (
            <TitleInput
              depth={depth + 1}
              pending={ctx.pending}
              onSubmit={(t) => onCreate(node.id, t)}
              onCancel={() => ctx.setCreatingUnder(undefined)}
            />
          )}
        </ul>
      )}
    </li>
  );
}

function MenuItem({
  icon,
  children,
  onClick,
  disabled,
  danger,
}: {
  icon: ReactNode;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40 [&_svg]:size-4 ${danger ? "text-danger" : ""}`}
    >
      {icon}
      {children}
    </button>
  );
}

function TitleInput({
  depth,
  initial = "",
  pending,
  onSubmit,
  onCancel,
}: {
  depth: number;
  initial?: string;
  pending: boolean;
  onSubmit: (title: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <li style={{ paddingLeft: `${depth * 0.75 + 1.4}rem` }} className="py-0.5 pr-1">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) onSubmit(value);
        }}
      >
        <input
          autoFocus
          value={value}
          disabled={pending}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && onCancel()}
          onBlur={() => !pending && value === initial && onCancel()}
          placeholder="Page title"
          aria-label="Page title"
          className="w-full rounded border border-line bg-surface px-2 py-0.5 text-sm outline-none focus:border-accent"
        />
      </form>
    </li>
  );
}
