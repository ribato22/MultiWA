// MultiWA Plugin: Example Logger
// plugins/example-logger/index.ts
//
// This is an example plugin that demonstrates the MultiWA plugin system.
// It logs all incoming and outgoing messages to the console.
//
// To activate: place this folder in the `plugins/` directory and restart the server.
// To deactivate: remove or rename the folder.

const plugin = {
  name: "example-logger",
  version: "1.0.0",
  description: "Logs all message events to console (example plugin)",
  events: ["message.received", "message.sent", "message.failed"],

  onInit(ctx) {
    ctx.logger.log("Example Logger plugin initialized");
  },

  onEvent(event, data, ctx) {
    const preview = JSON.stringify(data).substring(0, 200);
    ctx.logger.log(`[${event}] ${preview}`);
  },

  onDestroy(ctx) {
    ctx.logger.log("Example Logger plugin destroyed");
  },
};

module.exports = plugin;
module.exports.default = plugin;
