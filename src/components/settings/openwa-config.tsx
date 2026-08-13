'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Copy,
  Plus,
  QrCode,
  Play,
  RotateCcw,
  Save,
  Trash2,
  RefreshCw,
  Smartphone,
  AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { SettingsPanelHead } from './settings-panel-head';
import { useAuth } from '@/hooks/use-auth';

interface OpenWASession {
  id: string;
  openwa_session_id: string;
  name: string;
  phone: string | null;
  push_name: string | null;
  status: string;
}

interface ConfigPayload {
  configured: boolean;
  status?: string;
  api_url?: string;
  sessions?: OpenWASession[];
}

const MASKED_KEY = '••••••••••••••••••••••';

function statusTone(status: string): 'ok' | 'warn' | 'bad' {
  if (status === 'ready' || status === 'connected') return 'ok';
  if (status === 'pending' || status === 'qr_ready' || status === 'created') return 'warn';
  return 'bad';
}

export function OpenWAConfig() {
  const { accountId, user, loading: authLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState<ConfigPayload | null>(null);

  // Gateway form
  const [apiUrl, setApiUrl] = useState('http://localhost:2785/api');
  const [apiKey, setApiKey] = useState('');
  const [keyEdited, setKeyEdited] = useState(false);
  const loadedAccountRef = useRef<string | null>(null);

  // Session creation
  const [sessionName, setSessionName] = useState('');
  const [creatingSession, setCreatingSession] = useState(false);

  // Per-session busy flags
  const [startingId, setStartingId] = useState<string | null>(null);
  const [qrSessionId, setQrSessionId] = useState<string | null>(null);
  const [qrData, setQrData] = useState<string | null>(null);
  const [qrStatus, setQrStatus] = useState('');
  const [qrLoading, setQrLoading] = useState(false);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [gatewayError, setGatewayError] = useState('');

  const webhookUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/api/openwa/webhook`
      : '';

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/openwa/config', { method: 'GET' });
      const data = (await res.json()) as ConfigPayload;
      if (!res.ok) {
        setGatewayError((data as { error?: string }).error ?? 'Failed to load config');
      } else {
        setGatewayError('');
      }
      setConfig(data);
      if (data.configured && data.api_url) setApiUrl(data.api_url);
    } catch (err) {
      console.error('fetchConfig error:', err);
      toast.error('Failed to load OpenWA configuration');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!user || !accountId) {
      loadedAccountRef.current = null;
      setLoading(false);
      return;
    }
    if (loadedAccountRef.current === accountId) return;
    loadedAccountRef.current = accountId;
    void fetchConfig();
  }, [authLoading, user?.id, accountId, fetchConfig]);

  async function handleSaveGateway() {
    if (!apiUrl.trim() || !/^https?:\/\//.test(apiUrl.trim())) {
      toast.error('Enter a valid gateway URL (http://…)');
      return;
    }
    if (!keyEdited || !apiKey.trim()) {
      toast.error('Enter the OpenWA API key');
      return;
    }
    try {
      setSaving(true);
      const res = await fetch('/api/openwa/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_url: apiUrl.trim(), api_key: apiKey.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Failed to save configuration');
        return;
      }
      toast.success('OpenWA gateway saved');
      setApiKey('');
      setKeyEdited(false);
      await fetchConfig();
    } catch (err) {
      console.error('Save error:', err);
      toast.error('Failed to save configuration');
    } finally {
      setSaving(false);
    }
  }

  async function handleResetGateway() {
    if (!confirm('This will delete the OpenWA config and all sessions. Continue?')) return;
    try {
      const res = await fetch('/api/openwa/config', { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || 'Failed to reset');
        return;
      }
      toast.success('OpenWA configuration cleared');
      setApiKey('');
      setKeyEdited(false);
      setQrData(null);
      setQrSessionId(null);
      await fetchConfig();
    } catch (err) {
      console.error('Reset error:', err);
      toast.error('Failed to reset configuration');
    }
  }

  async function handleCreateSession() {
    if (!sessionName.trim()) {
      toast.error('Session name is required');
      return;
    }
    try {
      setCreatingSession(true);
      const res = await fetch('/api/openwa/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: sessionName.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Failed to create session');
        return;
      }
      toast.success(`Session "${sessionName}" created — start it and scan the QR.`);
      setSessionName('');
      await fetchConfig();
    } catch (err) {
      console.error('Create session error:', err);
      toast.error('Failed to create session');
    } finally {
      setCreatingSession(false);
    }
  }

  async function handleStartSession(sessionId: string) {
    try {
      setStartingId(sessionId);
      const res = await fetch(`/api/openwa/session/${sessionId}/start`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Failed to start session');
        return;
      }
      toast.success('Session started — scan the QR in WhatsApp to pair.');
      await fetchConfig();
    } catch (err) {
      console.error('Start error:', err);
      toast.error('Failed to start session');
    } finally {
      setStartingId(null);
    }
  }

  async function handleShowQr(sessionId: string) {
    try {
      setQrLoading(true);
      setQrSessionId(sessionId);
      setQrData(null);
      const res = await fetch(`/api/openwa/session/${sessionId}/qr`, {
        method: 'GET',
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Failed to fetch QR');
        setQrData(null);
        return;
      }
      setQrData(data.qr_code ?? null);
      setQrStatus(data.status ?? '');
      if (!data.qr_code) {
        toast.error('No QR available yet — start the session first.');
      }
    } catch (err) {
      console.error('QR error:', err);
      toast.error('Failed to fetch QR');
    } finally {
      setQrLoading(false);
    }
  }

  async function handleRefreshSession(sessionId: string) {
    try {
      setRefreshingId(sessionId);
      const res = await fetch(`/api/openwa/session/${sessionId}`, { method: 'GET' });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || 'Failed to refresh session');
        return;
      }
      await fetchConfig();
    } catch (err) {
      console.error('Refresh error:', err);
      toast.error('Failed to refresh session');
    } finally {
      setRefreshingId(null);
    }
  }

  async function handleDeleteSession(sessionId: string) {
    if (!confirm('Delete this session? It will be stopped on the gateway and removed.')) return;
    try {
      setDeletingId(sessionId);
      const res = await fetch(`/api/openwa/session/${sessionId}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Failed to delete session');
        return;
      }
      if (qrSessionId === sessionId) {
        setQrData(null);
        setQrSessionId(null);
      }
      toast.success('Session deleted');
      await fetchConfig();
    } catch (err) {
      console.error('Delete error:', err);
      toast.error('Failed to delete session');
    } finally {
      setDeletingId(null);
    }
  }

  function handleCopyWebhookUrl() {
    navigator.clipboard.writeText(webhookUrl);
    toast.success('Webhook URL copied to clipboard');
  }

  const configured = config?.configured === true;
  const gatewayStatus = config?.status ?? 'not_configured';
  const tone = statusTone(gatewayStatus);
  const sessions = config?.sessions ?? [];

  if (loading) {
    return (
      <section className="animate-in fade-in-50 duration-200">
        <SettingsPanelHead title="OpenWA" description="Configure your free WhatsApp line." />
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      </section>
    );
  }

  return (
    <section className="animate-in fade-in-50 duration-200">
      <SettingsPanelHead
        title="OpenWA"
        description="Free WhatsApp line via the OpenWA gateway. No per-message fees, no Meta templates — great for the opt-in secondary line and bulk campaigns."
      />

      <div className="space-y-6">
        {/* Gateway status */}
        <Alert className="bg-card border-border">
          <div className="flex items-center gap-2">
            {tone === 'ok' ? (
              <CheckCircle2 className="size-4 text-emerald-400" />
            ) : tone === 'warn' ? (
              <AlertTriangle className="size-4 text-amber-400" />
            ) : (
              <XCircle className="size-4 text-red-500" />
            )}
            <AlertTitle className="text-foreground mb-0">
              {configured ? `Gateway ${gatewayStatus}` : 'Not configured'}
            </AlertTitle>
          </div>
          <AlertDescription className="text-muted-foreground">
            {configured
              ? `Pointing at ${config?.api_url}. Pair a session below, then scan its QR with WhatsApp.`
              : 'Enter the OpenWA gateway URL and API key to begin.'}
            {gatewayError && (
              <span className="mt-1 block text-red-400">{gatewayError}</span>
            )}
          </AlertDescription>
        </Alert>

        {/* Gateway config */}
        <Card>
          <CardHeader>
            <CardTitle className="text-foreground">Gateway</CardTitle>
            <CardDescription className="text-muted-foreground">
              The OpenWA REST API your server talks to (defaults to localhost:2785).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label className="text-muted-foreground">API URL</Label>
              <Input
                placeholder="http://localhost:2785/api"
                value={apiUrl}
                onChange={(e) => setApiUrl(e.target.value)}
                className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-muted-foreground">API Key</Label>
              <Input
                type="password"
                placeholder={configured ? 'Leave blank to keep the stored key' : 'Enter the OpenWA API key'}
                value={configured && !keyEdited ? MASKED_KEY : apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  setKeyEdited(true);
                }}
                onFocus={() => {
                  if (configured && !keyEdited) {
                    setApiKey('');
                    setKeyEdited(true);
                  }
                }}
                className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
              />
              {configured && !keyEdited && (
                <p className="text-xs text-muted-foreground">
                  Stored key is hidden. Re-enter it to change it.
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-3">
              <Button
                onClick={handleSaveGateway}
                disabled={saving || !configured && !apiKey.trim()}
                className="bg-primary hover:bg-primary/90 text-primary-foreground"
              >
                {saving ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Save className="size-4" />
                )}
                Save gateway
              </Button>
              {configured && (
                <Button
                  variant="outline"
                  onClick={handleResetGateway}
                  className="border-red-900 text-red-400 hover:text-red-300 hover:bg-red-950/40"
                >
                  <RotateCcw className="size-4" />
                  Reset
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Sessions */}
        <Card>
          <CardHeader>
            <CardTitle className="text-foreground">WhatsApp lines</CardTitle>
            <CardDescription className="text-muted-foreground">
              Each line pairs with one WhatsApp number via QR. Messages from any line land in conversations scoped to OpenWA.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!configured ? (
              <p className="text-sm text-muted-foreground">
                Save the gateway configuration first to add lines.
              </p>
            ) : sessions.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No lines yet. Create one below.
              </p>
            ) : (
              <ul className="space-y-3">
                {sessions.map((s) => {
                  const sTone = statusTone(s.status);
                  return (
                    <li
                      key={s.id}
                      className="rounded-lg border border-border bg-card/60 p-3 space-y-2"
                    >
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-2 min-w-0">
                          <Smartphone className="size-4 text-muted-foreground shrink-0" />
                          <span className="font-medium text-foreground truncate">
                            {s.name}
                          </span>
                          <span
                            className={
                              'text-xs px-2 py-0.5 rounded-full border ' +
                              (sTone === 'ok'
                                ? 'border-emerald-700/50 bg-emerald-950/40 text-emerald-300'
                                : sTone === 'warn'
                                  ? 'border-amber-700/50 bg-amber-950/40 text-amber-300'
                                  : 'border-red-900/50 bg-red-950/40 text-red-300')
                            }
                          >
                            {s.status}
                          </span>
                        </div>
                        {s.phone && (
                          <span className="text-xs text-muted-foreground font-mono">
                            {s.phone}
                          </span>
                        )}
                      </div>

                      {qrSessionId === s.id && qrData && (
                        <div className="flex items-start gap-3 rounded border border-border bg-card p-3">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={qrData}
                            alt="WhatsApp pairing QR"
                            className="size-36 shrink-0 rounded bg-white"
                          />
                          <div className="text-xs text-muted-foreground space-y-1">
                            <p className="text-foreground font-medium">Scan with WhatsApp</p>
                            <p>WhatsApp &gt; Settings &gt; Linked devices &gt; Link a device.</p>
                            <p>Status: {qrStatus || 'pending'}. The QR refreshes — re-open it if it expires.</p>
                          </div>
                        </div>
                      )}

                      <div className="flex flex-wrap gap-2">
                        {s.status !== 'ready' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleStartSession(s.id)}
                            disabled={startingId === s.id}
                            className="border-border text-muted-foreground hover:text-foreground hover:bg-muted"
                          >
                            {startingId === s.id ? (
                              <Loader2 className="size-3.5 animate-spin" />
                            ) : (
                              <Play className="size-3.5" />
                            )}
                            Start
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleShowQr(s.id)}
                          disabled={qrLoading}
                          className="border-border text-muted-foreground hover:text-foreground hover:bg-muted"
                        >
                          {qrLoading && qrSessionId === s.id ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <QrCode className="size-3.5" />
                          )}
                          QR
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleRefreshSession(s.id)}
                          disabled={refreshingId === s.id}
                          className="border-border text-muted-foreground hover:text-foreground hover:bg-muted"
                        >
                          {refreshingId === s.id ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <RefreshCw className="size-3.5" />
                          )}
                          Refresh
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleDeleteSession(s.id)}
                          disabled={deletingId === s.id}
                          className="border-red-900 text-red-400 hover:text-red-300 hover:bg-red-950/40"
                        >
                          {deletingId === s.id ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="size-3.5" />
                          )}
                          Delete
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            {/* Create session */}
            {configured && (
              <div className="flex gap-2">
                <Input
                  placeholder="Line name (e.g. sales-line-2)"
                  value={sessionName}
                  onChange={(e) => setSessionName(e.target.value)}
                  className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                />
                <Button
                  onClick={handleCreateSession}
                  disabled={creatingSession || !sessionName.trim()}
                  className="shrink-0 bg-primary hover:bg-primary/90 text-primary-foreground"
                >
                  {creatingSession ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Plus className="size-4" />
                  )}
                  Add line
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Webhook URL */}
        <Card>
          <CardHeader>
            <CardTitle className="text-foreground">Webhook</CardTitle>
            <CardDescription className="text-muted-foreground">
              Register this URL on your OpenWA gateway so inbound messages and status events reach WACRM.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2">
              <Input
                readOnly
                value={webhookUrl}
                className="bg-muted border-border text-muted-foreground font-mono text-sm"
              />
              <Button
                variant="outline"
                size="icon"
                onClick={handleCopyWebhookUrl}
                className="shrink-0 border-border text-muted-foreground hover:text-foreground hover:bg-muted"
              >
                <Copy className="size-4" />
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Signed with the <code className="text-muted-foreground">OPENWA_WEBHOOK_SECRET</code> env var (HMAC-SHA256) if set.
            </p>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
