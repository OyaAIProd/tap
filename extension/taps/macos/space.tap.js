/**
 * macos/space — Get or switch macOS Desktop (Space).
 * Runtime: macos
 *
 * Atomic tap: returns current Space ID, optionally switches first.
 * Uses private CGSGetActiveSpace API compiled to a fast native binary.
 *
 *   tap --runtime macos macos space                # get current
 *   tap --runtime macos macos space --switch 1     # switch to Desktop 1
 */
export default {
  site: "macos",
  name: "space",
  runtime: "macos",
  description: "Get or switch macOS Desktop (Space)",
  columns: ["space_id", "switched"],
  args: {
    switch: { type: "int", default: 0, description: "Switch to Desktop N (0=stay)" },
  },

  async run(page, args) {
    const target = args.switch || 0;

    // Ensure the space-id binary exists (compile once, reuse)
    await page.eval(`
      var app = Application.currentApplication();
      app.includeStandardAdditions = true;
      try { app.doShellScript("test -x /tmp/tap-space-id"); } catch(e) {
        app.doShellScript("cat > /tmp/tap-space-id.swift << 'EOF'\\nimport CoreGraphics\\ntypealias CGSConnectionID = Int32\\n@_silgen_name(\\"CGSMainConnectionID\\") func CGSMainConnectionID() -> CGSConnectionID\\n@_silgen_name(\\"CGSGetActiveSpace\\") func CGSGetActiveSpace(_ cid: CGSConnectionID) -> Int\\nprint(CGSGetActiveSpace(CGSMainConnectionID()))\\nEOF");
        app.doShellScript("swiftc -O /tmp/tap-space-id.swift -o /tmp/tap-space-id 2>/dev/null");
      }
    `);

    // Switch if requested
    let switched = false;
    if (target > 0) {
      const keyCodes = [18, 19, 20, 21, 23, 22, 26, 28, 25];
      const kc = keyCodes[target - 1];
      if (kc) {
        await page.eval(`
          ObjC.import('CoreGraphics');
          var down = $.CGEventCreateKeyboardEvent(null, ${kc}, true);
          $.CGEventSetFlags(down, $.kCGEventFlagMaskControl);
          $.CGEventPost($.kCGHIDEventTap, down);
          var up = $.CGEventCreateKeyboardEvent(null, ${kc}, false);
          $.CGEventSetFlags(up, $.kCGEventFlagMaskControl);
          $.CGEventPost($.kCGHIDEventTap, up);
          "ok";
        `);
        await page.wait(800);
        switched = true;
      }
    }

    // Read current Space ID
    const spaceId = await page.eval(`
      var app = Application.currentApplication();
      app.includeStandardAdditions = true;
      app.doShellScript("/tmp/tap-space-id");
    `);

    return [{ space_id: spaceId, switched: switched ? String(target) : "no" }];
  },
};
