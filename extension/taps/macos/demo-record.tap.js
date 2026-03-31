/**
 * macos/demo-record — Record a Tap demo GIF by automating Terminal commands.
 * Runtime: macos
 *
 * Opens a NEW Terminal window, starts screen recording, types and runs
 * commands with readable pacing, stops recording, converts to GIF.
 *
 *   tap --runtime macos macos demo-record
 *   tap --runtime macos macos demo-record --commands "tap list,tap github trending --limit 5"
 *   tap --runtime macos macos demo-record --pause 8000
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
      default: "tap github trending --limit 5,tap zhihu hot --limit 3",
      description: "Comma-separated commands to run in Terminal",
    },
    pause: { type: "int", default: 3000, description: "ms to display output after command finishes" },
    timeout: { type: "int", default: 30000, description: "max ms to wait for a command to finish" },
    width: { type: "int", default: 800, description: "GIF width in pixels" },
    fps: { type: "int", default: 15, description: "GIF frames per second" },
  },

  async run(page, args) {
    const commands = (args.commands || "tap github trending --limit 5")
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

    // Poll Terminal.busy until command finishes or timeout
    const waitForIdle = async (maxMs) => {
      const start = Date.now();
      await page.wait(500); // let it start
      while (Date.now() - start < maxMs) {
        const busy = await page.eval(`
          var term = Application("Terminal");
          term.windows[0].tabs[0].busy();
        `);
        if (!busy) return;
        await page.wait(1000);
      }
    };

    // --- 1. Open a fresh Terminal window for the demo ---
    await page.eval(`
      var term = Application("Terminal");
      term.activate();
      term.doScript("clear");
    `);
    await page.wait(1000);

    // --- 2. Start screen recording ---
    await page.tap("macos", "screen-record");
    await page.wait(1500);

    // --- 3. Make sure Terminal is in front ---
    await page.eval(`Application("Terminal").activate()`);
    await page.wait(500);

    // --- 4. Execute each command, wait for completion, then pause ---
    for (let i = 0; i < commands.length; i++) {
      const cmd = commands[i];

      // Run command in the frontmost Terminal window
      await page.eval(`
        var term = Application("Terminal");
        term.doScript(${JSON.stringify(cmd)}, { in: term.windows[0] });
      `);

      // Wait for command to actually finish (poll Terminal.busy)
      await waitForIdle(timeout);

      // Readable pause so viewer can see the output
      await page.wait(pause);
    }

    // --- 5. Final pause to let viewer read last output ---
    await page.wait(3000);

    // --- 6. Stop recording → .mov file ---
    const result = await page.tap("macos", "screen-record", { stop: true });
    const mov = result[0]?.file || "";
    if (!mov) return [{ mov: "", gif: "", status: "no recording", commands_run: "0" }];

    // --- 7. Convert .mov → .gif via ffmpeg ---
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
