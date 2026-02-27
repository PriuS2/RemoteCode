import { useState, FormEvent } from "react";

interface LoginProps {
  onLogin: (token: string) => void;
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
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || "Login failed");
      }

      const data = await res.json();
      localStorage.setItem("token", data.access_token);
      onLogin(data.access_token);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
        background: "#1e1e2e",
        color: "#cdd6f4",
      }}
    >
      <h1 style={{ marginBottom: 32, fontSize: 28 }}>Remote Code</h1>
      <form
        onSubmit={handleSubmit}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 16,
          width: 320,
        }}
      >
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          autoFocus
          style={{
            padding: "12px 16px",
            fontSize: 16,
            background: "#313244",
            color: "#cdd6f4",
            border: "1px solid #45475a",
            borderRadius: 8,
            outline: "none",
          }}
        />
        <button
          type="submit"
          disabled={loading || !password}
          style={{
            padding: "12px 24px",
            fontSize: 16,
            background: "#89b4fa",
            color: "#1e1e2e",
            border: "none",
            borderRadius: 8,
            cursor: loading ? "wait" : "pointer",
            fontWeight: 600,
          }}
        >
          {loading ? "Logging in..." : "Login"}
        </button>
        {error && (
          <p style={{ color: "#f38ba8", textAlign: "center", margin: 0 }}>
            {error}
          </p>
        )}
      </form>
    </div>
  );
}
