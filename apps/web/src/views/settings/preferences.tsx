import type { Settings, SettingsBackup } from '@patrimonio/contracts';
import { useState } from 'react';

import { DELETE_ALL_PHRASE } from '@patrimonio/contracts';

import { deleteAllData, fetchExport } from '../../api/data.js';
import { runBackup } from '../../api/settings.js';
import { usePreferences } from '../../components/preferences.js';
import { Button, Segmented } from '../../components/primitives.js';
import { csvFiles, exportName, saveFile, zipStore } from '../../lib/export_files.js';
import type { Density, ThemePreference } from '../../lib/theme.js';
import { backupSummary } from '../../lib/settings.js';
import { Callout, Field, Input } from '../entry/fields.js';
import { DeleteDialog } from '../registers/delete_dialog.js';
import { ImportDialog } from './import_dialog.js';
import { ActionNote, SettingsSection, StatusDot, Switch } from './parts.js';

/**
 * Lançamentos, Exibição e Dados e backup: as três seções que são ajuste do
 * próprio app, e não cadastro.
 *
 * **Lançamentos** mostra o que o formulário preenche sozinho. A liquidação vem
 * da regra do domínio — a mesma que sugere a data no lançamento — e a alíquota
 * do JCP e a janela do desfazer vêm da instalação; nenhuma é gravada pela tela,
 * e a seção diz isso em vez de oferecer um botão que não salva.
 *
 * **Exibição** é do navegador: tema, densidade e valores ocultos ficam em
 * `localStorage` e não viajam em link (`desenvolvimento-web.md`, seção 5).
 *
 * **Dados e backup** pede o backup agora; o dump é do worker e leva o tempo do
 * banco, então a tela só diz que foi pedido.
 */

const Row = ({
  title,
  hint,
  children,
}: {
  readonly title: string;
  readonly hint: React.ReactNode;
  readonly children: React.ReactNode;
}): React.ReactElement => (
  // A linha nunca quebra: o texto à esquerda é quem cede (`min-w-0 flex-1`) e as
  // ações à direita não encolhem nem passam para a segunda linha (`shrink-0`).
  <div className="flex items-center justify-between gap-4 border-t border-line px-4 py-3 first:border-t-0">
    <div className="min-w-0 flex-1">
      <div className="text-[0.8125rem] font-medium">{title}</div>
      <div className="text-[0.8125rem] text-ink-3">{hint}</div>
    </div>
    <div className="flex shrink-0 items-center gap-2 text-[0.8125rem] whitespace-nowrap">
      {children}
    </div>
  </div>
);

const settlementText = (settings: Settings): string =>
  settings.ledger_defaults.settlement
    .map((item) => `${item.label} D+${item.business_days}`)
    .join(' · ');

export const LedgerSection = ({
  settings,
}: {
  readonly settings: Settings;
}): React.ReactElement => {
  const defaults = settings.ledger_defaults;

  return (
    <SettingsSection
      id="lancamentos"
      title="Lançamentos"
      description="Valores que o formulário de lançamento preenche sozinho. Todos podem ser alterados em cada lançamento. Estes são definidos na instalação; para mudá-los, altere a configuração do servidor."
    >
      <Row
        title="Liquidação padrão"
        hint="Data em que o dinheiro sai ou entra, contada em dias úteis"
      >
        <span className="tabular">{settlementText(settings)}</span>
      </Row>
      <Row title="IR retido em JCP" hint="Calcula o líquido a partir do bruto informado">
        <span className="tabular">{defaults.jcp_withholding_pct.replace('.', ',')}%</span>
      </Row>
      <Row title="Desfazer" hint="Tempo para desfazer depois de excluir um lançamento">
        <span className="tabular">{defaults.undo_window_seconds} s</span>
      </Row>
    </SettingsSection>
  );
};

const THEME_OPTIONS = [
  { value: 'light', label: 'Claro' },
  { value: 'dark', label: 'Escuro' },
  { value: 'system', label: 'Sistema' },
] as const satisfies readonly { value: ThemePreference; label: string }[];

const DENSITY_OPTIONS = [
  { value: 'comfortable', label: 'Confortável' },
  { value: 'compact', label: 'Compacta' },
] as const satisfies readonly { value: Density; label: string }[];

export const DisplaySection = (): React.ReactElement => {
  const { theme, setTheme, density, setDensity, hidden, setHidden } = usePreferences();

  return (
    <SettingsSection
      id="exibicao"
      title="Exibição"
      description="Preferências de leitura. Valem para este navegador."
    >
      <Row title="Tema" hint="Sistema segue a configuração do computador">
        <Segmented
          label="Tema"
          options={THEME_OPTIONS}
          value={theme}
          onChange={setTheme}
        />
      </Row>
      <Row title="Densidade das tabelas" hint="Compacta mostra cerca de 30% mais linhas">
        <Segmented
          label="Densidade das tabelas"
          options={DENSITY_OPTIONS}
          value={density}
          onChange={setDensity}
        />
      </Row>
      <Row
        title="Ocultar valores ao abrir"
        hint="Mostra R$ ••••• até apertar H; percentuais continuam visíveis"
      >
        <Switch checked={hidden} label="Ocultar valores ao abrir" onChange={setHidden} />
      </Row>
    </SettingsSection>
  );
};

type Receipt = { readonly tone: 'ok' | 'error'; readonly text: string };

const BackupState = ({
  backup,
}: {
  readonly backup: SettingsBackup;
}): React.ReactElement => {
  const summary = backupSummary(backup);

  return <StatusDot tone={summary.tone}>{summary.text}</StatusDot>;
};

export const BackupSection = ({
  settings,
  onChanged,
}: {
  readonly settings: Settings;
  readonly onChanged: () => void;
}): React.ReactElement => {
  const [running, setRunning] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [exporting, setExporting] = useState<'csv' | 'json' | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [importing, setImporting] = useState(false);
  const { backup } = settings;

  const download = (format: 'csv' | 'json'): void => {
    setExporting(format);
    setReceipt(null);
    fetchExport()
      .then((document) => {
        if (format === 'json') {
          saveFile(exportName('json'), document, 'application/json');
        } else {
          saveFile(
            exportName('zip'),
            zipStore(csvFiles(document)) as BlobPart,
            'application/zip',
          );
        }
        setReceipt({ tone: 'ok', text: 'Exportação baixada.' });
      })
      .catch((error: unknown) =>
        setReceipt({
          tone: 'error',
          text: error instanceof Error ? error.message : 'Não foi possível exportar',
        }),
      )
      .finally(() => setExporting(null));
  };

  const run = (): void => {
    setRunning(true);
    setReceipt(null);
    runBackup()
      .then((result) => {
        setReceipt({
          tone: 'ok',
          text: result.already_queued
            ? 'Já havia um backup na fila: o pedido foi somado a ele.'
            : 'Backup pedido. Ele aparece aqui quando terminar.',
        });
        onChanged();
      })
      .catch((error: unknown) =>
        setReceipt({
          tone: 'error',
          text:
            error instanceof Error ? error.message : 'Não foi possível pedir o backup',
        }),
      )
      .finally(() => setRunning(false));
  };

  return (
    <SettingsSection
      id="backup"
      title="Dados e backup"
      description="Os dados são seus e ficam exportáveis a qualquer momento, em formatos abertos."
    >
      <Row title="Exportar tudo" hint="Lançamentos, ativos, carteiras e configurações">
        <Button disabled={exporting !== null} onClick={() => download('csv')}>
          {exporting === 'csv' ? 'Exportando…' : 'CSV por tabela'}
        </Button>
        <Button disabled={exporting !== null} onClick={() => download('json')}>
          {exporting === 'json' ? 'Exportando…' : 'JSON completo'}
        </Button>
      </Row>
      <Row
        title="Backup automático"
        hint="Todo dia às 03:00, cifrado; mantém 7 diários, 4 semanais e 6 mensais"
      >
        {backup.enabled ? <BackupState backup={backup} /> : null}
        <Button
          disabled={running || !backup.enabled || backup.pending}
          // Desligado, o motivo vai na dica do botão em vez de num texto ao lado
          // dele, que empurraria o botão para outra linha.
          {...(backup.enabled ? {} : { title: backupSummary(backup).text })}
          onClick={run}
        >
          {running ? 'Pedindo…' : 'Fazer backup agora'}
        </Button>
      </Row>
      {receipt === null ? null : (
        <div className="border-t border-line px-4 py-3">
          <ActionNote tone={receipt.tone}>{receipt.text}</ActionNote>
        </div>
      )}
      <Row
        title="Importar planilha"
        hint="Para a migração inicial: mapeia as colunas da sua planilha para lançamentos e mostra uma prévia antes de gravar"
      >
        <Button onClick={() => setImporting(true)}>Importar arquivo</Button>
      </Row>
      <Row
        title="Apagar todos os dados"
        hint="Remove lançamentos, ativos e carteiras. Pede para digitar a frase de confirmação."
      >
        <Button variant="destructive" onClick={() => setDeleting(true)}>
          Apagar
        </Button>
      </Row>
      {importing ? (
        <ImportDialog
          settings={settings}
          onClose={() => setImporting(false)}
          onDone={onChanged}
        />
      ) : null}
      {deleting ? (
        <DeleteAllDialog
          onExport={() => download('json')}
          onClose={() => setDeleting(false)}
          onDone={() => window.location.reload()}
        />
      ) : null}
    </SettingsSection>
  );
};

/**
 * Apagar tudo pede a frase inteira e oferece o JSON antes: é o único botão do
 * app que não tem como ser desfeito. Os dados de mercado ficam — preço de
 * fechamento não é da pessoa, e recarregar o COTAHIST custa horas. Cópias já
 * gravadas no bucket de backup também não são tocadas por esta ação.
 */
const DeleteAllDialog = ({
  onExport,
  onClose,
  onDone,
}: {
  readonly onExport: () => void;
  readonly onClose: () => void;
  readonly onDone: () => void;
}): React.ReactElement => {
  const [typed, setTyped] = useState('');
  const confirmed = typed.trim() === DELETE_ALL_PHRASE;

  return (
    <DeleteDialog
      title="Apagar todos os dados?"
      subtitle="Esta ação não pode ser desfeita"
      subject="todos os seus dados"
      confirmLabel="Apagar tudo"
      canConfirm={confirmed}
      onClose={onClose}
      onDone={onDone}
      onConfirm={() => {
        if (!confirmed)
          return Promise.reject(new Error('Digite a frase para confirmar.'));
        return deleteAllData(DELETE_ALL_PHRASE);
      }}
    >
      <Callout tone="warning">
        <strong className="font-semibold">Atenção: nada fica.</strong> Serão excluídos
        permanentemente os lançamentos, as carteiras e tudo que há nelas, as instituições,
        os ativos cadastrados à mão, os preços manuais e os proventos anunciados. Preços
        de mercado e backups já gravados no bucket não são apagados.
      </Callout>

      <div>
        <Button onClick={onExport}>Baixar JSON completo antes</Button>
      </div>

      <Field label={`Digite ${DELETE_ALL_PHRASE} para confirmar`}>
        {(control) => (
          <Input
            {...control}
            invalid={false}
            value={typed}
            placeholder={DELETE_ALL_PHRASE}
            onChange={(event) => setTyped(event.target.value)}
          />
        )}
      </Field>
    </DeleteDialog>
  );
};
