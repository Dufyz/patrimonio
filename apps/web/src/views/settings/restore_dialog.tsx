import type { SettingsBackup } from '@patrimonio/contracts';
import { useState } from 'react';

import { restoreBackup } from '../../api/settings.js';
import { AlertModal } from '../../components/overlay.js';
import { CONFIRMATION_WORD, formatBytes } from '../../lib/settings.js';

type BackupFile = SettingsBackup['files'][number];

const plural = (n: number, one: string, many: string): string =>
  `${n.toLocaleString('pt-BR')} ${n === 1 ? one : many}`;

/** O que o backup contém, em uma frase; backups antigos não têm a contagem. */
export const backupContent = (file: BackupFile): string =>
  file.entries === null || file.portfolios === null
    ? 'conteúdo não registrado (backup anterior à contagem)'
    : `${plural(file.entries, 'lançamento', 'lançamentos')} e ${plural(
        file.portfolios,
        'carteira',
        'carteiras',
      )}`;

/**
 * BKP-03 · Restaurar um backup pela tela: mostra data e conteúdo, avisa que
 * substitui todos os dados atuais e pede a chave do backup e a palavra
 * RESTAURAR. Roda em modo de manutenção, com backup de segurança antes; ao fim,
 * recarrega a página para o app abrir já sobre o estado restaurado.
 */
export const RestoreDialog = ({
  file,
  onClose,
  onRestored,
}: {
  readonly file: BackupFile | null;
  readonly onClose: () => void;
  readonly onRestored: () => void;
}): React.ReactElement => {
  const [typed, setTyped] = useState('');
  const [identity, setIdentity] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const reset = (): void => {
    setTyped('');
    setIdentity('');
    setError(null);
    setDone(null);
  };

  const close = (): void => {
    if (running) return;
    const finished = done !== null;
    reset();
    onClose();
    if (finished) onRestored();
  };

  const submit = (): void => {
    if (file === null || done !== null) {
      close();
      return;
    }
    setRunning(true);
    setError(null);
    restoreBackup({ name: file.name, identity })
      .then((receipt) =>
        setDone(`${receipt.message} Backup de segurança: ${receipt.safety_backup}.`),
      )
      .catch((failure: unknown) =>
        setError(
          failure instanceof Error ? failure.message : 'A restauração não foi concluída',
        ),
      )
      .finally(() => setRunning(false));
  };

  const ready = typed === CONFIRMATION_WORD && identity.trim().length >= 10 && !running;

  return (
    <AlertModal
      open={file !== null}
      title="Restaurar este backup?"
      message={
        file === null ? null : (
          <span className="flex flex-col gap-3">
            <span>
              Backup de {file.taken_on.split('-').reverse().join('/')} ·{' '}
              {formatBytes(file.bytes)}
              {file.schema_version === null ? '' : ` · esquema ${file.schema_version}`}.
              Contém {backupContent(file)}.
            </span>
            <span>
              Restaurar <strong>substitui todos os dados atuais</strong>. Antes, o app
              grava um backup de segurança do estado de agora; a troca é tudo ou nada e
              roda em manutenção, com as escritas bloqueadas até terminar. Depois, o
              mercado é sincronizado e as carteiras são recalculadas.
            </span>
            {done === null ? (
              <>
                <label className="flex flex-col gap-1">
                  Chave privada do backup (age)
                  <textarea
                    value={identity}
                    onChange={(e) => setIdentity(e.target.value)}
                    rows={3}
                    spellCheck={false}
                    autoComplete="off"
                    placeholder="AGE-SECRET-KEY-…"
                    className="rounded-field border border-line bg-field px-2 py-1.5 font-mono text-xs"
                  />
                </label>
                <span className="text-xs text-ink-3">
                  A chave não fica guardada: vai uma vez ao servidor e é apagada ao fim.
                </span>
                <label className="flex flex-col gap-1">
                  Digite {CONFIRMATION_WORD} para liberar
                  <input
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                    className="rounded-field border border-line bg-field px-2 py-1.5"
                  />
                </label>
              </>
            ) : (
              <span role="status" className="text-positive">
                {done}
              </span>
            )}
            {error === null ? null : (
              <span role="alert" className="text-negative">
                {error}
              </span>
            )}
          </span>
        )
      }
      cancelLabel={done === null ? 'Cancelar' : 'Fechar'}
      confirmLabel={
        done !== null ? 'Concluir' : running ? 'Restaurando…' : 'Restaurar agora'
      }
      danger
      pending={done === null && !ready}
      onCancel={close}
      onConfirm={submit}
    />
  );
};
