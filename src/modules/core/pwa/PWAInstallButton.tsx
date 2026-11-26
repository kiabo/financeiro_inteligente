import { Download, Smartphone } from 'lucide-react';
import React, { useState } from 'react';
import { Button } from '../../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog';
import { usePWAInstall } from './usePWAInstall';

interface PWAInstallButtonProps {
  compact?: boolean;
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({ compact = false }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={() => void install()}
        className="gap-1.5"
        title="Instalar aplicativo PWA"
      >
        <Download className="h-4 w-4 text-[#0F374A] dark:text-[#A7CBE3]" />
        {!compact && <span>Instalar App</span>}
      </Button>
    );
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setShowGuide(true)}
        className="gap-1.5"
        title="Instalar como aplicativo (PWA)"
      >
        <Smartphone className="h-4 w-4 text-[#0F374A] dark:text-[#A7CBE3]" />
        {!compact && <span>Instalar PWA</span>}
      </Button>

      <Dialog open={showGuide} onOpenChange={setShowGuide}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Instalar Vértice no Dispositivo</DialogTitle>
            <DialogDescription>
              Execute como aplicativo independente (PWA) com acesso rápido na tela inicial.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-4 text-sm text-slate-600 dark:text-slate-300">
            {isIOS ? (
              <ol className="list-decimal space-y-2 pl-5">
                <li>
                  Toque no botão <strong>Compartilhar</strong> na barra do Safari.
                </li>
                <li>
                  Role as opções e selecione <strong>Adicionar à Tela de Início</strong>.
                </li>
                <li>
                  Confirme tocando em <strong>Adicionar</strong>.
                </li>
              </ol>
            ) : (
              <ol className="list-decimal space-y-2 pl-5">
                <li>
                  Abra o menu do navegador (Chrome, Edge ou Brave) na barra de endereço.
                </li>
                <li>
                  Clique no ícone de <strong>Instalar aplicativo</strong> ou em{' '}
                  <strong>Adicionar à tela inicial</strong>.
                </li>
              </ol>
            )}
            <div className="flex justify-end pt-2">
              <Button variant="outline" onClick={() => setShowGuide(false)}>
                Fechar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};
