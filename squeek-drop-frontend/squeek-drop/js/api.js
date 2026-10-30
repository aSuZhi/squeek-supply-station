import { CONFIG } from "./config.js";
export class ApiError extends Error {
  constructor(code, status) {
    super(code);
    this.code = code;
    this.status = status;
  }
}
export const api = {
  token: sessionStorage.getItem("ss.jwt"),
  async request(
    path,
    { method = "GET", body, runToken, publicRead = false } = {},
  ) {
    const headers = { "content-type": "application/json" };
    if (this.token && !publicRead)
      headers.authorization = "Bearer " + this.token;
    if (runToken) headers["x-run-token"] = runToken;
    let response;
    try {
      response = await fetch(CONFIG.apiBase + path, {
        method,
        headers,
        body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
        signal: AbortSignal.timeout(25000),
      });
    } catch {
      throw new ApiError("network_error", 0);
    }
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401) this.logout();
      throw new ApiError(result.error || "request_failed", response.status);
    }
    return result;
  },
  async login(address, sign) {
    const { message } = await this.request("/v1/auth/nonce", {
      method: "POST",
      body: { address },
      publicRead: true,
    });
    const signature = await sign(message);
    const result = await this.request("/v1/auth/verify", {
      method: "POST",
      body: { address, message, signature },
      publicRead: true,
    });
    this.token = result.token;
    sessionStorage.setItem("ss.jwt", result.token);
    return result;
  },
  logout() {
    this.token = null;
    sessionStorage.removeItem("ss.jwt");
  },
};
