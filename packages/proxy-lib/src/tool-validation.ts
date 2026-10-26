import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";

type Tool = { function: { name: string; parameters?: unknown } };
type Call = { function: { name: string; arguments: string } };
type Choice = string | { function: { name: string } };
export type ToolValidationIssue = { path: string; schemaPath?: string; reason: string };
export class ToolContractError extends Error {
  constructor(readonly issues: ToolValidationIssue[]) {
    super(issues.map(issue => `${issue.path}: ${issue.reason}${issue.schemaPath ? ` (${issue.schemaPath})` : ""}`).join("; "));
    this.name = "ToolContractError";
  }
}

function fail(path: string, reason: string): never { throw new ToolContractError([{ path, reason }]); }
function schemaErrors(errors: ErrorObject[] | null | undefined, path: string): ToolValidationIssue[] {
  // Ajv's verbose params/data can contain caller values. Keep only structural diagnostics.
  return (errors ?? []).slice(0, 8).map(error => ({ path: path + error.instancePath, schemaPath: error.schemaPath, reason: error.message ?? error.keyword }));
}

/** Bound untrusted compiler input and allow references only within this schema. */
function checkSchema(schema: unknown, path: string): void {
  let bytes: number;
  try { bytes = Buffer.byteLength(JSON.stringify(schema)); } catch { fail(path, "schema must be JSON serializable"); }
  if (bytes > 256_000) fail(path, "schema exceeds 256000 bytes");
  let nodes = 0;
  function visit(value: unknown, depth: number, mode: "schema" | "map" | "array" | "data"): void {
    if (++nodes > 10_000 || depth > 64) fail(path, "schema exceeds complexity limit");
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (mode === "schema" && key === "$async" && child) fail(path, "async schemas are unsupported");
      if (mode === "schema" && (key === "$ref" || key === "$dynamicRef" || key === "$recursiveRef") && (typeof child !== "string" || !child.startsWith("#"))) fail(path, "only local schema references are supported");
      let next: typeof mode = "data";
      if (mode === "map" || mode === "array") next = "schema";
      else if (mode === "schema") {
        if (["$defs", "definitions", "properties", "patternProperties", "dependentSchemas", "dependencies"].includes(key)) next = "map";
        else if (["allOf", "anyOf", "oneOf", "prefixItems"].includes(key) || (key === "items" && Array.isArray(child))) next = "array";
        else if (["items", "additionalItems", "additionalProperties", "unevaluatedProperties", "unevaluatedItems", "propertyNames", "contains", "not", "if", "then", "else", "contentSchema"].includes(key)) next = "schema";
      }
      visit(child, depth + 1, next);
    }
  }
  visit(schema, 0, "schema");
}

/** Compile once before queue admission; validation never changes the model's arguments. */
export function compileToolContracts(tools: readonly Tool[] = [], choice?: Choice): { validate(calls: readonly Call[]): ToolValidationIssue[] } {
  if (tools.length > 128) fail("/tools", "at most 128 tools are supported");
  const validators = new Map<string, ValidateFunction>();
  const ajv = new Ajv({ coerceTypes: false, useDefaults: false, removeAdditional: false, allErrors: false,
    strict: false, validateSchema: true, addUsedSchema: false, ownProperties: true });
  addFormats(ajv);
  let totalBytes = 0;
  tools.forEach((tool, i) => {
    const path = `/tools/${i}/function`;
    const name = tool.function.name;
    if (!name.trim()) fail(`${path}/name`, "tool name must not be empty");
    if (validators.has(name)) fail(`${path}/name`, "duplicate tool name");
    const schema = tool.function.parameters === undefined ? {} : tool.function.parameters;
    if (typeof schema !== "boolean" && (!schema || typeof schema !== "object" || Array.isArray(schema))) fail(`${path}/parameters`, "schema must be an object or boolean");
    checkSchema(schema, `${path}/parameters`);
    totalBytes += Buffer.byteLength(JSON.stringify(schema));
    if (totalBytes > 1_000_000) fail("/tools", "combined schemas exceed 1000000 bytes");
    try {
      if (!ajv.validateSchema(schema)) throw new ToolContractError(schemaErrors(ajv.errors, `${path}/parameters`));
      validators.set(name, ajv.compile(schema));
    } catch (error) {
      if (error instanceof ToolContractError) throw error;
      fail(`${path}/parameters`, "schema could not be compiled (invalid format, reference or constraint)");
    }
  });
  if (typeof choice === "object" && !validators.has(choice.function.name)) fail("/tool_choice/function/name", "selected tool is not declared");
  return {
    validate(calls) {
      const issues: ToolValidationIssue[] = [];
      calls.forEach((call, i) => {
        const path = `/tool_calls/${i}/function`;
        const validate = validators.get(call.function.name);
        if (!validate) { issues.push({ path: `${path}/name`, reason: "tool is not declared" }); return; }
        if (typeof choice === "object" && call.function.name !== choice.function.name) { issues.push({ path: `${path}/name`, reason: "tool differs from named tool_choice" }); return; }
        let args: unknown;
        try { args = JSON.parse(call.function.arguments); } catch { issues.push({ path: `${path}/arguments`, reason: "arguments must be valid JSON" }); return; }
        if (!args || typeof args !== "object" || Array.isArray(args)) { issues.push({ path: `${path}/arguments`, reason: "arguments must be an object" }); return; }
        if (!validate(args)) issues.push(...schemaErrors(validate.errors, `${path}/arguments`));
      });
      return issues;
    },
  };
}
