const AUTH_EXPIRED_EVENT = "remote-code-auth-expired";

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
  try {
    const data = await response.clone().json();
    if (typeof data?.detail === "string" && data.detail) {
      return data.detail;
    }
  } catch {
    // Ignore JSON parse failures.
  }

  try {
    const text = await response.text();
    if (text) {
      return text;
    }
  } catch {
    // Ignore text parse failures.
  }

  return fallback;
}
