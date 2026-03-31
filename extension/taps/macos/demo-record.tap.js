/**
 * macos/demo-record — Record a Tap demo GIF by automating Terminal commands.
 * Runtime: macos
 *
 * Opens a NEW Terminal window for the demo, starts screen recording,
 * runs commands sequentially, stops recording, converts to GIF.
 *
 *   tap --runtime macos macos demo-record
 *   tap --runtime macos macos demo-record --commands "tap hackernews hot --limit 5"
 *   tap --runtime macos macos demo-record --pause 3000
 */
export default {
  site: "macos",
  name: "demo-record",
  runtime: "macos",
  description: "Record a Tap demo GIF: automate Terminal + screen capture + ffmpeg",
  columns: ["mov", "gif", "status", "commands_run"],
  args: {
    commands: {
      type: "string",
      default: "tap hackernews hot --limit 5,tap douban hot --limit 5",
      description: "Comma-separated commands to run in Terminal",
    },
    pause: { type: "int", default: 3000, description: "ms to display output after command finishes" },
    timeout: { type: "int", default: 30000, description: "max ms to wait for a command to finish" },
    width: { type: "int", default: 800, description: "GIF width in pixels" },
    fps: { type: "int", default: 15, description: "GIF frames per second" },
  },

  async run(page, args) {
    const commands = (args.commands || "tap hackernews hot --limit 5")
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean);
    const pause = args.pause || 3000;
    const timeout = args.timeout || 30000;
    const width = args.width || 800;
    const fps = args.fps || 15;

    const sh = (cmd) => page.eval(`
      var app = Application.currentApplication();
      app.includeStandardAdditions = true;
      app.doShellScript(${JSON.stringify(cmd)});
    `);

    // --- 1. Open a NEW Terminal window for demo (separate from tap's own window) ---
    // Count windows before, open new one, identify it
    const windowCount = await page.eval(`
      var term = Application("Terminal");
      term.activate();
      var before = term.windows.length;
      term.doScript("clear");
      delay(0.5);
      term.windows.length;
    `);

    // The new window is windows[0] (frontmost)
    // Give it a moment to render
    await page.wait(1000);

    // --- 2. Start screen recording ---
    await page.tap("macos", "screen-record");
    await page.wait(1500);

    // --- 3. Bring demo window to front ---
    await page.eval(`
      var term = Application("Terminal");
      term.activate();
      // Raise the demo window (index 0 = frontmost)
      term.windows[0].index = 1;
    `);
    await page.wait(500);

    // --- 4. Execute each command, wait for completion, then pause ---
    for (let i = 0; i < commands.length; i++) {
      const cmd = commands[i];

      // Run command in the demo window (windows[0] = frontmost)
      await page.eval(`
        var term = Application("Terminal");
        term.activate();
        term.doScript(${JSON.stringify(cmd)}, { in: term.windows[0] });
      `);

      // Wait for command to finish by polling Terminal.busy
      const start = Date.now();
      await page.wait(500);
      while (Date.now() - start < timeout) {
        const busy = await page.eval(`
          var term = Application("Terminal");
          term.windows[0].tabs[0].busy();
        `);
        if (!busy) break;
        await page.wait(1000);
      }

      // Re-activate after polling
      await page.eval(`Application("Terminal").activate()`);

      // Readable pause so viewer can see the output
      await page.wait(pause);
    }

    // --- 5. Final pause ---
    await page.wait(3000);

    // --- 6. Stop recording ---
    const result = await page.tap("macos", "screen-record", { stop: true });
    const mov = result[0]?.file || "";
    if (!mov) return [{ mov: "", gif: "", status: "no recording", commands_run: "0" }];

    // --- 7. Close the demo window ---
    try {
      await page.eval(`
        var term = Application("Terminal");
        if (term.windows.length > 1) term.windows[0].close();
      `);
    } catch (_) {}

    // --- 8. Convert .mov → .gif ---
    const gif = mov.replace(/\.mov$/, ".gif");
    try {
      await sh(
        `/opt/homebrew/bin/ffmpeg -i ${mov} ` +
        `-vf "fps=${fps},scale=${width}:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" ` +
        `-loop 0 -y ${gif} 2>&1`
      );
    } catch (e) {
      return [{ mov, gif: "", status: "mov ok, gif conversion failed: " + e.message, commands_run: String(commands.length) }];
    }

    const sizeMB = await sh(`stat -f '%z' ${gif}`);
    const mb = ((parseInt(sizeMB) || 0) / 1024 / 1024).toFixed(1);

    return [{ mov, gif: `${gif} (${mb} MB)`, status: "done", commands_run: String(commands.length) }];
  },
};
