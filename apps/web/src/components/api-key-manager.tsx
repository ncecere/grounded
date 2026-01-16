import { useState } from "react";
import { Key, Trash2, Copy, Check, Clock, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { InfoBox } from "@/components/ui/info-box";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// Generic types for API keys
interface BaseApiKey {
  id: string;
  name: string;
  keyPrefix?: string;
  tokenPrefix?: string;
  createdAt: string;
  lastUsedAt?: string | null;
  expiresAt?: string | null;
}

interface ApiKeyWithSecret {
  name: string;
  token?: string;
  apiKey?: string;
  scopes?: string[];
  expiresAt?: string | null;
}

interface ScopeOption {
  value: string;
  label: string;
  description?: string;
}

interface ApiKeyManagerProps<T extends BaseApiKey, S extends ApiKeyWithSecret> {
  // Data
  keys: T[];
  isLoading: boolean;
  
  // Actions
  onRevoke: (id: string) => void;
  isRevoking?: boolean;
  onCreate: (data: { name: string; scopes?: string[]; expiresAt?: string }) => void;
  isCreating?: boolean;
  createError?: Error | null;
  
  // Newly created key (with secret visible)
  newKey: S | null;
  onNewKeyDismiss: () => void;
  
  // Configuration
  title?: string;
  description?: string;
  infoTitle?: string;
  infoDescription?: string;
  authHeaderExample?: string;
  scopes?: ScopeOption[];
  showScopes?: boolean;
  
  // Custom renderers
  renderExtraColumns?: (key: T) => React.ReactNode;
  extraColumnHeaders?: { key: string; header: string }[];
}

// Separate out scopes from the base key type
interface KeyWithScopes extends BaseApiKey {
  scopes?: string[];
}

export function ApiKeyManager<T extends BaseApiKey, S extends ApiKeyWithSecret>({
  keys,
  isLoading,
  onRevoke,
  isRevoking = false,
  onCreate,
  isCreating = false,
  createError,
  newKey,
  onNewKeyDismiss,
  title = "API Keys",
  description = "Manage API keys for programmatic access.",
  infoTitle = "Using API Keys",
  infoDescription = "API keys allow programmatic access to resources. Use them with the Authorization header:",
  authHeaderExample = "Authorization: Bearer grounded_...",
  scopes,
  showScopes = false,
  renderExtraColumns,
  extraColumnHeaders = [],
}: ApiKeyManagerProps<T, S>) {
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [keyToRevoke, setKeyToRevoke] = useState<T | null>(null);

  const handleCreate = (data: { name: string; scopes?: string[]; expiresAt?: string }) => {
    onCreate(data);
    setIsCreateModalOpen(false);
  };

  if (isLoading) {
    return <LoadingSkeleton variant="table" count={3} />;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">{title}</h2>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <Button onClick={() => setIsCreateModalOpen(true)}>
          Create {showScopes ? "API Key" : "Token"}
        </Button>
      </div>

      {/* Info Box */}
      <InfoBox icon={Key} title={infoTitle}>
        <p>{infoDescription}</p>
        <code className="block mt-2 text-xs bg-primary/10 px-2 py-1.5 rounded font-mono">
          {authHeaderExample}
        </code>
      </InfoBox>

      {/* Keys Table */}
      {keys.length === 0 ? (
        <EmptyState
          icon={Key}
          title={`No ${showScopes ? "API keys" : "tokens"} found`}
          description={`Create one to get started.`}
          action={{
            label: `Create ${showScopes ? "API Key" : "Token"}`,
            onClick: () => setIsCreateModalOpen(true),
          }}
        />
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead>Name</TableHead>
                <TableHead>{showScopes ? "Key" : "Token"} Prefix</TableHead>
                {showScopes && <TableHead>Scopes</TableHead>}
                {extraColumnHeaders.map((col) => (
                  <TableHead key={col.key}>{col.header}</TableHead>
                ))}
                <TableHead>Last Used</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.map((key) => (
                <KeyRow
                  key={key.id}
                  apiKey={key}
                  showScopes={showScopes}
                  onRevoke={() => setKeyToRevoke(key)}
                  renderExtraColumns={renderExtraColumns}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Create Modal */}
      <CreateKeyModal
        open={isCreateModalOpen}
        onOpenChange={setIsCreateModalOpen}
        onSubmit={handleCreate}
        isSubmitting={isCreating}
        error={createError}
        scopes={scopes}
        showScopes={showScopes}
      />

      {/* New Key Display Modal */}
      {newKey && (
        <NewKeyModal
          apiKey={newKey}
          onClose={onNewKeyDismiss}
          showScopes={showScopes}
        />
      )}

      {/* Revoke Confirmation */}
      <ConfirmDialog
        open={!!keyToRevoke}
        onOpenChange={(open) => {
          if (!open) setKeyToRevoke(null);
        }}
        title={`Revoke ${showScopes ? "API Key" : "Token"}`}
        description={`Are you sure you want to revoke "${keyToRevoke?.name}"? This action cannot be undone.`}
        confirmLabel="Revoke"
        variant="destructive"
        onConfirm={() => {
          if (keyToRevoke) {
            onRevoke(keyToRevoke.id);
            setKeyToRevoke(null);
          }
        }}
        isLoading={isRevoking}
      />
    </div>
  );
}

// Key Row Component
function KeyRow<T extends BaseApiKey>({
  apiKey,
  showScopes,
  onRevoke,
  renderExtraColumns,
}: {
  apiKey: T;
  showScopes: boolean;
  onRevoke: () => void;
  renderExtraColumns?: (key: T) => React.ReactNode;
}) {
  const isExpired = apiKey.expiresAt && new Date(apiKey.expiresAt) < new Date();
  const prefix = apiKey.keyPrefix || apiKey.tokenPrefix || "";
  const keyWithScopes = apiKey as KeyWithScopes;

  return (
    <TableRow>
      <TableCell>
        <div className="flex items-center gap-2">
          <Key className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-medium text-foreground">{apiKey.name}</span>
        </div>
      </TableCell>
      <TableCell>
        <code className="text-xs font-mono bg-muted text-muted-foreground px-2 py-1 rounded">
          {prefix}...
        </code>
      </TableCell>
      {showScopes && keyWithScopes.scopes && (
        <TableCell>
          <div className="flex gap-1 flex-wrap">
            {keyWithScopes.scopes.map((scope) => (
              <span key={scope} className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded">
                {scope}
              </span>
            ))}
          </div>
        </TableCell>
      )}
      {renderExtraColumns?.(apiKey)}
      <TableCell className="text-sm text-muted-foreground">
        {apiKey.lastUsedAt ? (
          new Date(apiKey.lastUsedAt).toLocaleDateString()
        ) : (
          <span className="text-muted-foreground/60">Never</span>
        )}
      </TableCell>
      <TableCell>
        {apiKey.expiresAt ? (
          <div className="flex items-center gap-1">
            {isExpired ? (
              <>
                <AlertTriangle className="w-4 h-4 text-destructive" />
                <span className="text-sm text-destructive">Expired</span>
              </>
            ) : (
              <>
                <Clock className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">
                  {new Date(apiKey.expiresAt).toLocaleDateString()}
                </span>
              </>
            )}
          </div>
        ) : (
          <span className="text-sm text-muted-foreground/60">Never</span>
        )}
      </TableCell>
      <TableCell className="text-right">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-destructive hover:text-destructive"
          onClick={onRevoke}
          title="Revoke"
        >
          <Trash2 className="w-4 h-4" />
        </Button>
      </TableCell>
    </TableRow>
  );
}

// Create Key Modal
function CreateKeyModal({
  open,
  onOpenChange,
  onSubmit,
  isSubmitting,
  error,
  scopes: scopeOptions,
  showScopes,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: { name: string; scopes?: string[]; expiresAt?: string }) => void;
  isSubmitting: boolean;
  error?: Error | null;
  scopes?: ScopeOption[];
  showScopes: boolean;
}) {
  const [name, setName] = useState("");
  const [selectedScopes, setSelectedScopes] = useState<string[]>(
    scopeOptions?.filter((_, i) => i < 2).map((s) => s.value) || []
  );
  const [hasExpiry, setHasExpiry] = useState(false);
  const [expiresAt, setExpiresAt] = useState("");

  // Default to 1 year from now for expiry input
  const defaultExpiry = new Date();
  defaultExpiry.setFullYear(defaultExpiry.getFullYear() + 1);
  const defaultExpiryStr = defaultExpiry.toISOString().split("T")[0];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      name,
      scopes: showScopes ? selectedScopes : undefined,
      expiresAt: hasExpiry && expiresAt ? new Date(expiresAt).toISOString() : undefined,
    });
    // Reset form
    setName("");
    setSelectedScopes(scopeOptions?.filter((_, i) => i < 2).map((s) => s.value) || []);
    setHasExpiry(false);
    setExpiresAt("");
  };

  const toggleScope = (scope: string) => {
    if (selectedScopes.includes(scope)) {
      setSelectedScopes(selectedScopes.filter((s) => s !== scope));
    } else {
      setSelectedScopes([...selectedScopes, scope]);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create {showScopes ? "API Key" : "Token"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>{showScopes ? "Key" : "Token"} Name</Label>
            <Input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={showScopes ? "e.g., Production API" : "e.g., CI/CD Pipeline"}
              required
            />
            <p className="text-xs text-muted-foreground">
              A descriptive name to identify this {showScopes ? "key" : "token"}.
            </p>
          </div>

          {showScopes && scopeOptions && (
            <div className="space-y-2">
              <Label>Scopes</Label>
              <div className="flex gap-4 flex-wrap">
                {scopeOptions.map((scope) => (
                  <div key={scope.value} className="flex items-center gap-2">
                    <Checkbox
                      id={`scope-${scope.value}`}
                      checked={selectedScopes.includes(scope.value)}
                      onCheckedChange={() => toggleScope(scope.value)}
                    />
                    <Label htmlFor={`scope-${scope.value}`} className="text-sm font-normal capitalize">
                      {scope.label}
                    </Label>
                  </div>
                ))}
              </div>
              {scopeOptions[0]?.description && (
                <p className="text-xs text-muted-foreground">
                  {scopeOptions.map((s) => s.description).join(". ")}
                </p>
              )}
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Checkbox
                id="hasExpiry"
                checked={hasExpiry}
                onCheckedChange={(checked) => setHasExpiry(checked === true)}
              />
              <Label htmlFor="hasExpiry" className="text-sm font-normal">
                Set expiration date
              </Label>
            </div>
            {hasExpiry && (
              <Input
                type="date"
                value={expiresAt || defaultExpiryStr}
                onChange={(e) => setExpiresAt(e.target.value)}
                min={new Date().toISOString().split("T")[0]}
              />
            )}
          </div>

          {error && (
            <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
              <p className="text-sm text-destructive">{error.message}</p>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting || !name || (showScopes && selectedScopes.length === 0)}
            >
              {isSubmitting ? "Creating..." : `Create ${showScopes ? "Key" : "Token"}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// New Key Display Modal
function NewKeyModal({
  apiKey,
  onClose,
  showScopes,
}: {
  apiKey: ApiKeyWithSecret;
  onClose: () => void;
  showScopes: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const secretValue = apiKey.token || apiKey.apiKey || "";

  const handleCopy = () => {
    navigator.clipboard.writeText(secretValue);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog open={true} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{showScopes ? "API Key" : "Token"} Created</DialogTitle>
        </DialogHeader>

        {/* Warning */}
        <InfoBox icon={AlertTriangle} variant="warning" title={`Copy your ${showScopes ? "API key" : "token"} now`}>
          This is the only time you'll see this {showScopes ? "key" : "token"}. Store it securely - you won't be able to see it again.
        </InfoBox>

        <div className="space-y-4">
          <div>
            <Label className="text-xs uppercase text-muted-foreground">{showScopes ? "Key" : "Token"} Name</Label>
            <p className="text-sm text-foreground">{apiKey.name}</p>
          </div>

          <div>
            <Label className="text-xs uppercase text-muted-foreground">{showScopes ? "API Key" : "Token"}</Label>
            <div className="flex items-center gap-2 mt-1">
              <code className="flex-1 text-sm font-mono bg-muted text-foreground px-3 py-2 rounded-lg break-all">
                {secretValue}
              </code>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleCopy}
                title="Copy to clipboard"
              >
                {copied ? (
                  <Check className="w-5 h-5 text-success" />
                ) : (
                  <Copy className="w-5 h-5" />
                )}
              </Button>
            </div>
          </div>

          {showScopes && apiKey.scopes && apiKey.scopes.length > 0 && (
            <div>
              <Label className="text-xs uppercase text-muted-foreground">Scopes</Label>
              <div className="flex gap-2 mt-1">
                {apiKey.scopes.map((scope) => (
                  <span key={scope} className="text-xs bg-muted text-muted-foreground px-2 py-1 rounded">
                    {scope}
                  </span>
                ))}
              </div>
            </div>
          )}

          {apiKey.expiresAt && (
            <div>
              <Label className="text-xs uppercase text-muted-foreground">Expires</Label>
              <p className="text-sm text-muted-foreground">
                {new Date(apiKey.expiresAt).toLocaleDateString()}
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
