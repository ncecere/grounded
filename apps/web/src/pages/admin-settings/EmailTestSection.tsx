import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormSection } from "@/components/ui/form-section";
import { CheckCircle, XCircle, Mail } from "lucide-react";

export function EmailTestSection() {
  const [testEmail, setTestEmail] = useState("");
  const [verifyResult, setVerifyResult] = useState<{ success: boolean; message: string } | null>(null);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const verifyMutation = useMutation({
    mutationFn: () => api.verifySmtp(),
    onSuccess: (data) => setVerifyResult(data),
    onError: (error) => setVerifyResult({ success: false, message: error.message }),
  });

  const testMutation = useMutation({
    mutationFn: (email: string) => api.sendTestEmail(email),
    onSuccess: (data) => setTestResult(data),
    onError: (error) => setTestResult({ success: false, message: error.message }),
  });

  return (
    <FormSection
      title="Test Email Configuration"
      description="Verify your SMTP settings and send a test email."
      className="mt-6"
    >
      {/* Verify Connection */}
      <div className="py-4 border-b border-border">
        <h3 className="text-sm font-medium text-foreground mb-2">1. Verify SMTP Connection</h3>
        <div className="flex items-center gap-4">
          <Button
            variant="outline"
            onClick={() => verifyMutation.mutate()}
            disabled={verifyMutation.isPending}
          >
            {verifyMutation.isPending ? "Verifying..." : "Verify Connection"}
          </Button>
          {verifyResult && (
            <div className={`flex items-center gap-2 text-sm ${verifyResult.success ? "text-success" : "text-destructive"}`}>
              {verifyResult.success ? (
                <CheckCircle className="w-4 h-4" />
              ) : (
                <XCircle className="w-4 h-4" />
              )}
              {verifyResult.message}
            </div>
          )}
        </div>
      </div>

      {/* Send Test Email */}
      <div className="py-4">
        <h3 className="text-sm font-medium text-foreground mb-2">2. Send Test Email</h3>
        <div className="flex items-center gap-4">
          <Input
            type="email"
            placeholder="Enter email address"
            value={testEmail}
            onChange={(e) => setTestEmail(e.target.value)}
            className="w-64"
          />
          <Button
            onClick={() => testMutation.mutate(testEmail)}
            disabled={testMutation.isPending || !testEmail}
          >
            <Mail className="w-4 h-4 mr-2" />
            {testMutation.isPending ? "Sending..." : "Send Test Email"}
          </Button>
        </div>
        {testResult && (
          <div className={`mt-2 flex items-center gap-2 text-sm ${testResult.success ? "text-success" : "text-destructive"}`}>
            {testResult.success ? (
              <CheckCircle className="w-4 h-4" />
            ) : (
              <XCircle className="w-4 h-4" />
            )}
            {testResult.message}
          </div>
        )}
      </div>
    </FormSection>
  );
}
