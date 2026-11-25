import { ArrowRight, KeyRound, Lock, Mail, ShieldCheck } from 'lucide-react';
import QRCode from 'qrcode';
import React, { useEffect, useState } from 'react';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Input, Label } from '../../components/ui/input';
import { recordSecurityEvent } from '../core/repository';
import { getSupabaseClient, isSupabaseConfigured } from '../core/supabase';
import type { AuthSessionState } from '../core/types';
import {
  buildOtpAuthUri,
  generateBase32Secret,
  generateTOTPCode,
  verifyTOTPCode,
} from './totp';

interface LoginScreenProps {
  onAuthenticated: (session: AuthSessionState) => void;
}

type AuthStep = 'credentials' | 'mfa_enroll' | 'mfa_verify';

export const LoginScreen: React.FC<LoginScreenProps> = ({ onAuthenticated }) => {
  const [step, setStep] = useState<AuthStep>('credentials');
  const [email, setEmail] = useState('comoequetala@gmail.com');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // MFA enrollment / challenge state
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [mfaSecret, setMfaSecret] = useState<string>('');
  const [supabaseFactorId, setSupabaseFactorId] = useState<string>('');
  const [pendingSession, setPendingSession] = useState<AuthSessionState | null>(null);
  const [sandboxCurrentCode, setSandboxCurrentCode] = useState<string>('');

  useEffect(() => {
    if (isSupabaseConfigured || !mfaSecret) return;
    let active = true;
    const refreshPreviewCode = async () => {
      const code = await generateTOTPCode(mfaSecret);
      if (active) setSandboxCurrentCode(code);
    };
    void refreshPreviewCode();
    const timer = setInterval(() => void refreshPreviewCode(), 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [mfaSecret]);

  const handleCredentialsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const trimmedEmail = email.trim().toLowerCase();

    if (!trimmedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setError('Informe um e-mail corporativo válido.');
      return;
    }

    setLoading(true);
    try {
      if (isSupabaseConfigured) {
        if (!password) {
          throw new Error('Informe sua senha de acesso.');
        }
        const supabase = getSupabaseClient();
        if (!supabase) throw new Error('Cliente Supabase indisponível.');

        const { data, error: signInError } = await supabase.auth.signInWithPassword({
          email: trimmedEmail,
          password,
        });
        if (signInError || !data.user) {
          throw new Error(
            signInError?.message ?? 'Credenciais inválidas ou usuário não convidado.'
          );
        }

        const { data: aalData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
        const { data: factorsData } = await supabase.auth.mfa.listFactors();
        const verifiedTotp = factorsData?.totp?.find((f) => f.status === 'verified');

        const baseSession: AuthSessionState = {
          mode: 'supabase',
          userId: data.user.id,
          email: data.user.email ?? trimmedEmail,
          fullName:
            (data.user.user_metadata?.full_name as string | undefined) ??
            trimmedEmail.split('@')[0] ??
            'Titular',
          role: 'owner',
          mfaVerified: aalData?.currentLevel === 'aal2',
          mfaEnrolled: Boolean(verifiedTotp),
          aal: (aalData?.currentLevel as 'aal1' | 'aal2') ?? 'aal1',
        };

        await recordSecurityEvent(baseSession.userId, baseSession.email, 'auth.login', 'session', null, {
          aal: baseSession.aal,
        });

        if (verifiedTotp && aalData?.currentLevel === 'aal2') {
          onAuthenticated(baseSession);
          return;
        }

        if (verifiedTotp) {
          setPendingSession(baseSession);
          setSupabaseFactorId(verifiedTotp.id);
          setStep('mfa_verify');
          return;
        }

        // First access: enforce TOTP enrollment
        const { data: enrollData, error: enrollErr } = await supabase.auth.mfa.enroll({
          factorType: 'totp',
          friendlyName: 'Vértice Authenticator',
        });
        if (enrollErr || !enrollData) {
          throw new Error(enrollErr?.message ?? 'Não foi possível iniciar o registro 2FA.');
        }

        setPendingSession(baseSession);
        setSupabaseFactorId(enrollData.id);
        setQrDataUrl(enrollData.totp.qr_code);
        setMfaSecret(enrollData.totp.secret);
        setStep('mfa_enroll');
        return;
      }

      // Sandbox Mode (when Supabase .env variables are not yet configured)
      if (!password || password.length < 4) {
        throw new Error('Informe uma senha com pelo menos 4 caracteres para a sessão local.');
      }

      const sandboxTenantId = '00000000-0000-4000-8000-000000000001';
      const storageMfaKey = `vertice_sandbox_totp_${trimmedEmail}`;
      const existingSecret = localStorage.getItem(storageMfaKey);

      const baseSession: AuthSessionState = {
        mode: 'sandbox',
        userId: sandboxTenantId,
        email: trimmedEmail,
        fullName: trimmedEmail.split('@')[0] ?? 'Titular',
        role: 'owner',
        mfaVerified: false,
        mfaEnrolled: Boolean(existingSecret),
        aal: 'aal1',
      };

      setPendingSession(baseSession);

      if (existingSecret) {
        setMfaSecret(existingSecret);
        setStep('mfa_verify');
      } else {
        const freshSecret = generateBase32Secret();
        const uri = buildOtpAuthUri(trimmedEmail, freshSecret);
        const qr = await QRCode.toDataURL(uri, { margin: 1, width: 184 });
        setMfaSecret(freshSecret);
        setQrDataUrl(qr);
        setStep('mfa_enroll');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao autenticar.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyMfa = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingSession) return;
    setError(null);
    const cleanedCode = totpCode.replace(/\s+/g, '');
    if (!/^\d{6}$/.test(cleanedCode)) {
      setError('Digite o código TOTP de 6 dígitos.');
      return;
    }

    setLoading(true);
    try {
      if (isSupabaseConfigured) {
        const supabase = getSupabaseClient();
        if (!supabase) throw new Error('Cliente Supabase indisponível.');

        const { error: verifyErr } = await supabase.auth.mfa.challengeAndVerify({
          factorId: supabaseFactorId,
          code: cleanedCode,
        });
        if (verifyErr) {
          throw new Error('Código TOTP inválido ou expirado. Tente novamente.');
        }

        const eventAction = step === 'mfa_enroll' ? 'auth.mfa_enrolled' : 'auth.mfa_verified';
        await recordSecurityEvent(pendingSession.userId, pendingSession.email, eventAction, 'mfa', null, {
          factor_type: 'totp',
        });

        onAuthenticated({
          ...pendingSession,
          mfaEnrolled: true,
          mfaVerified: true,
          aal: 'aal2',
        });
        return;
      }

      // Sandbox RFC-6238 verification
      const valid = await verifyTOTPCode(mfaSecret, cleanedCode);
      if (!valid) {
        throw new Error('Código 2FA inválido. Confira os 6 dígitos do autenticador.');
      }

      if (step === 'mfa_enroll') {
        localStorage.setItem(`vertice_sandbox_totp_${pendingSession.email}`, mfaSecret);
        await recordSecurityEvent(
          pendingSession.userId,
          pendingSession.email,
          'auth.mfa_enrolled',
          'mfa',
          null,
          { factor_type: 'totp', mode: 'sandbox' }
        );
      } else {
        await recordSecurityEvent(
          pendingSession.userId,
          pendingSession.email,
          'auth.mfa_verified',
          'mfa',
          null,
          { factor_type: 'totp', mode: 'sandbox' }
        );
      }

      onAuthenticated({
        ...pendingSession,
        mfaEnrolled: true,
        mfaVerified: true,
        aal: 'aal2',
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro na validação 2FA.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8 dark:bg-slate-950 flex items-center justify-center">
      <div className="mx-auto grid w-full max-w-5xl grid-cols-1 gap-8 lg:grid-cols-12 lg:items-center">
        {/* Coluna institucional esquerda */}
        <div className="lg:col-span-6 space-y-6">
          <div className="flex items-center gap-3">
            <img
              src="/icon.svg"
              alt="Vértice Finanças"
              className="h-10 w-10 rounded-xl border border-slate-200 dark:border-slate-800"
            />
            <div>
              <span className="font-display text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100">
                Vértice
              </span>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Inteligência Financeira &amp; Viabilidade
              </p>
            </div>
          </div>

          <div className="space-y-3">
            <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl dark:text-slate-100 text-balance">
              Fundação financeira privada com anonimização por padrão.
            </h1>
            <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-400 max-w-lg">
              Ambiente estritamente restrito a titulares convidados. Todas as empresas, contas e
              grupos recebem tokens analíticos imutáveis isolados por Row Level Security.
            </p>
          </div>

          <div className="divide-y divide-slate-200 border-y border-slate-200 text-sm dark:divide-slate-800 dark:border-slate-800">
            <div className="flex items-start gap-3 py-3.5">
              <Lock className="mt-0.5 h-4 w-4 shrink-0 text-teal-700 dark:text-teal-400" />
              <div>
                <p className="font-medium text-slate-900 dark:text-slate-100">
                  Acesso Invite-Only &amp; 2FA (TOTP)
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Cadastro público desativado no banco. Sessões exigem autenticação em duas etapas.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3 py-3.5">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-teal-700 dark:text-teal-400" />
              <div>
                <p className="font-medium text-slate-900 dark:text-slate-100">
                  Cofre de Anonimização Isolado
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Razões sociais e CNPJs são substituídos por tokens (<span className="font-mono">EMP_01</span>,{' '}
                  <span className="font-mono">CTA_01</span>) antes de qualquer análise externa.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Coluna de autenticação direita */}
        <div className="lg:col-span-6">
          <Card className="mx-auto w-full max-w-md shadow-xs">
            <CardHeader>
              <div className="flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
                <span>
                  {isSupabaseConfigured ? 'Conexão Supabase Ativa' : 'Modo Sandbox Local'}
                </span>
                <span>Módulo 1 · Acesso Restrito</span>
              </div>
              <CardTitle className="pt-1 text-xl">
                {step === 'credentials' && 'Entrar no Cofre Corporativo'}
                {step === 'mfa_enroll' && 'Configurar 2FA Obrigatório'}
                {step === 'mfa_verify' && 'Verificação em Duas Etapas'}
              </CardTitle>
              <CardDescription>
                {step === 'credentials' &&
                  'Apenas contas previamente convidadas pelo administrador têm acesso autorizado.'}
                {step === 'mfa_enroll' &&
                  'Escaneie o QR Code no seu aplicativo autenticador e informe o código de 6 dígitos.'}
                {step === 'mfa_verify' &&
                  'Informe o código temporário TOTP de 6 dígitos para elevar sua sessão para AAL2.'}
              </CardDescription>
            </CardHeader>

            <CardContent>
              {!isSupabaseConfigured && step === 'credentials' && (
                <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
                  Variáveis <span className="font-mono">VITE_SUPABASE_URL</span> e{' '}
                  <span className="font-mono">VITE_SUPABASE_ANON_KEY</span> não configuradas. A
                  sessão abaixo opera em Sandbox Local com TOTP real e armazenamento isolado no navegador.
                </div>
              )}

              {error && (
                <div
                  role="alert"
                  className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs font-medium text-rose-800 dark:border-rose-900 dark:bg-rose-950/60 dark:text-rose-200"
                >
                  {error}
                </div>
              )}

              {step === 'credentials' && (
                <form onSubmit={handleCredentialsSubmit} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="login-email">E-mail autorizado</Label>
                    <div className="relative">
                      <Mail className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
                      <Input
                        id="login-email"
                        type="email"
                        required
                        autoComplete="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="diretoria@suaempresa.com.br"
                        className="pl-9"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="login-password">Senha</Label>
                    <div className="relative">
                      <KeyRound className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
                      <Input
                        id="login-password"
                        type="password"
                        required
                        autoComplete="current-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••••"
                        className="pl-9"
                      />
                    </div>
                  </div>

                  <Button type="submit" variant="primary" className="w-full" disabled={loading}>
                    {loading ? 'Validando convite...' : 'Continuar para 2FA'}
                    <ArrowRight className="h-4 w-4" />
                  </Button>

                  <p className="text-center text-xs text-slate-500 dark:text-slate-400">
                    Cadastro público desativado. Solicite convite ao administrador do tenant.
                  </p>
                </form>
              )}

              {(step === 'mfa_enroll' || step === 'mfa_verify') && (
                <form onSubmit={handleVerifyMfa} className="space-y-4">
                  {step === 'mfa_enroll' && qrDataUrl && (
                    <div className="flex flex-col items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
                      <img
                        src={qrDataUrl}
                        alt="QR Code TOTP"
                        className="h-40 w-40 rounded-lg border border-slate-200 bg-white p-1.5"
                      />
                      <div className="w-full text-center">
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          Chave manual TOTP
                        </p>
                        <code className="mt-1 block break-all rounded bg-white px-2 py-1 font-mono text-xs text-slate-800 border border-slate-200 dark:bg-slate-900 dark:text-slate-200 dark:border-slate-800">
                          {mfaSecret}
                        </code>
                      </div>
                    </div>
                  )}

                  {!isSupabaseConfigured && sandboxCurrentCode && (
                    <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs dark:border-slate-800 dark:bg-slate-950">
                      <span className="text-slate-600 dark:text-slate-400">
                        Código TOTP atual (Sandbox):{' '}
                        <strong className="font-mono text-slate-900 dark:text-slate-100">
                          {sandboxCurrentCode}
                        </strong>
                      </span>
                      <button
                        type="button"
                        onClick={() => setTotpCode(sandboxCurrentCode)}
                        className="font-medium text-teal-700 hover:underline dark:text-teal-400 cursor-pointer whitespace-nowrap"
                      >
                        Preencher
                      </button>
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label htmlFor="totp-code">Código de 6 dígitos (TOTP)</Label>
                    <Input
                      id="totp-code"
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      required
                      value={totpCode}
                      onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="000000"
                      className="text-center font-mono text-lg tracking-[0.35em]"
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="flex-1"
                      onClick={() => {
                        setStep('credentials');
                        setTotpCode('');
                        setError(null);
                      }}
                    >
                      Voltar
                    </Button>
                    <Button type="submit" variant="primary" className="flex-1" disabled={loading}>
                      {loading ? 'Verificando...' : 'Confirmar Acesso'}
                    </Button>
                  </div>
                </form>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};
