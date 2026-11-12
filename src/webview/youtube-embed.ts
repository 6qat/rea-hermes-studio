const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const IFRAME_RE = /^<iframe\b([^>]*)>(?:\s*<\/iframe>)?\s*$/i;
const SRC_RE = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i;

function bareHost(host: string): string {
  return host.replace(/^(?:www|m|mobile)\./i, "").toLowerCase();
}

function startSeconds(value: string | null): number | undefined {
  if (!value) return undefined;
  if (/^\d+$/.test(value)) {
    const seconds = Number(value);
    return seconds > 0 ? seconds : undefined;
  }
  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(value);
  if (!match?.[0]) return undefined;
  const seconds = Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0);
  return seconds > 0 ? seconds : undefined;
}

function videoId(url: URL): string {
  const host = bareHost(url.hostname);
  const segments = url.pathname.split("/").filter(Boolean);
  if (host === "youtu.be") return segments[0] ?? "";
  if (host !== "youtube.com" && host !== "youtube-nocookie.com") return "";
  if (segments[0] === "watch") return url.searchParams.get("v") ?? "";
  if (segments[0] && ["embed", "shorts", "live", "v"].includes(segments[0])) {
    return segments[1] ?? "";
  }
  return "";
}

export function youtubeEmbedHtml(href: string): string | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const id = videoId(url);
  if (!YOUTUBE_ID_RE.test(id)) return null;
  if (
    bareHost(url.hostname) === "youtu.be" &&
    url.pathname.split("/").filter(Boolean).length !== 1
  ) {
    return null;
  }

  const params = new URLSearchParams({ modestbranding: "1", rel: "0" });
  const start = startSeconds(url.searchParams.get("t") ?? url.searchParams.get("start"));
  if (start) params.set("start", String(start));
  const src = `https://www.youtube-nocookie.com/embed/${id}?${params.toString()}`;
  return `<div class="yt-embed"><iframe src="${src}" title="YouTube video" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>`;
}

export function youtubeEmbedFromHtml(raw: string): string | null {
  const trimmed = raw.trim();
  if (/<script/i.test(trimmed)) return null;
  const iframe = IFRAME_RE.exec(trimmed);
  if (!iframe) return null;
  const srcMatch = SRC_RE.exec(iframe[1] ?? "");
  const src = (srcMatch?.[1] ?? srcMatch?.[2] ?? "").replace(/&amp;/g, "&");
  if (!src) return null;
  return youtubeEmbedHtml(src);
}
