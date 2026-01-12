import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type AdminApiToken, type AdminApiTokenWithSecret } from "../lib/api";
import { Key, Trash2, X, Copy, Check, Clock, AlertTriangle } from "lucide-react";

export function AdminTokens() {
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newToken, setNewToken] = useState<AdminApiTokenWithSecret | null>(null);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["admin-tokens"],
    queryFn: api.listAdminTokens,
  });

  const revokeMutation = useMutation({
    mutationFn: api.revokeAdminToken,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-tokens"] });
    },
  });

  const handleTokenCreated = (token: AdminApiTokenWithSecret) => {
    setNewToken(token);
    setIsCreateModalOpen(false);
    queryClient.invalidateQueries({ queryKey: ["admin-tokens"] });
  };

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-48"></div>
          <div className="h-64 bg-gray-200 rounded-lg"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">API Tokens</h1>
          <p className="text-sm text-gray-500 mt-1">
            Create and manage API tokens for system administration automation.
          </p>
        </div>
        <button
          onClick={() => setIsCreateModalOpen(true)}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          Create Token
        </button>
      </div>

      {/* Info Box */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
        <div className="flex items-start gap-3">
          <Key className="w-5 h-5 text-blue-600 mt-0.5" />
          <div>
            <h3 className="text-sm font-medium text-blue-900">Using Admin Tokens</h3>
            <p className="text-sm text-blue-700 mt-1">
              Admin tokens allow you to authenticate API requests for automation and CI/CD pipelines.
              Use them with the Authorization header:
            </p>
            <code className="block mt-2 text-xs bg-blue-100 text-blue-800 p-2 rounded font-mono">
              Authorization: Bearer grounded_admin_...
            </code>
          </div>
        </div>
      </div>

      {/* Tokens Table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Name
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Token Prefix
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Created
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Last Used
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Expires
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {data?.tokens.map((token) => (
              <TokenRow
                key={token.id}
                token={token}
                onRevoke={() => {
                  if (confirm(`Revoke token "${token.name}"? This cannot be undone.`)) {
                    revokeMutation.mutate(token.id);
                  }
                }}
              />
            ))}
            {(!data?.tokens || data.tokens.length === 0) && (
              <tr>
                <td colSpan={6} className="px-6 py-12 text-center text-gray-500">
                  No API tokens found. Create one to get started.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Create Token Modal */}
      {isCreateModalOpen && (
        <CreateTokenModal
          onClose={() => setIsCreateModalOpen(false)}
          onCreated={handleTokenCreated}
        />
      )}

      {/* New Token Display Modal */}
      {newToken && (
        <NewTokenModal
          token={newToken}
          onClose={() => setNewToken(null)}
        />
      )}
    </div>
  );
}

function TokenRow({ token, onRevoke }: { token: AdminApiToken; onRevoke: () => void }) {
  const isExpired = token.expiresAt && new Date(token.expiresAt) < new Date();

  return (
    <tr className="hover:bg-gray-50">
      <td className="px-6 py-4 whitespace-nowrap">
        <div className="flex items-center gap-2">
          <Key className="w-4 h-4 text-gray-400" />
          <span className="text-sm font-medium text-gray-900">{token.name}</span>
        </div>
      </td>
      <td className="px-6 py-4 whitespace-nowrap">
        <code className="text-xs font-mono bg-gray-100 text-gray-700 px-2 py-1 rounded">
          {token.tokenPrefix}...
        </code>
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
        {new Date(token.createdAt).toLocaleDateString()}
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
        {token.lastUsedAt ? (
          new Date(token.lastUsedAt).toLocaleDateString()
        ) : (
          <span className="text-gray-400">Never</span>
        )}
      </td>
      <td className="px-6 py-4 whitespace-nowrap">
        {token.expiresAt ? (
          <div className="flex items-center gap-1">
            {isExpired ? (
              <>
                <AlertTriangle className="w-4 h-4 text-red-500" />
                <span className="text-sm text-red-600">Expired</span>
              </>
            ) : (
              <>
                <Clock className="w-4 h-4 text-gray-400" />
                <span className="text-sm text-gray-600">
                  {new Date(token.expiresAt).toLocaleDateString()}
                </span>
              </>
            )}
          </div>
        ) : (
          <span className="text-sm text-gray-400">Never</span>
        )}
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-right">
        <button
          onClick={onRevoke}
          className="text-red-600 hover:text-red-800 p-1"
          title="Revoke token"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </td>
    </tr>
  );
}

function CreateTokenModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (token: AdminApiTokenWithSecret) => void;
}) {
  const [name, setName] = useState("");
  const [hasExpiry, setHasExpiry] = useState(false);
  const [expiresAt, setExpiresAt] = useState("");

  const createMutation = useMutation({
    mutationFn: api.createAdminToken,
    onSuccess: (data) => {
      onCreated(data);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate({
      name,
      expiresAt: hasExpiry && expiresAt ? new Date(expiresAt).toISOString() : undefined,
    });
  };

  // Default to 1 year from now for expiry input
  const defaultExpiry = new Date();
  defaultExpiry.setFullYear(defaultExpiry.getFullYear() + 1);
  const defaultExpiryStr = defaultExpiry.toISOString().split("T")[0];

  return (
    <div className="fixed inset-0 overlay-dim backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Create API Token</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Token Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500"
              placeholder="e.g., CI/CD Pipeline"
              required
            />
            <p className="mt-1 text-xs text-gray-500">
              A descriptive name to identify this token.
            </p>
          </div>

          <div>
            <div className="flex items-center gap-2 mb-2">
              <input
                type="checkbox"
                id="hasExpiry"
                checked={hasExpiry}
                onChange={(e) => setHasExpiry(e.target.checked)}
                className="rounded border-gray-300"
              />
              <label htmlFor="hasExpiry" className="text-sm text-gray-700">
                Set expiration date
              </label>
            </div>
            {hasExpiry && (
              <input
                type="date"
                value={expiresAt || defaultExpiryStr}
                onChange={(e) => setExpiresAt(e.target.value)}
                min={new Date().toISOString().split("T")[0]}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500"
              />
            )}
          </div>

          {createMutation.error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-600">{createMutation.error.message}</p>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createMutation.isPending || !name}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {createMutation.isPending ? "Creating..." : "Create Token"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function NewTokenModal({
  token,
  onClose,
}: {
  token: AdminApiTokenWithSecret;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(token.token);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 overlay-dim backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Token Created</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Warning */}
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5" />
            <div>
              <h3 className="text-sm font-medium text-amber-900">Copy your token now</h3>
              <p className="text-sm text-amber-700 mt-1">
                This is the only time you'll see this token. Store it securely - you won't be able to see it again.
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Token Name
            </label>
            <p className="text-sm text-gray-900">{token.name}</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              API Token
            </label>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-sm font-mono bg-gray-100 text-gray-900 px-3 py-2 rounded-lg break-all">
                {token.token}
              </code>
              <button
                onClick={handleCopy}
                className="p-2 text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
                title="Copy to clipboard"
              >
                {copied ? (
                  <Check className="w-5 h-5 text-green-600" />
                ) : (
                  <Copy className="w-5 h-5" />
                )}
              </button>
            </div>
          </div>

          {token.expiresAt && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Expires
              </label>
              <p className="text-sm text-gray-600">
                {new Date(token.expiresAt).toLocaleDateString()}
              </p>
            </div>
          )}
        </div>

        <div className="flex justify-end mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
