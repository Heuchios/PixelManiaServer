"use strict";
const fs = require("node:fs");
const path = require("node:path");
for (const name of ["world_name_pricing", "server_world_names", "server_world_taxes"]) {
  const root = path.join(__dirname,"..");
  fs.copyFileSync(path.join(root,".tsbuild/world-name-pricing",`${name}.js`),path.join(root,`${name}.js`));
}
