const ALLOWED_ROOTS = new Set(["summary", "headline", "skills", "experience", "projects", "education", "certifications"]);

function decodeSegment(segment) {
  return segment.replace(/~1/g, "/").replace(/~0/g, "~");
}

export function parsePointer(pointer) {
  if (typeof pointer !== "string" || !pointer.startsWith("/")) throw new TypeError("Patch path must be a JSON Pointer");
  const segments = pointer.slice(1).split("/").map(decodeSegment);
  if (!segments[0] || !ALLOWED_ROOTS.has(segments[0])) throw new TypeError("Patch path targets an unsupported resume section");
  if (segments.some((segment) => ["__proto__", "prototype", "constructor"].includes(segment))) {
    throw new TypeError("Unsafe patch path");
  }
  return segments;
}

export function readPointer(document, pointer) {
  return parsePointer(pointer).reduce((value, segment) => value?.[segment], document);
}

export function applyResumePatches(document, patches) {
  const result = structuredClone(document);
  const applied = [];
  for (const patch of patches || []) {
    if (!patch || !["add", "replace", "remove"].includes(patch.op)) throw new TypeError("Unsupported patch operation");
    const segments = parsePointer(patch.path);
    const key = segments.pop();
    let parent = result;
    for (const segment of segments) {
      if (parent?.[segment] === undefined || parent?.[segment] === null) {
        if (patch.op !== "add") throw new TypeError(`Patch path does not exist: ${patch.path}`);
        parent[segment] = /^\d+$/.test(key) ? [] : {};
      }
      parent = parent[segment];
    }
    if (Array.isArray(parent)) {
      const index = key === "-" ? parent.length : Number(key);
      if (!Number.isInteger(index) || index < 0 || index > parent.length) throw new TypeError(`Invalid array index: ${key}`);
      if (patch.op === "add") parent.splice(index, 0, structuredClone(patch.value));
      else if (patch.op === "replace" && index < parent.length) parent[index] = structuredClone(patch.value);
      else if (patch.op === "remove" && index < parent.length) parent.splice(index, 1);
      else throw new TypeError(`Patch path does not exist: ${patch.path}`);
    } else {
      if (!parent || typeof parent !== "object") throw new TypeError(`Patch parent is not an object: ${patch.path}`);
      if (patch.op !== "add" && !Object.hasOwn(parent, key)) throw new TypeError(`Patch path does not exist: ${patch.path}`);
      if (patch.op === "remove") delete parent[key];
      else parent[key] = structuredClone(patch.value);
    }
    applied.push({ op: patch.op, path: patch.path });
  }
  return { resume: result, applied };
}

