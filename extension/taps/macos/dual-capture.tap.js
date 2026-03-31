/**
 * macos/dual-capture — Capture two app windows into one image.
 * Runtime: macos
 *
 * Uses Swift (CoreGraphics) to find window IDs, screencapture -l to grab
 * each window, magick to composite. Works across Spaces.
 *
 *   tap --runtime macos macos dual-capture --app1 "Google Chrome" --app2 Kaku
 */
export default {
  site: "macos",
  name: "dual-capture",
  runtime: "macos",
  description: "Capture two app windows side-by-side into one image",
  columns: ["file", "apps", "size"],
  args: {
    app1: { type: "string", default: "Google Chrome", description: "First app name" },
    app2: { type: "string", default: "Kaku", description: "Second app name" },
    layout: { type: "string", default: "side", description: "side (left-right) or stack (top-bottom)" },
  },

  async run(page, args) {
    const app1 = args.app1 || "Google Chrome";
    const app2 = args.app2 || "Kaku";
    const layout = args.layout || "side";
    const ts = Date.now();
    const tmp1 = `/tmp/dual-a-${ts}.png`;
    const tmp2 = `/tmp/dual-b-${ts}.png`;
    const file = `/tmp/dual-capture-${ts}.png`;

    // Use Swift to find largest window ID for each app
    const swiftCode = `
import CoreGraphics
import Foundation
let args = CommandLine.arguments
let app1 = args[1], app2 = args[2]
guard let infoList = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as? [[String: Any]] else { exit(1) }
func findWid(_ app: String) -> Int? {
    var best: Int? = nil; var bestArea: Double = 0
    for w in infoList {
        guard let owner = w["kCGWindowOwnerName"] as? String,
              let wid = w["kCGWindowNumber"] as? Int,
              let b = w["kCGWindowBounds"] as? [String: Double],
              let width = b["Width"], let height = b["Height"],
              width > 100, height > 100 else { continue }
        if owner.contains(app) || app.contains(owner) {
            let area = width * height
            if area > bestArea { bestArea = area; best = wid }
        }
    }
    return best
}
guard let id1 = findWid(app1), let id2 = findWid(app2) else {
    print("NOT_FOUND"); exit(0)
}
print("\\(id1) \\(id2)")
`.replace(/\n/g, "\\n");

    // Find window IDs via Swift
    const idsStr = await page.eval(`
      var app = Application.currentApplication();
      app.includeStandardAdditions = true;
      var swiftSrc = ${JSON.stringify(swiftCode.replace(/\\n/g, "\n"))};
      // Write swift source to temp file and compile+run
      app.doShellScript("cat > /tmp/_dualcap.swift << 'SWIFTEOF'\\n" + swiftSrc + "\\nSWIFTEOF");
      app.doShellScript("swift /tmp/_dualcap.swift " + ${JSON.stringify(app1)} + " " + ${JSON.stringify(app2)});
    `);

    if (!idsStr || idsStr === "NOT_FOUND") {
      throw new Error("Window not found for: " + app1 + " or " + app2);
    }

    const [id1, id2] = idsStr.trim().split(" ");

    // Capture both windows + composite
    const op = layout === "stack" ? "-append" : "+append";
    await page.eval(`
      var app = Application.currentApplication();
      app.includeStandardAdditions = true;
      app.doShellScript("screencapture -x -o -l ${id1} ${tmp1} && screencapture -x -o -l ${id2} ${tmp2}");
      app.doShellScript("/opt/homebrew/bin/magick ${tmp1} ${tmp2} ${op} ${file}");
      app.doShellScript("rm -f ${tmp1} ${tmp2}");
      "done";
    `);

    // File size
    const sizeStr = await page.eval(`
      var app = Application.currentApplication();
      app.includeStandardAdditions = true;
      app.doShellScript("stat -f '%z' ${file}");
    `);
    const bytes = parseInt(sizeStr) || 0;
    const sizeMB = (bytes / 1024 / 1024).toFixed(1) + " MB";

    return [{ file, apps: `${app1} + ${app2}`, size: sizeMB }];
  },
};
