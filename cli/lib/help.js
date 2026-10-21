"use strict";

const HELP = [
  "tinker — write with the tinker coach in your terminal",
  "",
  "Usage:",
  "  tinker              Start the writing coach (one question at a time)",
  "  tinker login        Sign in with phone OTP; opens Notion OAuth if needed",
  "  tinker logout       Clear saved credentials from ~/.tinker",
  "  tinker --help       Show this help",
  "",
  "During a session:",
  "  type your answer and press Enter (compact; one question on screen)",
  "  end a multi-line answer with a line that is only .",
  "  .edit                open $VISUAL / $EDITOR for a longer answer",
  "  this is everything   finish, stitch, save to Notion",
  "  .quit                leave without saving",
  "",
  "Config (never printed):",
  "  ~/.tinker                      { \"apiBaseUrl\", \"token\" }",
  "  TINKER_API_BASE_URL            API host (default https://tinker.beginner.work)",
  "  TINKER_TOKEN                   Stytch session token",
].join("\n");

function printHelp(stream = process.stdout) {
  stream.write(HELP + "\n");
}

module.exports = { HELP, printHelp };
