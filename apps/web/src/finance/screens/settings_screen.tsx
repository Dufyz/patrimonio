import { usePreferences } from '../../components/preferences.js';
import { Label, Panel, Segmented } from '../../components/primitives.js';
import type { ThemePreference } from '../../lib/theme.js';
import { ScreenHeader } from '../components/screen_header.js';

/**
 * FIN-006 · Configurações de Finanças.
 *
 * O conteúdo da tela não tem prancha (ponto em aberto no documento de
 * histórias). Por ora ela hospeda o que já tem história: a escolha de tema, que
 * acompanha o sistema na primeira abertura e persiste neste navegador.
 */

const THEMES = [
  { value: 'light', label: 'Claro' },
  { value: 'dark', label: 'Escuro' },
  { value: 'system', label: 'Sistema' },
] as const satisfies readonly { value: ThemePreference; label: string }[];

export const SettingsScreen = (): React.ReactElement => {
  const { theme, setTheme } = usePreferences();

  return (
    <>
      <ScreenHeader title="Configurações" subtitle="Preferências deste navegador" />
      <Panel title="Aparência" hint="valem para este navegador">
        <div className="flex flex-col gap-2 p-4">
          <Label>Tema</Label>
          <Segmented label="Tema" options={THEMES} value={theme} onChange={setTheme} />
        </div>
      </Panel>
    </>
  );
};
