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
import {
  DATE_FORMATS,
  DEFAULT_PERIODS,
  HOME_SCOPES,
  HOME_SCREENS,
  WEEK_STARTS,
  readDisplay,
  writeDisplay,
} from '../../lib/display_preferences.js';
import type { DisplayPreferences } from '../../lib/display_preferences.js';
import { SHORTCUTS, describeShortcut, groupShortcuts } from '../../lib/shortcuts.js';
import { Callout, Field, Input, Select } from '../entry/fields.js';
import { DeleteDialog } from '../registers/delete_dialog.js';
import { ImportDialog } from './import_dialog.js';
import {
  ActionNote,
  SettingsPanel,
  SettingsSection,
  StatusDot,
  Switch,
} from './parts.js';

/**
 * Exibição e Dados e backup: as duas seções que são ajuste do próprio app, e não
 * cadastro.
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
  tone = 'default',
  children,
}: {
  readonly title: string;
  readonly hint: React.ReactNode;
  readonly tone?: 'default' | 'danger';
  readonly children: React.ReactNode;
}): React.ReactElement => (
  // A linha nunca quebra: o texto à esquerda é quem cede (`min-w-0 flex-1`) e as
  // ações à direita não encolhem nem passam para a segunda linha (`shrink-0`).
  <div className="flex items-center justify-between gap-4 border-t border-line px-4 py-3 first:border-t-0">
    <div className="min-w-0 flex-1">
      <div
        className={`text-[0.8125rem] font-medium ${tone === 'danger' ? 'text-negative' : ''}`}
      >
        {title}
      </div>
      <div className="text-[0.8125rem] text-ink-3">{hint}</div>
    </div>
    <div className="flex shrink-0 items-center gap-2 text-[0.8125rem] whitespace-nowrap">
      {children}
    </div>
  </div>
);

const THEME_OPTIONS = [
  { value: 'light', label: 'Claro' },
  { value: 'dark', label: 'Escuro' },
  { value: 'system', label: 'Sistema' },
] as const satisfies readonly { value: ThemePreference; label: string }[];

const DENSITY_OPTIONS = [
  { value: 'comfortable', label: 'Confortável' },
  { value: 'compact', label: 'Compacta' },
] as const satisfies readonly { value: Density; label: string }[];

const SCOPE_NAMES: Readonly<Record<string, string>> = {
  global: 'Geral',
  navigation: 'Navegação',
  row: 'Na linha',
  form: 'Formulários',
  overlay: 'Janelas',
};

export const DisplaySection = (): React.ReactElement => {
  const { theme, setTheme, density, setDensity, hidden, setHidden } = usePreferences();
  const [display, setDisplay] = useState<DisplayPreferences>(() => readDisplay());
  const choose = <K extends keyof DisplayPreferences>(
    name: K,
    value: DisplayPreferences[K],
  ): void => {
    writeDisplay(name, value);
    setDisplay((current) => ({ ...current, [name]: value }));
  };

  return (
    <SettingsSection
      id="exibicao"
      title="Exibição"
      description="Preferências de leitura. Valem para este navegador."
    >
      <SettingsPanel>
        <Row title="Tema" hint="Sistema segue a configuração do computador.">
          <Segmented
            label="Tema"
            options={THEME_OPTIONS}
            value={theme}
            onChange={setTheme}
          />
        </Row>
        <Row
          title="Densidade das tabelas"
          hint="Compacta mostra cerca de 30% mais linhas."
        >
          <Segmented
            label="Densidade das tabelas"
            options={DENSITY_OPTIONS}
            value={density}
            onChange={setDensity}
          />
        </Row>
        <Row
          title="Ocultar valores ao abrir"
          hint="Mostra R$ ••••• até apertar H; percentuais continuam visíveis."
        >
          <Switch
            checked={hidden}
            label="Ocultar valores ao abrir"
            onChange={setHidden}
          />
        </Row>
        <Row title="Tela inicial" hint="Onde o app abre ao entrar pela raiz.">
          <div className="w-44">
            <Select
              aria-label="Tela inicial"
              invalid={false}
              options={HOME_SCREENS.map((item) => ({ id: item.value, name: item.label }))}
              value={display.homeScreen}
              onChange={(event) =>
                choose(
                  'homeScreen',
                  event.target.value as DisplayPreferences['homeScreen'],
                )
              }
            />
          </div>
        </Row>
        <Row title="Escopo padrão" hint="O que a Visão geral resume ao abrir.">
          <Segmented
            label="Escopo padrão"
            options={HOME_SCOPES}
            value={display.homeScope}
            onChange={(value) => choose('homeScope', value)}
          />
        </Row>
        <Row
          title="Período padrão"
          hint="O intervalo com que as telas de Finanças abrem."
        >
          <div className="w-44">
            <Select
              aria-label="Período padrão"
              invalid={false}
              options={DEFAULT_PERIODS.map((item) => ({
                id: item.value,
                name: item.label,
              }))}
              value={display.defaultPeriod}
              onChange={(event) =>
                choose(
                  'defaultPeriod',
                  event.target.value as DisplayPreferences['defaultPeriod'],
                )
              }
            />
          </div>
        </Row>
        <Row title="Formato de data" hint="Como as datas completas são escritas.">
          <Segmented
            label="Formato de data"
            options={DATE_FORMATS}
            value={display.dateFormat}
            onChange={(value) => choose('dateFormat', value)}
          />
        </Row>
        <Row title="Primeiro dia da semana" hint="Usado nos calendários.">
          <Segmented
            label="Primeiro dia da semana"
            options={WEEK_STARTS}
            value={display.weekStart}
            onChange={(value) => choose('weekStart', value)}
          />
        </Row>
      </SettingsPanel>
      <SettingsPanel>
        <div className="px-4 py-3" aria-label="Atalhos de teclado">
          <div className="text-[0.8125rem] font-medium">Atalhos de teclado</div>
          <div className="mb-2 text-[0.8125rem] text-ink-3">
            Só leitura. Aperte ? em qualquer tela para ver esta lista.
          </div>
          <dl className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
            {groupShortcuts(SHORTCUTS).map((group) => (
              <div key={group.scope}>
                <dt className="text-[0.75rem] font-medium text-ink-3 uppercase">
                  {SCOPE_NAMES[group.scope] ?? group.scope}
                </dt>
                {group.items.map((item) => (
                  <dd
                    key={item.id}
                    className="flex justify-between gap-3 text-[0.8125rem]"
                  >
                    <span>{item.label}</span>
                    <kbd className="font-mono text-ink-2">{describeShortcut(item)}</kbd>
                  </dd>
                ))}
              </div>
            ))}
          </dl>
        </div>
      </SettingsPanel>
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
      id="dados-e-backup"
      title="Dados e backup"
      description="Os dados são seus e ficam exportáveis a qualquer momento, em formatos abertos."
    >
      <SettingsPanel>
        <Row title="Exportar tudo" hint="Lançamentos, ativos, carteiras e configurações.">
          <Button disabled={exporting !== null} onClick={() => download('csv')}>
            {exporting === 'csv' ? 'Exportando…' : 'CSV por tabela'}
          </Button>
          <Button disabled={exporting !== null} onClick={() => download('json')}>
            {exporting === 'json' ? 'Exportando…' : 'JSON completo'}
          </Button>
        </Row>
        <Row
          title="Backup automático"
          hint="Todo dia às 03:00, cifrado; mantém 7 diários, 4 semanais e 6 mensais."
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
          hint="Mapeia as colunas da sua planilha para lançamentos e mostra uma prévia antes de gravar."
        >
          <Button onClick={() => setImporting(true)}>Importar arquivo</Button>
        </Row>
      </SettingsPanel>
      <SettingsPanel tone="danger">
        <Row
          title="Apagar todos os dados"
          hint="Remove lançamentos, ativos e carteiras. Pede para digitar a frase de confirmação."
          tone="danger"
        >
          <Button
            variant="destructive"
            className="border-negative"
            onClick={() => setDeleting(true)}
          >
            Apagar dados
          </Button>
        </Row>
      </SettingsPanel>
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
