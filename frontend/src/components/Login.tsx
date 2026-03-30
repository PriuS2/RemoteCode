import { useState, FormEvent } from "react";
import { apiFetch, readErrorMessage } from "../utils/api";

interface LoginProps {
  onLogin: () => void;
}

export default function Login({ onLogin }: LoginProps) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await apiFetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
        skipAuthHandling: true,
      });

      if (!res.ok) {
        throw new Error(await readErrorMessage(res, "Login failed"));
      }

      onLogin();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-eyebrow">Remote Access</div>
        <h1 className="login-title">Remote Code</h1>
        <p className="login-copy">
          Sign in to open the console workbench, browse projects, and continue terminal work across their sessions.
        </p>

        <form onSubmit={handleSubmit} className="login-form">
          <div className="login-field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              data-testid="login-password"
              className="ui-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              autoFocus
            />
          </div>

          <button
            className="primary-button login-submit"
            type="submit"
            disabled={loading || !password}
            data-testid="login-submit"
          >
            {loading ? "Logging in..." : "Enter Workbench"}
          </button>

          {error && <p className="ui-error">{error}</p>}
        </form>
      </div>
    </div>
  );
}
