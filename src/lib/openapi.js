// Minimal Swagger 2.0 / OpenAPI 3.x parser — extracts just enough to drive a
// lightweight in-panel API tester: a base URL, a flat endpoint list, and a
// best-effort example request body per endpoint.
//
// This is deliberately NOT a full spec validator/resolver (no external
// OpenAPI toolchain, to keep the extension build-free). $ref resolution is
// shallow and depth-capped, which covers the vast majority of real-world
// specs without the complexity of allOf/oneOf/discriminator handling.

const METHODS = ["get", "put", "post", "delete", "options", "head", "patch"];

export function parseSpec(spec) {
  if (!spec || typeof spec !== "object" || !spec.paths) {
    throw new Error("This doesn't look like an OpenAPI/Swagger document (no \"paths\" found).");
  }
  const isOAS3 = !!spec.openapi;
  const baseUrl = isOAS3 ? oas3BaseUrl(spec) : swagger2BaseUrl(spec);
  const endpoints = [];

  for (const [path, pathItem] of Object.entries(spec.paths || {})) {
    const pathLevelParams = pathItem.parameters || [];
    for (const method of METHODS) {
      const op = pathItem[method];
      if (!op) continue;
      const parameters = mergeParams(pathLevelParams, op.parameters || []);
      const { body, contentType } = isOAS3 ? extractOAS3Body(op, spec) : extractSwagger2Body(parameters, spec);
      endpoints.push({
        id: `${method.toUpperCase()} ${path}`,
        method: method.toUpperCase(),
        path,
        tags: Array.isArray(op.tags) ? op.tags : [],
        summary: op.summary || op.operationId || "",
        operationId: op.operationId || "",
        parameters: parameters.filter((p) => p.in !== "body" && p.in !== "formData"),
        bodyExample: body,
        contentType: contentType || "application/json",
      });
    }
  }

  endpoints.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
  return { baseUrl, endpoints };
}

function mergeParams(pathLevel, opLevel) {
  const byKey = new Map();
  [...pathLevel, ...opLevel].forEach((p) => byKey.set(`${p.in}:${p.name}`, p));
  return [...byKey.values()];
}

function oas3BaseUrl(spec) {
  // Server URLs are sometimes relative or templated ({basePath}) — left as-is;
  // the tester can edit the Base URL field before sending a request.
  return spec.servers?.[0]?.url || "";
}

function swagger2BaseUrl(spec) {
  const scheme = (spec.schemes && spec.schemes[0]) || "https";
  const host = spec.host || "";
  const basePath = spec.basePath || "";
  return host ? `${scheme}://${host}${basePath}` : "";
}

function extractOAS3Body(op, spec) {
  const content = op.requestBody?.content;
  if (!content) return { body: null, contentType: null };
  const ct = content["application/json"] ? "application/json" : Object.keys(content)[0];
  const media = content[ct];
  if (!media) return { body: null, contentType: null };
  if (media.example !== undefined) return { body: media.example, contentType: ct };
  const firstExample = media.examples && Object.values(media.examples)[0];
  if (firstExample?.value !== undefined) return { body: firstExample.value, contentType: ct };
  if (media.schema) return { body: exampleFromSchema(media.schema, spec, 0), contentType: ct };
  return { body: null, contentType: ct };
}

function extractSwagger2Body(parameters, spec) {
  const bodyParam = parameters.find((p) => p.in === "body");
  if (!bodyParam?.schema) return { body: null, contentType: null };
  return { body: exampleFromSchema(bodyParam.schema, spec, 0), contentType: "application/json" };
}

// Resolves a "#/components/schemas/Foo"-style $ref against the root document.
function resolveRef(ref, spec) {
  const path = ref.replace(/^#\//, "").split("/");
  let node = spec;
  for (const key of path) node = node?.[key];
  return node || null;
}

function exampleFromSchema(schema, spec, depth) {
  if (!schema || depth > 5) return null;
  if (schema.$ref) return exampleFromSchema(resolveRef(schema.$ref, spec), spec, depth + 1);
  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;
  if (schema.enum?.length) return schema.enum[0];

  const type = schema.type || (schema.properties ? "object" : undefined);
  if (type === "object" || schema.properties) {
    const out = {};
    for (const [key, propSchema] of Object.entries(schema.properties || {})) {
      out[key] = exampleFromSchema(propSchema, spec, depth + 1);
    }
    return out;
  }
  if (type === "array") {
    const item = exampleFromSchema(schema.items, spec, depth + 1);
    return item !== undefined ? [item] : [];
  }
  if (type === "string") {
    if (schema.format === "date-time") return "2024-01-01T00:00:00Z";
    if (schema.format === "date") return "2024-01-01";
    return "";
  }
  if (type === "integer" || type === "number") return 0;
  if (type === "boolean") return false;
  return null;
}
