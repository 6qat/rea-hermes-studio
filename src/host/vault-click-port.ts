export type ClickDisposition = "handled" | "forward";

export interface VaultClickReply {
  type: "paths";
  known: Record<string, boolean>;
}

export interface VaultClickResolution {
  disposition: ClickDisposition;
  reply?: VaultClickReply;
}

export interface VaultClickRouter {
  isPathKnown(path: string): boolean;
  routeUri(
    filePathOrLink: string,
    options?: { selection?: { startLine: number; endLine: number } },
  ): Promise<boolean>;
}

function isVaultNavigationHref(href: string): boolean {
  return (
    href.startsWith("obsidian://") ||
    href.startsWith("file://") ||
    href.startsWith("wikilink://") ||
    !/^[a-z]+:\/\//i.test(href)
  );
}

export async function resolveVaultClick(
  msg: any,
  router: VaultClickRouter,
): Promise<VaultClickResolution> {
  if (msg?.type === "checkPaths" && Array.isArray(msg.paths)) {
    const known: Record<string, boolean> = {};
    for (const p of msg.paths) {
      if (typeof p === "string") known[p] = router.isPathKnown(p);
    }
    return { disposition: "handled", reply: { type: "paths", known } };
  }

  if (msg?.type === "openFile" && msg.path) {
    const selection = msg.line ? { startLine: msg.line, endLine: msg.line } : undefined;
    const opened = await router.routeUri(msg.path, selection ? { selection } : undefined);
    if (opened) return { disposition: "handled" };
    return { disposition: "forward" };
  }

  if (msg?.type === "openLink" && msg.href) {
    if (isVaultNavigationHref(msg.href)) {
      const opened = await router.routeUri(msg.href);
      if (opened) return { disposition: "handled" };
    }
    return { disposition: "forward" };
  }

  return { disposition: "forward" };
}
