const AUTH_EXPIRED_EVENT = "remote-code-auth-expired";

export interface ApiErrorDetail {
  code: string;
  message: string;
}

type ApiFetchOptions = RequestInit & {
  skipAuthHandling?: boolean;
};

export function onAuthExpired(listener: () => void): () => void {
  window.addEventListener(AUTH_EXPIRED_EVENT, listener);
  return () => window.removeEventListener(AUTH_EXPIRED_EVENT, listener);
}

export async function apiFetch(input: RequestInfo | URL, init: ApiFetchOptions = {}) {
  const { skipAuthHandling = false, ...requestInit } = init;
  const response = await fetch(input, {
    credentials: "same-origin",
    ...requestInit,
  });

  if (response.status === 401 && !skipAuthHandling) {
    window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
  }

  return response;
}

export async function readErrorMessage(response: Response, fallback: string) {
  const detail = await readErrorDetail(response, fallback);
  return detail.message;
}

export async function readErrorDetail(
  response: Response,
  fallback: string,
  fallbackCode = "unknown_error",
): Promise<ApiErrorDetail> {
  try {
    const data = await response.clone().json();
    if (typeof data?.detail === "string" && data.detail) {
      return { code: fallbackCode, message: data.detail };
    }
    if (
      typeof data?.detail?.message === "string"
      && typeof data?.detail?.code === "string"
    ) {
      return { code: data.detail.code, message: data.detail.message };
    }
  } catch {
    // Ignore JSON parse failures.
  }

  try {
    const text = await response.text();
    if (text) {
      return { code: fallbackCode, message: text };
    }
  } catch {
    // Ignore text parse failures.
  }

  return { code: fallbackCode, message: fallback };
}
