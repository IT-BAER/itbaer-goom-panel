import { PanelPlugin } from '@grafana/data';
import { defaultGoomOptions, type GoomOptions } from './types';
import { GoomPanel } from './components/GoomPanel';

export const plugin = new PanelPlugin<GoomOptions>(GoomPanel).setPanelOptions((builder) => {
  return builder
    .addRadio({
      path: 'wadSource',
      name: 'WAD source',
      description: 'Which IWAD the engine loads on panel mount.',
      defaultValue: defaultGoomOptions.wadSource,
      settings: {
        options: [
          { value: 'freedoom', label: 'Freedoom (bundled)' },
          { value: 'user',     label: 'User-uploaded (cached)' },
          { value: 'url',      label: 'URL' },
        ],
      },
    })
    .addTextInput({
      path: 'wadUrl',
      name: 'WAD URL',
      description: 'http(s) URL for a .wad file (e.g. a PWAD you host).',
      defaultValue: '',
      showIf: (cfg) => cfg.wadSource === 'url',
    })
    .addTextInput({
      path: 'wadSha',
      name: 'User WAD (SHA-1)',
      description:
        'SHA-1 of a WAD previously cached in this browser. Upload a WAD via the in-panel HUD to populate.',
      defaultValue: '',
      showIf: (cfg) => cfg.wadSource === 'user',
    })
    .addRadio({
      path: 'controls',
      name: 'Controls',
      defaultValue: defaultGoomOptions.controls,
      settings: {
        options: [
          { value: 'wasd',    label: 'WASD' },
          { value: 'vanilla', label: 'Vanilla (arrows + Ctrl)' },
        ],
      },
    })
    .addBooleanSwitch({
      path: 'muteOnLoad',
      name: 'Mute on load',
      defaultValue: defaultGoomOptions.muteOnLoad,
    })
    .addBooleanSwitch({
      path: 'autoStart',
      name: 'Auto-start',
      description: 'If off, the panel shows a "Press play" splash instead of booting immediately.',
      defaultValue: defaultGoomOptions.autoStart,
    });
});
