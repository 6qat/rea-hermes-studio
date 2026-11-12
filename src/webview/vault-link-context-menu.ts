export interface VaultLinkOpenMessage {
  type: "openLink";
  href: string;
  newTab: true;
}

const MENU_CLASS = "hermes-vault-link-menu";

function isVaultNavigationHref(href: string): boolean {
  return (
    href.startsWith("obsidian://") ||
    href.startsWith("file://") ||
    href.startsWith("wikilink://") ||
    !/^[a-z][a-z0-9+.-]*:/i.test(href)
  );
}

function closestVaultLink(root: HTMLElement, target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const link = target.closest<HTMLElement>("[data-href]");
  if (!link || !root.contains(link)) return null;
  const href = link.dataset.href ?? "";
  return href && isVaultNavigationHref(href) ? link : null;
}

export function attachVaultLinkContextMenu(
  root: HTMLElement,
  postMessage: (msg: VaultLinkOpenMessage) => void,
): () => void {
  const doc = root.ownerDocument;
  let menu: HTMLElement | null = null;

  const close = () => {
    menu?.remove();
    menu = null;
  };

  const onContextMenu = (event: Event) => {
    const mouse = event as MouseEvent;
    const link = closestVaultLink(root, mouse.target);
    if (!link) return;
    mouse.preventDefault();
    close();

    menu = doc.createElement("div");
    menu.className = MENU_CLASS;
    menu.style.left = `${mouse.clientX}px`;
    menu.style.top = `${mouse.clientY}px`;
    const item = doc.createElement("button");
    item.type = "button";
    item.textContent = "Open in new tab";
    item.addEventListener("click", () => {
      postMessage({ type: "openLink", href: link.dataset.href ?? "", newTab: true });
      close();
    });
    menu.append(item);
    root.append(menu);
  };

  const onPointerDown = (event: Event) => {
    if (!menu || !(event.target instanceof Node) || menu.contains(event.target)) return;
    close();
  };

  const onKeyDown = (event: Event) => {
    if ((event as KeyboardEvent).key === "Escape") close();
  };

  root.addEventListener("contextmenu", onContextMenu);
  root.addEventListener("pointerdown", onPointerDown);
  root.addEventListener("scroll", close, true);
  doc.addEventListener("keydown", onKeyDown);

  if (!doc.getElementById("hermes-vault-link-menu-style")) {
    const style = doc.createElement("style");
    style.id = "hermes-vault-link-menu-style";
    style.textContent = `
      .${MENU_CLASS} {
        position: fixed;
        z-index: 50;
        min-width: 11rem;
        padding: 4px;
        border: 1px solid var(--vscode-editorWidget-border, #334155);
        border-radius: 6px;
        background: var(--vscode-editorWidget-background, #1e293b);
        box-shadow: var(--vscode-widget-shadow, rgba(0, 0, 0, 0.45));
      }
      .${MENU_CLASS} button {
        display: block;
        width: 100%;
        padding: 4px 8px;
        border: 0;
        border-radius: 4px;
        background: transparent;
        color: var(--vscode-foreground, #e2e8f0);
        font: inherit;
        text-align: left;
        cursor: pointer;
      }
      .${MENU_CLASS} button:hover {
        background: var(--vscode-list-hoverBackground, rgba(255, 255, 255, 0.08));
      }
    `;
    (root.getRootNode() instanceof ShadowRoot ? root.getRootNode() : doc.head).appendChild(style);
  }

  return () => {
    close();
    root.removeEventListener("contextmenu", onContextMenu);
    root.removeEventListener("pointerdown", onPointerDown);
    root.removeEventListener("scroll", close, true);
    doc.removeEventListener("keydown", onKeyDown);
  };
}
