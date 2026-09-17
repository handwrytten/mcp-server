// Only known diagnostic labels may enter logs; never log arbitrary error
// messages, URLs, bodies, stacks, or custom name/code values.
export function safeErrorInfo(error: unknown) {
  const value = error as { name?: string; code?: string; cause?: { code?: string } } | null;
  const names = ["Error", "TypeError", "SyntaxError", "RangeError", "AbortError", "TimeoutError"];
  const codes = ["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "EPIPE", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_SOCKET"];
  const code = value?.code ?? value?.cause?.code;
  return {
    name: names.includes(value?.name || "") ? value!.name : "UnknownError",
    ...(code && codes.includes(code) ? { code } : {}),
  };
}

export function parseMcpServerUrl(value: string): string {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
        url.search || url.hash || url.pathname !== "/") throw new Error();
    return url.origin;
  } catch {
    throw new Error("MCP_SERVER_URL must be an HTTP(S) origin without credentials, path, query, or fragment.");
  }
}
