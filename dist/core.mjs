// Stable entry point shared by the browser, CLI and regression suite.
export { METRICS, KNOWLEDGE, COLUMNS, retrieve } from "./lib/catalog.mjs";
export { parseCSV, normalize } from "./lib/data.mjs";
export { route, validatePlan } from "./lib/router.mjs";
export { analyze, value, format, narrative } from "./lib/engine.mjs";
