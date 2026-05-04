export function parseJsonObjectFromModelText<T>(text: string): T {
  const trimmed = text.trim();

  // Common case: model returns pure JSON.
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    // Continue with relaxed extraction below.
  }

  // Handle ```json ... ``` wrappers.
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch?.[1]) {
    return JSON.parse(fenceMatch[1]) as T;
  }

  // Handle explanatory preamble + JSON body.
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return JSON.parse(trimmed.slice(start, end + 1)) as T;
  }

  throw new Error(`Model response did not contain JSON: ${preview(trimmed)}`);
}

function preview(value: string, max = 180): string {
  if (!value) return "empty response";
  return value.length > max ? `${value.slice(0, max)}...` : value;
}
