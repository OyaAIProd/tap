/**
 * macos/screen-record — Record full screen video, auto-stops on Space switch.
 * Runtime: macos
 *
 * Composes: macos/space (switch desktop) + ffmpeg (record) + watchdog (auto-stop).
 *
 *   tap --runtime macos macos screen-record --desktop 1
 *   tap --runtime macos macos screen-record --stop true
 */
export default {
  site: "macos",
  name: "screen-record",
  runtime: "macos",
  description: "Record full screen video, auto-stops on Desktop switch",
  columns: ["file", "status", "size", "pid"],
  args: {
    desktop: { type: "int", default: 0, description: "Switch to Desktop N first (0=stay)" },
    stop: { type: "string", default: "", description: "Stop current recording" },
  },

  async run(page, args) {
    const pidFile = "/tmp/screen-record.pid";
    const sh = (cmd) => page.eval(`
      var app = Application.currentApplication();
      app.includeStandardAdditions = true;
      app.doShellScript(${JSON.stringify(cmd)});
    `);

    // --- Stop ---
    if (args.stop) {
      const pid = await sh(`cat ${pidFile} 2>/dev/null || echo ""`);
      if (!pid) return [{ file: "", status: "no recording", size: "", pid: "" }];
      await sh(`kill ${pid} 2>/dev/null; sleep 0.5; rm -f ${pidFile}`);
      const file = await sh(`ls -t /tmp/screen-record-*.mov 2>/dev/null | head -1`);
      const sizeStr = file ? await sh(`stat -f '%z' ${file}`) : "0";
      const sizeMB = ((parseInt(sizeStr) || 0) / 1024 / 1024).toFixed(1) + " MB";
      return [{ file: file || "", status: "stopped", size: sizeMB, pid }];
    }

    // --- Switch Desktop via composable macos/space tap ---
    let spaceId;
    if (args.desktop > 0) {
      const rows = await page.tap("macos", "space", { switch: args.desktop });
      spaceId = rows[0]?.space_id;
    } else {
      const rows = await page.tap("macos", "space");
      spaceId = rows[0]?.space_id;
    }

    // --- Kill existing recording ---
    await sh(`if [ -f ${pidFile} ]; then kill $(cat ${pidFile}) 2>/dev/null; rm -f ${pidFile}; sleep 0.5; fi`);

    const file = `/tmp/screen-record-${Date.now()}.mov`;

    // --- Start ffmpeg + watchdog, fully detached ---
    // Write watchdog script to disk for clean execution
    await sh(`cat > /tmp/screen-record-watch.sh << 'WATCHEOF'
#!/bin/bash
PIDFILE=/tmp/screen-record.pid
START_SPACE="$1"
sleep 2
while [ -f "$PIDFILE" ] && kill -0 $(cat "$PIDFILE") 2>/dev/null; do
  CUR=$(/tmp/tap-space-id 2>/dev/null)
  if [ "$CUR" != "$START_SPACE" ]; then
    kill $(cat "$PIDFILE") 2>/dev/null
    rm -f "$PIDFILE"
    exit 0
  fi
  sleep 1
done
WATCHEOF
chmod +x /tmp/screen-record-watch.sh`);

    // Launch ffmpeg (detached) + watchdog (detached)
    await sh(
      `nohup /opt/homebrew/bin/ffmpeg -f avfoundation -framerate 30 -i "2:" ` +
      `-c:v libx264 -preset ultrafast -pix_fmt yuv420p -y ${file} ` +
      `</dev/null >/dev/null 2>&1 & echo $! > ${pidFile}; ` +
      `nohup /tmp/screen-record-watch.sh ${spaceId} </dev/null >/dev/null 2>&1 &`
    );

    const pid = await sh(`cat ${pidFile}`);
    await page.wait(500);
    const check = await sh(`kill -0 ${pid} 2>/dev/null && echo "ok" || echo "dead"`);
    if (check !== "ok") throw new Error("ffmpeg failed to start");

    return [{ file, status: "recording (auto-stop on Space switch)", size: "0 MB", pid }];
  },
};
