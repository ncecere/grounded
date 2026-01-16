import { useState } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ChevronDown } from "lucide-react";

export interface QuotaOverrides {
  maxKbs?: number;
  maxAgents?: number;
  maxUploadedDocsPerMonth?: number;
  maxScrapedPagesPerMonth?: number;
  maxCrawlConcurrency?: number;
  chatRateLimitPerMinute?: number;
}

const defaultQuotas: Required<QuotaOverrides> = {
  maxKbs: 10,
  maxAgents: 10,
  maxUploadedDocsPerMonth: 1000,
  maxScrapedPagesPerMonth: 1000,
  maxCrawlConcurrency: 5,
  chatRateLimitPerMinute: 60,
};

interface CreateTenantModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: { name: string; slug: string; ownerEmail?: string; quotas?: QuotaOverrides }) => void;
  isLoading: boolean;
  error?: string;
}

export function CreateTenantModal({
  open,
  onOpenChange,
  onSubmit,
  isLoading,
  error,
}: CreateTenantModalProps) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [quotaSettingsOpen, setQuotaSettingsOpen] = useState(false);
  const [quotas, setQuotas] = useState<QuotaOverrides>({});

  const handleNameChange = (value: string) => {
    setName(value);
    setSlug(value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""));
  };

  const handleQuotaChange = (key: keyof QuotaOverrides, value: string) => {
    const numValue = parseInt(value, 10);
    if (isNaN(numValue) || value === "") {
      const newQuotas = { ...quotas };
      delete newQuotas[key];
      setQuotas(newQuotas);
    } else {
      setQuotas({ ...quotas, [key]: numValue });
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      name,
      slug,
      ownerEmail: ownerEmail || undefined,
      quotas: Object.keys(quotas).length > 0 ? quotas : undefined,
    });
  };

  const resetForm = () => {
    setName("");
    setSlug("");
    setOwnerEmail("");
    setQuotas({});
    setQuotaSettingsOpen(false);
  };

  return (
    <Dialog 
      open={open} 
      onOpenChange={(newOpen) => {
        if (!newOpen) resetForm();
        onOpenChange(newOpen);
      }}
    >
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create New Tenant</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Tenant Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="Acme Corp"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="slug">Slug</Label>
            <Input
              id="slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
              placeholder="acme-corp"
              pattern="[a-z0-9-]+"
              required
            />
            <p className="text-xs text-muted-foreground">
              URL-friendly identifier. Lowercase letters, numbers, and hyphens only.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="ownerEmail">Owner Email (optional)</Label>
            <Input
              id="ownerEmail"
              type="email"
              value={ownerEmail}
              onChange={(e) => setOwnerEmail(e.target.value)}
              placeholder="owner@example.com"
            />
            <p className="text-xs text-muted-foreground">
              If specified, this user will be the owner. Otherwise, you become the owner.
            </p>
          </div>

          {/* Quota Settings - Collapsible */}
          <Collapsible open={quotaSettingsOpen} onOpenChange={setQuotaSettingsOpen}>
            <div className="pt-4 border-t border-border">
              <CollapsibleTrigger className="flex items-center justify-between w-full py-2 text-left">
                <h3 className="text-sm font-medium text-foreground">Quota Settings</h3>
                <ChevronDown
                  className={`w-5 h-5 text-muted-foreground transition-transform ${quotaSettingsOpen ? "rotate-180" : ""}`}
                />
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-3">
                <p className="text-xs text-muted-foreground mb-4">
                  Override default quota limits for this tenant. Leave empty to use system defaults.
                </p>
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Max Knowledge Bases</Label>
                      <Input
                        type="number"
                        value={quotas.maxKbs ?? ""}
                        onChange={(e) => handleQuotaChange("maxKbs", e.target.value)}
                        placeholder={String(defaultQuotas.maxKbs)}
                        min="1"
                        max="1000"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Max Agents</Label>
                      <Input
                        type="number"
                        value={quotas.maxAgents ?? ""}
                        onChange={(e) => handleQuotaChange("maxAgents", e.target.value)}
                        placeholder={String(defaultQuotas.maxAgents)}
                        min="1"
                        max="1000"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Uploads / Month</Label>
                      <Input
                        type="number"
                        value={quotas.maxUploadedDocsPerMonth ?? ""}
                        onChange={(e) => handleQuotaChange("maxUploadedDocsPerMonth", e.target.value)}
                        placeholder={String(defaultQuotas.maxUploadedDocsPerMonth)}
                        min="1"
                        max="100000"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Pages Scraped / Month</Label>
                      <Input
                        type="number"
                        value={quotas.maxScrapedPagesPerMonth ?? ""}
                        onChange={(e) => handleQuotaChange("maxScrapedPagesPerMonth", e.target.value)}
                        placeholder={String(defaultQuotas.maxScrapedPagesPerMonth)}
                        min="1"
                        max="100000"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Crawl Concurrency</Label>
                      <Input
                        type="number"
                        value={quotas.maxCrawlConcurrency ?? ""}
                        onChange={(e) => handleQuotaChange("maxCrawlConcurrency", e.target.value)}
                        placeholder={String(defaultQuotas.maxCrawlConcurrency)}
                        min="1"
                        max="50"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Chat Rate / Min</Label>
                      <Input
                        type="number"
                        value={quotas.chatRateLimitPerMinute ?? ""}
                        onChange={(e) => handleQuotaChange("chatRateLimitPerMinute", e.target.value)}
                        placeholder={String(defaultQuotas.chatRateLimitPerMinute)}
                        min="1"
                        max="1000"
                      />
                    </div>
                  </div>
                </div>
              </CollapsibleContent>
            </div>
          </Collapsible>

          {error && (
            <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isLoading || !name || !slug}
            >
              {isLoading ? "Creating..." : "Create Tenant"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
