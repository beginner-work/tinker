/* Checked-in list of learning exercise modules in tlindow/lindowlabs.
 *
 * Add one object under modules[] to surface a new track (for example
 * api-design). Keep ids identical to the folder name under exercises/.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.tinkerExercisesManifest = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  return {
    repo: "tlindow/lindowlabs",
    branch: "main",
    exercisesRoot: "exercises",
    modules: [
      {
        id: "realtime-deal-room",
        name: "Real-time deal room",
        // Compare transports for a small collaborative session.
        description:
          "Compare short polling, SSE, and WebSockets for a collaborative deal room.",
        tags: ["realtime", "websocket", "websockets", "sse", "deal room", "collaboration", "polling"],
      },
      {
        id: "rest-api-trading",
        name: "REST API trading",
        description:
          "Design REST contracts for a Robinhood-style stock trading platform.",
        tags: ["rest", "api", "trading", "robinhood", "http", "stock"],
      },
      {
        id: "proto-learning",
        name: "Protobuf settlements",
        description:
          "Practice Protobuf schemas for merchant settlements and payout rails.",
        tags: ["protobuf", "proto", "grpc", "settlement", "settlements", "payout"],
      },
      {
        id: "nextjs-learning",
        name: "Next.js App Router",
        description:
          "Learn Next.js App Router patterns with a treasury and streaming dashboard.",
        tags: ["nextjs", "next.js", "react", "rsc", "app router", "streaming", "suspense"],
      },
      // TODO: add api-design when that worksheet lands under exercises/api-design/.
    ],
  };
});
