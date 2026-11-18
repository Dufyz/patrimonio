import type { Settings, SettingsBackup } from '@patrimonio/contracts';
import { useState } from 'react';

import { DELETE_ALL_PHRASE } from '@patrimonio/contracts';

import { deleteAllData, fetchExport } from '../../api/data.js';
import { runBackup } from '../../api/settings.js';
import { RestoreDialog } from './restore_dialog.js';
import { usePreferences } from '../../components/preferences.js';
import { Button, Segmented } from '../../components/primitives.js';
import { csvFiles, exportName, saveFile, zipStore } from '../../lib/export_files.js';
import type { Density, ThemePreference } from '../../lib/theme.js';
import { BACKUP_KIND_LABEL, backupSummary, formatBytes } from '../../lib/settings.js';
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
import { SHORTCUTS, describeShortcut } from '../../lib/shortcuts.js';
import { Callout, Field, Input, Select } from '../entry/fields.js';
import { DeleteDialog } from '../registers/delete_dialog.js';
import { ImportDialog } from './import_dialog.js';
import {
  ActionNote,
  ROW,
  SettingsPanel,
  SettingsSection,
  StatusDot,
  Switch,
  TD,
  TH,
  TH_RIGHT,
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

/** Os atalhos que a prancha lista, com o texto dela. */
const SHORTCUT_ROWS = [
  { id: 'new_transaction', label: 'Nova movimentação' },
  { id: 'search', label: 'Buscar em tudo' },
  { id: 'hide_values', label: 'Ocultar ou mostrar valores' },
  { id: 'filter', label: 'Filtrar a lista' },
  { id: 'form_submit_again', label: 'Salvar e abrir outra movimentação' },
] as const;

const Pick = ({
  label,
  value,
  options,
  onChange,
}: {
  readonly label: string;
  readonly value: string;
  readonly options: readonly { readonly value: string; readonly label: string }[];
  readonly onChange: (value: string) => void;
}): React.ReactElement => (
  <div className="w-48">
    <Select
      aria-label={label}
      invalid={false}
      options={options.map((item) => ({ id: item.value, name: item.label }))}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  </div>
);

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
      <SettingsPanel title="Aparência" hint="valem para este navegador">
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
      </SettingsPanel>

      <SettingsPanel title="Ao abrir o app" hint="o ponto de partida de cada sessão">
        <Row title="Tela inicial" hint="Visão geral, com o escopo escolhido ao lado.">
          <Pick
            label="Tela inicial"
            value={display.homeScreen}
            options={HOME_SCREENS}
            onChange={(value) =>
              choose('homeScreen', value as DisplayPreferences['homeScreen'])
            }
          />
        </Row>
        <Row title="Escopo da Visão geral" hint="Tudo, Fluxo ou Investimentos.">
          <Pick
            label="Escopo da Visão geral"
            value={display.homeScope}
            options={HOME_SCOPES}
            onChange={(value) =>
              choose('homeScope', value as DisplayPreferences['homeScope'])
            }
          />
        </Row>
        <Row title="Período padrão" hint="Usado em Visão geral, Movimentações e Contas.">
          <Pick
            label="Período padrão"
            value={display.defaultPeriod}
            options={DEFAULT_PERIODS}
            onChange={(value) =>
              choose('defaultPeriod', value as DisplayPreferences['defaultPeriod'])
            }
          />
        </Row>
      </SettingsPanel>

      <SettingsPanel title="Formato" hint="como datas e números aparecem">
        <Row title="Data" hint="Dia/mês/ano, como nos extratos.">
          <Pick
            label="Data"
            value={display.dateFormat}
            options={DATE_FORMATS}
            onChange={(value) =>
              choose('dateFormat', value as DisplayPreferences['dateFormat'])
            }
          />
        </Row>
        <Row title="Primeiro dia da semana" hint="Usado no seletor de período.">
          <Pick
            label="Primeiro dia da semana"
            value={display.weekStart}
            options={WEEK_STARTS}
            onChange={(value) =>
              choose('weekStart', value as DisplayPreferences['weekStart'])
            }
          />
        </Row>
      </SettingsPanel>

      <SettingsPanel title="Atalhos de teclado" hint="valem em qualquer tela">
        <ul>
          {SHORTCUT_ROWS.map((row) => {
            const shortcut = SHORTCUTS.find((item) => item.id === row.id);
            if (shortcut === undefined) return null;
            return (
              <li
                key={row.id}
                className="flex h-(--row-height) items-center justify-between gap-3 border-t border-line px-4 text-[0.8125rem] first:border-t-0"
              >
                <span>{row.label}</span>
                <kbd className="rounded-control border border-line bg-panel-2 px-1.5 font-mono text-xs text-ink-2">
                  {describeShortcut(shortcut)}
                </kbd>
              </li>
            );
          })}
        </ul>
      </SettingsPanel>
    </SettingsSection>
  );
};

/**
 * BKP-01 · Os backups que o bucket guarda, do mais novo ao mais antigo. A
 * retenção é texto informativo. BKP-03: "Restaurar" abre o diálogo de
 * restauração (conteúdo, aviso, chave e a palavra RESTAURAR).
 */
const BackupFiles = ({
  backup,
}: {
  readonly backup: SettingsBackup;
}): React.ReactElement | null => {
  const [restoring, setRestoring] = useState<SettingsBackup['files'][number] | null>(
    null,
  );
  if (!backup.enabled) return null;
  if (backup.files.length === 0) {
    return (
      <p className="border-t border-line px-4 py-3 text-[0.8125rem] text-ink-3">
        Nenhum backup feito. O primeiro sai hoje às 03:00, ou agora pelo botão acima.
      </p>
    );
  }
  return (
    <div className="border-t border-line">
      <table className="w-full text-[0.8125rem] whitespace-nowrap">
        <caption className="sr-only">Backups guardados</caption>
        <thead>
          <tr>
            <th scope="col" className={TH}>
              Data
            </th>
            <th scope="col" className={TH}>
              Tipo
            </th>
            <th scope="col" className={TH_RIGHT}>
              Tamanho
            </th>
            <th scope="col" className={TH}>
              Situação
            </th>
            <td className={TH} />
          </tr>
        </thead>
        <tbody>
          {backup.files.map((file) => (
            <tr key={file.name} className={ROW}>
              <th scope="row" className={`${TD} tabular text-left font-medium`}>
                {file.taken_on.split('-').reverse().join('/')}
              </th>
              <td className={TD}>{BACKUP_KIND_LABEL[file.kind]}</td>
              <td className={`${TD} tabular text-right`}>{formatBytes(file.bytes)}</td>
              <td className={TD}>
                <StatusDot tone="ok">verificado</StatusDot>
              </td>
              <td className={TD}>
                <button
                  type="button"
                  className="cursor-pointer text-accent hover:underline"
                  aria-label={`Restaurar o backup de ${file.taken_on}`}
                  onClick={() => setRestoring(file)}
                >
                  Restaurar
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <RestoreDialog
        file={restoring}
        onClose={() => setRestoring(null)}
        onRestored={() => globalThis.location.reload()}
      />
    </div>
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
  const [choosing, setChoosing] = useState(false);
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

  const last = backup.files[0];
  const lastText =
    backup.last_success_at === null
      ? 'nenhum backup feito ainda'
      : `${new Date(backup.last_success_at)
          .toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
          .replace(
            ', ',
            ' ',
          )}${last === undefined ? '' : ` · ${formatBytes(last.bytes)}`}`;

  return (
    <SettingsSection
      id="dados-e-backup"
      title="Dados e backup"
      description="Os dados são seus e ficam exportáveis a qualquer momento, em formatos abertos."
    >
      <SettingsPanel
        title="Exportar"
        hint="os dados são seus e ficam exportáveis em formatos abertos"
      >
        <Row
          title="Exportar tudo"
          hint="Movimentações, ativos, carteiras e configurações."
        >
          <Button disabled={exporting !== null} onClick={() => download('csv')}>
            {exporting === 'csv' ? 'Exportando…' : 'CSV por tabela'}
          </Button>
          <Button disabled={exporting !== null} onClick={() => download('json')}>
            {exporting === 'json' ? 'Exportando…' : 'JSON completo'}
          </Button>
        </Row>
        <Row
          title="Importar planilha"
          hint="Mapeia as colunas da sua planilha para movimentações e mostra uma prévia antes de gravar."
        >
          <Button onClick={() => setImporting(true)}>Importar arquivo</Button>
        </Row>
      </SettingsPanel>

      <SettingsPanel title="Backup" hint="cifrado, guardado fora do aparelho">
        <Row
          title="Backup automático"
          hint="Todo dia às 03:00; mantém 7 diários, 4 semanais e 6 mensais."
        >
          <Switch
            checked={backup.enabled}
            label="Backup automático"
            title="O backup automático é ligado na instalação."
          />
        </Row>
        <Row
          title="Último backup"
          hint={
            backup.enabled ? (
              <>
                {lastText}
                {backup.last_failure === null ? null : (
                  <>
                    {' · '}
                    <BackupState backup={backup} />
                  </>
                )}
              </>
            ) : (
              backupSummary(backup).text
            )
          }
        >
          <Button disabled={running || !backup.enabled || backup.pending} onClick={run}>
            {running ? 'Pedindo…' : 'Fazer backup agora'}
          </Button>
        </Row>
        <Row title="Restaurar" hint="Escolha um backup; o estado atual é guardado antes.">
          <Button
            disabled={!backup.enabled}
            aria-expanded={choosing}
            onClick={() => setChoosing((open) => !open)}
          >
            Escolher backup
          </Button>
        </Row>
        {receipt === null ? null : (
          <div className="border-t border-line px-4 py-3">
            <ActionNote tone={receipt.tone}>{receipt.text}</ActionNote>
          </div>
        )}
        {choosing ? <BackupFiles backup={backup} /> : null}
      </SettingsPanel>

      <SettingsPanel title="Zona de perigo">
        <Row
          title="Apagar todos os dados"
          hint="Remove movimentações, ativos e carteiras. Pede para digitar a frase de confirmação."
        >
          <Button variant="destructive" onClick={() => setDeleting(true)}>
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
        permanentemente as movimentações, as carteiras e tudo que há nelas, as
        instituições, os ativos cadastrados à mão, os preços manuais e os proventos
        anunciados. Preços de mercado e backups já gravados no bucket não são apagados.
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
