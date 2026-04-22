import React from 'react';
import { css } from '@emotion/css';
import { useStyles2 } from '@grafana/ui';
import type { GrafanaTheme2, PanelProps } from '@grafana/data';

import { defaultGoomOptions, type GoomOptions } from '../types';
import { GameCanvas } from './GameCanvas';

type Props = PanelProps<GoomOptions>;

/**
 * Top-level panel component. Grafana gives us width/height + `options`; we
 * hand off to <GameCanvas> which owns the engine lifecycle.
 */
export const GoomPanel: React.FC<Props> = ({ options, width, height }) => {
  const styles = useStyles2(getStyles);
  // Defensive: older dashboards may not have every field set yet.
  const resolved: GoomOptions = { ...defaultGoomOptions, ...options };

  return (
    <div className={styles.root} style={{ width, height }}>
      <GameCanvas options={resolved} width={width} height={height} />
    </div>
  );
};

const getStyles = (theme: GrafanaTheme2) => ({
  root: css`
    width: 100%;
    height: 100%;
    position: relative;
    background: ${theme.colors.background.canvas};
    border-radius: ${theme.shape.radius.default};
    overflow: hidden;
  `,
});
