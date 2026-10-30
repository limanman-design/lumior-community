'use client';
import { useI18n } from './i18n';
/* oxlint-disable next/no-img-element -- Preserve the exported SVG geometry and Figma's exact image crop. */

import type { ReactElement } from 'react';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip';
import './section-help.css';

export function SectionIcon() {
  return (
    <span className="section-symbol" aria-hidden="true">
      <img src="/assets/canvas-toolbar/section.svg" alt="" draggable={false} />
    </span>
  );
}

export function SectionHelp({ children }: { children: ReactElement }) {
  const { t } = useI18n();
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent
        className="lumior-tooltip section-help"
        side="right"
        sideOffset={16}
        align="start"
        alignOffset={-56}
        collisionAvoidance={{ side: 'flip', align: 'shift' }}
      >
        <div className="section-help-heading">
          <span className="section-help-badge">
            <SectionIcon />
          </span>
          <div>
            <strong>{t('Section · A', '区域 · A')}</strong>
            <span>
              {t(
                'Give related cards a place of their own.',
                '让相关卡片拥有自己的区域。',
              )}
            </span>
          </div>
        </div>
        <p>
          {t(
            'Group cards into named sections to organize your research by topic, project, or stage. Keep the bigger picture clear as your canvas grows.',
            '将卡片归入命名区域，按主题、项目或阶段整理研究。画布不断扩展，也能清楚看到整体。',
          )}
        </p>
        <div className="section-help-example">
          <div className="section-help-image">
            <img
              src="/assets/board-chrome/section-example.png"
              alt={t(
                'Research cards organized into blue, purple and orange sections',
                '研究卡片分组在蓝色、紫色和橙色区域内',
              )}
              draggable={false}
            />
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
