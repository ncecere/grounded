import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useTheme } from "@/hooks/use-theme";
import { Sun, Moon, Monitor } from "lucide-react";

interface LoginProps {
  onSuccess: () => void;
}

export function Login({ onSuccess }: LoginProps) {
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { theme, setTheme } = useTheme();

  const loginMutation = useMutation({
    mutationFn: () => api.login(email, password),
    onSuccess: () => onSuccess(),
    onError: (err: Error) => setError(err.message),
  });

  const registerMutation = useMutation({
    mutationFn: () => api.register(email, password),
    onSuccess: () => onSuccess(),
    onError: (err: Error) => setError(err.message),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (isRegister) {
      if (password !== confirmPassword) {
        setError("Passwords do not match");
        return;
      }
      registerMutation.mutate();
    } else {
      loginMutation.mutate();
    }
  };

  const isLoading = loginMutation.isPending || registerMutation.isPending;

  const cycleTheme = () => {
    if (theme === 'light') setTheme('dark');
    else if (theme === 'dark') setTheme('system');
    else setTheme('light');
  };

  const ThemeIcon = theme === 'system' ? Monitor : theme === 'dark' ? Moon : Sun;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background py-12 px-4 sm:px-6 lg:px-8 relative">
      {/* Subtle background gradient */}
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-accent/10 pointer-events-none" />

      {/* Theme toggle */}
      <button
        onClick={cycleTheme}
        className="absolute top-4 right-4 p-2 rounded-lg bg-card border border-border hover:bg-accent transition-colors"
        title={`Theme: ${theme}`}
      >
        <ThemeIcon className="h-5 w-5 text-muted-foreground" />
      </button>

      <div className="max-w-md w-full relative z-10">
        {/* Logo/Branding */}
        <div className="text-center mb-10">
          <img
            src="/grounded-logo.png"
            alt="Grounded"
            className="w-20 h-20 mx-auto mb-4 drop-shadow-lg"
          />
          <h1 className="text-3xl font-bold text-foreground">Grounded</h1>
          <p className="mt-2 text-muted-foreground">
            {isRegister ? "Create your account" : "Welcome back"}
          </p>
        </div>

        {/* Form Card */}
        <div className="bg-card rounded-2xl shadow-xl border border-border p-8">
          <form onSubmit={handleSubmit} className="space-y-6">
            {error && (
              <div className="bg-destructive/10 border border-destructive/20 text-destructive px-4 py-3 rounded-lg text-sm">
                {error}
              </div>
            )}

            <div>
              <label htmlFor="email" className="block text-sm font-medium text-foreground mb-1">
                Email address
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="appearance-none relative block w-full px-4 py-3 border border-input bg-background placeholder-muted-foreground text-foreground rounded-lg focus:outline-hidden focus:ring-2 focus:ring-primary focus:border-transparent transition-colors"
                placeholder="you@example.com"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-foreground mb-1">
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                autoComplete={isRegister ? "new-password" : "current-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="appearance-none relative block w-full px-4 py-3 border border-input bg-background placeholder-muted-foreground text-foreground rounded-lg focus:outline-hidden focus:ring-2 focus:ring-primary focus:border-transparent transition-colors"
                placeholder={isRegister ? "Min 8 chars, uppercase, lowercase, number" : "Enter your password"}
              />
            </div>

            {isRegister && (
              <div>
                <label htmlFor="confirmPassword" className="block text-sm font-medium text-foreground mb-1">
                  Confirm Password
                </label>
                <input
                  id="confirmPassword"
                  type="password"
                  required
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="appearance-none relative block w-full px-4 py-3 border border-input bg-background placeholder-muted-foreground text-foreground rounded-lg focus:outline-hidden focus:ring-2 focus:ring-primary focus:border-transparent transition-colors"
                  placeholder="Confirm your password"
                />
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full flex justify-center py-3 px-4 border border-transparent text-sm font-semibold rounded-lg text-primary-foreground bg-primary hover:bg-primary/90 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-primary transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-md hover:shadow-lg"
            >
              {isLoading ? (
                <svg className="animate-spin h-5 w-5 text-primary-foreground" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              ) : isRegister ? (
                "Create Account"
              ) : (
                "Sign In"
              )}
            </button>
          </form>

          <div className="mt-6">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-card text-muted-foreground">Or</span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                setIsRegister(!isRegister);
                setError(null);
              }}
              className="mt-4 w-full text-center text-sm text-primary hover:text-primary/80 font-medium transition-colors"
            >
              {isRegister
                ? "Already have an account? Sign in"
                : "Don't have an account? Register"}
            </button>
          </div>
        </div>

        {/* Footer */}
        <p className="mt-8 text-center text-sm text-muted-foreground">
          A grounded knowledge platform
        </p>
      </div>
    </div>
  );
}
