
export default {
  site: "xiaohongshu",
  name: "publish_video",
  description: "发布小红书视频笔记",
  columns: ["status", "url"],
  args: {
    title: { type: "string", default: "" },
    content: { type: "string", default: "" },
    video: { type: "string", description: "视频文件绝对路径 (.mp4/.mov)" },
  },

  async run(page, args) {
    if (!args.video) return [{ status: "error: missing video path", url: "" }];

    // XHS title limit: 20 chars
    const title = (args.title || "").substring(0, 20);

    // Navigate to publish page — default is video upload tab
    await page.nav("https://creator.xiaohongshu.com/publish/publish");
    await page.waitFor("input.upload-input", 10000);

    // Ensure "上传视频" tab is active (it's the default, but click to be safe)
    await page.eval(() => {
      const tab = Array.from(document.querySelectorAll("span.title"))
        .find(e => e.textContent?.trim() === "上传视频");
      tab?.click();
    });
    await page.wait(500);

    // Upload video
    await page.upload("input.upload-input", args.video);

    // Wait for video processing — upload + transcode takes longer than images
    // Poll for title input to become visible (signals upload accepted)
    await page.waitFor('input.d-text', 15000);

    // Wait for upload to finish: poll until progress disappears or reaches 100%
    for (let i = 0; i < 120; i++) {
      const done = await page.eval(() => {
        const text = document.body.innerText;
        // Upload complete when no "上传中" or progress percentage visible
        if (text.includes("上传完成") || text.includes("100%")) return true;
        if (!text.includes("上传中") && !text.includes("MB/s") && !text.match(/\d+%/)) return true;
        return false;
      });
      if (done) break;
      await page.wait(2000);
    }

    // Wait for network to settle after upload
    await page.waitForNetwork(15000, 3000);

    // Fill title — React controlled input, use native setter
    if (title) {
      await page.eval((t) => {
        const input = document.querySelector("input.d-text");
        input?.focus();
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
        setter.call(input, t);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }, title);
      await page.wait(300);
    }

    // Fill content
    if (args.content) {
      await page.eval((text) => {
        const editor = document.querySelector("[contenteditable='true'], .tiptap.ProseMirror, .ql-editor");
        if (editor) {
          editor.focus();
          document.execCommand("selectAll");
          document.execCommand("insertText", false, text);
        }
      }, args.content);
      await page.wait(300);
    }

    // Monitor toasts for validation errors
    await page.eval(() => {
      window.__tapToast = [];
      window.__tapToastObserver = new MutationObserver(ms => {
        for (const m of ms) for (const n of m.addedNodes)
          if (n.nodeType === 1 && n.innerText?.trim())
            window.__tapToast.push(n.innerText.trim().substring(0, 100));
      });
      window.__tapToastObserver.observe(document.body, { childList: true, subtree: true });
    });

    // Click publish
    await page.eval(() => {
      const btn = Array.from(document.querySelectorAll("button"))
        .find(e => e.innerText?.trim() === "发布");
      btn?.click();
    });

    // Wait for result — success page or toast error
    let published = false;
    for (let i = 0; i < 30; i++) {
      await page.wait(500);
      const state = await page.eval(() => {
        const url = location.href;
        const toast = (window.__tapToast || [])
          .find(t => t.includes("错误") || t.includes("失败") || t.includes("请"));
        return { url, toast: toast || null };
      });
      if (state.toast) return [{ status: "error: " + state.toast, url: state.url }];
      if (state.url.includes("published=true") || state.url.includes("/publish/success")) {
        published = true;
        break;
      }
    }

    return [{ status: published ? "published" : "check-browser", url: await page.eval(() => location.href) }];
  }
};
