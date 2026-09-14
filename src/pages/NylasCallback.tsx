import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { calendarApi } from '@/services/calendar';

/**
 * Página de retorno do OAuth do Nylas.
 *
 * O Nylas redireciona o navegador para cá com `?code=...&state=...`;
 * esta página troca o código pelo grant e avisa a janela que abriu.
 * Ficar na mesma origem do app evita bloqueios de `window.opener`
 * causados por Cross-Origin-Opener-Policy entre domínios diferentes.
 */
const NylasCallback: React.FC = () => {
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<'processing' | 'success' | 'error'>('processing');
  const [message, setMessage] = useState('Finalizando a conexão com a agenda...');

  useEffect(() => {
    const error = searchParams.get('error');
    const errorDescription = searchParams.get('error_description');
    const code = searchParams.get('code');
    const state = searchParams.get('state');

    if (error) {
      setStatus('error');
      setMessage(errorDescription || 'A autorização foi cancelada.');
      notifyOpener(false, errorDescription || 'A autorização foi cancelada.');
      return;
    }

    if (!code || !state) {
      setStatus('error');
      setMessage('Resposta de autorização incompleta.');
      notifyOpener(false, 'Resposta de autorização incompleta.');
      return;
    }

    let cancelled = false;
    calendarApi
      .exchangeCode({ code, state })
      .then(() => {
        if (cancelled) return;
        setStatus('success');
        setMessage('Agenda conectada com sucesso.');
        notifyOpener(true, 'Agenda conectada.');
        window.setTimeout(() => window.close(), 900);
      })
      .catch((err) => {
        if (cancelled) return;
        const text = err instanceof Error ? err.message : 'Não foi possível conectar a agenda.';
        setStatus('error');
        setMessage(text);
        notifyOpener(false, text);
      });

    return () => {
      cancelled = true;
    };
  }, [searchParams]);

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background p-6">
      <div className="via-card w-full max-w-md p-8 text-center">
        {status === 'processing' && (
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
            <h1 className="text-xl font-semibold text-foreground">Conectando agenda</h1>
            <p className="text-sm text-muted-foreground">{message}</p>
          </div>
        )}
        {status === 'success' && (
          <div className="flex flex-col items-center gap-4">
            <CheckCircle className="h-10 w-10 text-success" />
            <h1 className="text-xl font-semibold text-foreground">Agenda conectada</h1>
            <p className="text-sm text-muted-foreground">{message}</p>
            <p className="text-xs text-muted-foreground">Você pode fechar esta janela.</p>
          </div>
        )}
        {status === 'error' && (
          <div className="flex flex-col items-center gap-4">
            <XCircle className="h-10 w-10 text-destructive" />
            <h1 className="text-xl font-semibold text-foreground">Não foi possível conectar</h1>
            <p className="text-sm text-destructive">{message}</p>
          </div>
        )}
      </div>
    </div>
  );
};

function notifyOpener(ok: boolean, message: string) {
  if (window.opener) {
    window.opener.postMessage(
      { type: 'nylas-calendar-oauth', ok, message },
      window.location.origin,
    );
  }
}

export default NylasCallback;
