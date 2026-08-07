"use strict";

const fs = require("fs");
const path = require("path");

const templateSrc = path.join("resources", "yaml", "aks-deploy.template.yaml");
const templateDstDir = path.join("out", "src", "commands", "aksContainerAssist");

fs.mkdirSync(templateDstDir, { recursive: true });
fs.copyFileSync(templateSrc, path.join(templateDstDir, path.basename(templateSrc)));

const skillsSrc = path.join("node_modules", "containerization-assist-mcp", "skills");
const skillsDst = path.join("dist", "skills");

fs.rmSync(skillsDst, { recursive: true, force: true });
fs.mkdirSync("dist", { recursive: true });
fs.cpSync(skillsSrc, skillsDst, { recursive: true });
