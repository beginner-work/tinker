"use strict";

const schema = require("./schema.js");
const signals = require("./signals.js");
const update = require("./update.js");
const zpd = require("./zpd.js");
const jev = require("./jev.js");
const recommend = require("./recommend.js");

module.exports = {
  ...schema,
  ...signals,
  ...update,
  ...zpd,
  ...jev,
  ...recommend,
};
