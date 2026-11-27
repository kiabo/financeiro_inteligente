import { ArrowRight, KeyRound, Lock, Mail, ShieldCheck } from 'lucide-react';
import QRCode from 'qrcode';
import React, { useEffect, useState } from 'react';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Input, Label } from '../../components/ui/input';
import { StatusChip } from '../../components/ui/status-chip';
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

  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [mfaSecret, setMfaSecret] = useState<string>('');
  const [supabaseFactorId, setSupabaseFactorId] = useState<string>('');
  const [pendingSession, setPendingSession] = useState<AuthSessionState | null>(null);
  const [sandboxCurrentCode, setSandboxCurrentCode] = useState<string>('');

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let active = true;

    const resumeSupabaseMfaIfNeeded = async () => {
      const params = new URLSearchParams(window.location.search);
      const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      const oauthErr =
        params.get('error_description') ??
        hashParams.get('error_description') ??
        params.get('error') ??
        hashParams.get('error');

      if (oauthErr) {
        if (active) {
          setError(
            oauthErr.includes('Database error') || oauthErr.includes('convite')
              ? 'Acesso bloqueado: este e-mail Google não consta na tabela de convites autorizados (invited_users).'
              : decodeURIComponent(oauthErr)
          );
        }
        window.history.replaceState({}, '', window.location.pathname);
        return;
      }

      const supabase = getSupabaseClient();
      if (!supabase) return;

      const { data } = await supabase.auth.getSession();
      const user = data.session?.user;
      if (!user || !active) return;

      const { data: aalData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      const { data: factorsData } = await supabase.auth.mfa.listFactors();
      const verifiedTotp = factorsData?.totp?.find((f) => f.status === 'verified');

      if (verifiedTotp && aalData?.currentLevel === 'aal2') {
        return;
      }

      const baseSession: AuthSessionState = {
        mode: 'supabase',
        userId: user.id,
        email: user.email ?? '',
        fullName:
          (user.user_metadata?.full_name as string | undefined) ??
          user.email?.split('@')[0] ??
          'Titular',
        role: 'owner',
        mfaVerified: false,
        mfaEnrolled: Boolean(verifiedTotp),
        aal: 'aal1',
      };

      if (verifiedTotp) {
        if (!active) return;
        setPendingSession(baseSession);
        setSupabaseFactorId(verifiedTotp.id);
        setStep('mfa_verify');
        return;
      }

      const unverifiedTotp = factorsData?.all?.find(
        (f) => f.factor_type === 'totp' && f.status === 'unverified'
      );
      if (unverifiedTotp) {
        await supabase.auth.mfa.unenroll({ factorId: unverifiedTotp.id });
      }

      const { data: enrollData, error: enrollErr } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: 'Vértice Authenticator',
      });
      if (enrollErr || !enrollData || !active) {
        if (active && enrollErr) setError(enrollErr.message);
        return;
      }

      setPendingSession(baseSession);
      setSupabaseFactorId(enrollData.id);
      setQrDataUrl(enrollData.totp.qr_code);
      setMfaSecret(enrollData.totp.secret);
      setStep('mfa_enroll');
    };

    void resumeSupabaseMfaIfNeeded();
    return () => {
      active = false;
    };
  }, []);

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

  const handleGoogleSignIn = async () => {
    setError(null);
    const supabase = getSupabaseClient();
    if (!supabase) return;

    setLoading(true);
    try {
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin,
        },
      });
      if (oauthError) {
        throw new Error(oauthError.message);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao iniciar login com Google.');
      setLoading(false);
    }
  };

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

        const unverifiedTotp = factorsData?.all?.find(
          (f) => f.factor_type === 'totp' && f.status === 'unverified'
        );
        if (unverifiedTotp) {
          await supabase.auth.mfa.unenroll({ factorId: unverifiedTotp.id });
        }

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
    <div className="min-h-screen bg-[#F8FAFC] px-4 py-8 dark:bg-[#08131D] flex items-center justify-center">
      <div className="mx-auto grid w-full max-w-5xl grid-cols-1 gap-8 lg:grid-cols-12 lg:items-center">
        {/* Coluna institucional esquerda */}
        <div className="lg:col-span-6 space-y-6">
          <div className="flex items-center gap-3">
            <img
              src="/icon.svg"
              alt="Vértice Finanças"
              className="h-10 w-10 rounded-[6px] border border-[#E2E8F0] dark:border-[#2A3B4C]"
            />
            <div>
              <span className="font-display text-[18px] font-semibold tracking-[-0.015em] text-[#0F172A] dark:text-[#EAF1FF]">
                Vértice
              </span>
              <p className="text-[12px] text-[#42484C] dark:text-[#9DB0C2]">
                Inteligência Financeira &amp; Governança Corporativa
              </p>
            </div>
          </div>

          <div className="space-y-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#0F374A] dark:text-[#A7CBE3]">
              Arquitetura Privacy-by-Design
            </p>
            <h1 className="font-display text-[24px] sm:text-[32px] font-semibold leading-[32px] sm:leading-[40px] tracking-[-0.025em] text-[#0F172A] dark:text-[#EAF1FF] text-balance">
              Fundação financeira privada com anonimização por padrão.
            </h1>
            <p className="text-[14px] leading-5 text-[#334155] dark:text-[#B9CADB] max-w-lg">
              Ambiente estritamente restrito a titulares convidados. Empresas, contas e grupos
              recebem tokens analíticos imutáveis isolados por Row Level Security.
            </p>
          </div>

          <div className="divide-y divide-[#E2E8F0] border-y border-[#E2E8F0] text-[14px] dark:divide-[#1E2F3F] dark:border-[#1E2F3F]">
            <div className="flex items-start gap-3 py-3.5">
              <Lock className="mt-0.5 h-4 w-4 shrink-0 text-[#0F374A] dark:text-[#A7CBE3]" />
              <div>
                <p className="font-medium text-[#0F172A] dark:text-[#EAF1FF]">
                  Acesso Invite-Only &amp; 2FA (TOTP)
                </p>
                <p className="text-[12px] leading-4 text-[#42484C] dark:text-[#9DB0C2]">
                  Cadastro público desativado no banco. Sessões exigem autenticação em duas etapas.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3 py-3.5">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#059669] dark:text-[#68DBA9]" />
              <div>
                <p className="font-medium text-[#0F172A] dark:text-[#EAF1FF]">
                  Cofre de Anonimização Isolado
                </p>
                <p className="text-[12px] leading-4 text-[#42484C] dark:text-[#9DB0C2]">
                  Razões sociais e CNPJs são substituídos por tokens (EMP_01, CTA_01) antes de
                  qualquer análise externa.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Coluna de autenticação direita */}
        <div className="lg:col-span-6">
          <Card className="mx-auto w-full max-w-md">
            <CardHeader className="border-b border-[#E2E8F0] pb-4 dark:border-[#1E2F3F]">
              <div className="flex items-center justify-between gap-2">
                <StatusChip variant={isSupabaseConfigured ? 'positive' : 'neutral'}>
                  {isSupabaseConfigured ? 'Supabase RLS Ativo' : 'Sandbox Local'}
                </StatusChip>
                <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#72787D]">
                  Acesso Restrito
                </span>
              </div>
              <CardTitle className="pt-2 text-[20px] font-semibold leading-7 tracking-[-0.015em]">
                {step === 'credentials' && 'Entrar no Cofre Corporativo'}
                {step === 'mfa_enroll' && 'Configurar 2FA Obrigatório'}
                {step === 'mfa_verify' && 'Verificação em Duas Etapas'}
              </CardTitle>
              <CardDescription className="text-[13px]">
                {step === 'credentials' &&
                  'Apenas contas previamente convidadas pelo administrador têm acesso autorizado.'}
                {step === 'mfa_enroll' &&
                  'Escaneie o QR Code no seu aplicativo autenticador e informe o código de 6 dígitos.'}
                {step === 'mfa_verify' &&
                  'Informe o código temporário TOTP de 6 dígitos para elevar sua sessão para AAL2.'}
              </CardDescription>
            </CardHeader>

            <CardContent className="pt-5">
              {!isSupabaseConfigured && step === 'credentials' && (
                <div className="mb-4 rounded-[4px] border border-[#E2E8F0] bg-[#F1F5F9] p-3 text-[12px] leading-4 text-[#334155] dark:border-[#1E2F3F] dark:bg-[#08131D] dark:text-[#9DB0C2]">
                  Variáveis <span className="font-mono">VITE_SUPABASE_URL</span> e{' '}
                  <span className="font-mono">VITE_SUPABASE_ANON_KEY</span> não configuradas. A
                  sessão abaixo opera em Sandbox Local com TOTP real.
                </div>
              )}

              {error && (
                <div
                  role="alert"
                  className="mb-4 rounded-[4px] border border-[#FECACA] bg-[#FEF2F2] px-3 py-2.5 text-[12px] font-medium text-[#991B1B] dark:border-[#7F1D1D] dark:bg-[#3B1219] dark:text-[#FCA5A5]"
                >
                  {error}
                </div>
              )}

              {step === 'credentials' && (
                <form onSubmit={handleCredentialsSubmit} className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="login-email">E-mail autorizado</Label>
                    <div className="relative">
                      <Mail className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[#72787D]" />
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

                  <div className="space-y-1.5">
                    <Label htmlFor="login-password">Senha</Label>
                    <div className="relative">
                      <KeyRound className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[#72787D]" />
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

                  {isSupabaseConfigured && (
                    <div className="space-y-3 pt-1">
                      <div className="relative flex items-center py-1">
                        <div className="flex-grow border-t border-[#E2E8F0] dark:border-[#1E2F3F]" />
                        <span className="mx-3 shrink-0 text-[11px] font-medium uppercase tracking-[0.04em] text-[#72787D]">
                          ou
                        </span>
                        <div className="flex-grow border-t border-[#E2E8F0] dark:border-[#1E2F3F]" />
                      </div>

                      <Button
                        type="button"
                        variant="outline"
                        className="w-full"
                        disabled={loading}
                        onClick={() => void handleGoogleSignIn()}
                      >
                        <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
                          <path
                            fill="#4285F4"
                            d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
                          />
                          <path
                            fill="#34A853"
                            d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
                          />
                          <path
                            fill="#FBBC05"
                            d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
                          />
                          <path
                            fill="#EA4335"
                            d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
                          />
                        </svg>
                        <span>Entrar com Google (Convidados)</span>
                      </Button>

                      {typeof window !== 'undefined' && window.self !== window.top && (
                        <p className="text-center text-[11px] text-[#42484C] dark:text-[#9DB0C2]">
                          O login Google exige janela própria:{' '}
                          <a
                            href={window.location.href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-medium text-[#0F374A] underline dark:text-[#A7CBE3]"
                          >
                            abrir em nova aba
                          </a>
                          .
                        </p>
                      )}
                    </div>
                  )}

                  <p className="text-center text-[12px] text-[#42484C] dark:text-[#9DB0C2]">
                    Cadastro público desativado. Solicite convite ao administrador do tenant.
                  </p>
                </form>
              )}

              {(step === 'mfa_enroll' || step === 'mfa_verify') && (
                <form onSubmit={handleVerifyMfa} className="space-y-4">
                  {step === 'mfa_enroll' && qrDataUrl && (
                    <div className="flex flex-col items-center gap-3 rounded-[8px] border border-[#E2E8F0] bg-[#F8FAFC] p-4 dark:border-[#1E2F3F] dark:bg-[#08131D]">
                      <img
                        src={qrDataUrl}
                        alt="QR Code TOTP"
                        className="h-40 w-40 rounded-[4px] border border-[#E2E8F0] bg-white p-1.5"
                      />
                      <div className="w-full text-center">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#72787D]">
                          Chave manual TOTP
                        </p>
                        <code className="mt-1 block break-all rounded-[4px] border border-[#CBD5E1] bg-white px-2 py-1 font-mono text-[12px] text-[#0F172A] dark:border-[#2A3B4C] dark:bg-[#0D1A26] dark:text-[#EAF1FF]">
                          {mfaSecret}
                        </code>
                      </div>
                    </div>
                  )}

                  {!isSupabaseConfigured && sandboxCurrentCode && (
                    <div className="flex items-center justify-between gap-3 rounded-[4px] border border-[#E2E8F0] bg-[#F1F5F9] px-3 py-2 text-[12px] dark:border-[#1E2F3F] dark:bg-[#08131D]">
                      <span className="text-[#334155] dark:text-[#B9CADB]">
                        Código TOTP atual (Sandbox):{' '}
                        <strong className="tabular-nums font-semibold text-[#0F172A] dark:text-[#EAF1FF]">
                          {sandboxCurrentCode}
                        </strong>
                      </span>
                      <button
                        type="button"
                        onClick={() => setTotpCode(sandboxCurrentCode)}
                        className="font-medium text-[#0F374A] hover:underline dark:text-[#A7CBE3] cursor-pointer whitespace-nowrap"
                      >
                        Preencher
                      </button>
                    </div>
                  )}

                  <div className="space-y-1.5">
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
                      className="text-center font-mono text-[18px] tracking-[0.35em] tabular-nums"
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="flex-1"
                      onClick={() => {
                        if (isSupabaseConfigured) {
                          void getSupabaseClient()?.auth.signOut();
                        }
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
