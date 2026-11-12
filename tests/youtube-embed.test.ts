import { describe, expect, it } from "vitest";
import { youtubeEmbedFromHtml, youtubeEmbedHtml } from "../src/webview/youtube-embed";

const ID = "dQw4w9WgXcQ";
const BASE = `https://www.youtube-nocookie.com/embed/${ID}?modestbranding=1&rel=0`;

function iframeSrc(html: string | null): string {
  expect(html).not.toBeNull();
  const match = html!.match(/\bsrc="([^"]*)"/);
  expect(match).toBeTruthy();
  return match![1];
}

describe("youtubeEmbedHtml", () => {
  it.each([
    `https://www.youtube.com/watch?v=${ID}`,
    `https://m.youtube.com/watch?v=${ID}`,
    `https://youtu.be/${ID}`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://www.youtube.com/embed/${ID}`,
    `https://www.youtube.com/live/${ID}`,
    `https://www.youtube.com/v/${ID}`,
    `https://www.youtube-nocookie.com/embed/${ID}`,
  ])("embeds %s", (href) => {
    const html = youtubeEmbedHtml(href);
    expect(html).toContain(`src="${BASE}"`);
    expect(html).toContain('class="yt-embed"');
    expect(html).not.toContain("youtube.com/watch");
    expect(iframeSrc(html)).not.toContain("autoplay=");
  });

  it("maps t and start onto a numeric start parameter", () => {
    expect(youtubeEmbedHtml(`https://www.youtube.com/watch?v=${ID}&t=90`)).toContain(
      `${BASE}&start=90`,
    );
    expect(youtubeEmbedHtml(`https://youtu.be/${ID}?t=1m30s`)).toContain(`${BASE}&start=90`);
    expect(youtubeEmbedHtml(`https://www.youtube.com/watch?v=${ID}&start=1h2m3s`)).toContain(
      `${BASE}&start=3723`,
    );
  });

  it("drops every other query parameter", () => {
    const html = youtubeEmbedHtml(
      `https://www.youtube.com/watch?v=${ID}&autoplay=1&origin=https://evil.test`,
    );
    expect(html).toContain(`src="${BASE}"`);
    expect(html).not.toContain("evil.test");
    expect(iframeSrc(html)).not.toContain("autoplay=");
  });

  it.each([
    "https://example.com/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com/watch?v=short",
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ/extra",
    "https://youtu.be/dQw4w9WgXcQ/extra",
    "javascript:alert(1)",
    "not a url",
    "",
  ])("rejects %s", (href) => {
    expect(youtubeEmbedHtml(href)).toBeNull();
  });
});

describe("youtubeEmbedFromHtml", () => {
  it("rebuilds a single YouTube iframe and drops its original attributes", () => {
    const html = youtubeEmbedFromHtml(
      `<iframe src="https://www.youtube.com/embed/${ID}" width="560" onload="alert(1)"></iframe>`,
    );
    expect(html).toContain(`src="${BASE}"`);
    expect(html).not.toContain("onload");
    expect(html).not.toContain("width=");
  });

  it("decodes an amp entity inside the iframe src", () => {
    const html = youtubeEmbedFromHtml(
      `<iframe src="https://www.youtube.com/embed/${ID}?t=90&amp;rel=1"></iframe>`,
    );
    expect(html).toContain(`${BASE}&start=90`);
    expect(html).not.toContain("rel=1");
  });

  it.each([
    `<iframe src="https://evil.example/"></iframe>`,
    `<iframe src="https://www.youtube.com/embed/${ID}"></iframe><script>alert(1)</script>`,
    `<p>https://www.youtube.com/watch?v=${ID}</p>`,
    `![](https://www.youtube.com/watch?v=${ID})`,
  ])("rejects %s", (raw) => {
    expect(youtubeEmbedFromHtml(raw)).toBeNull();
  });
});
