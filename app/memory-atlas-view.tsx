'use client';
import { useEffect, useRef } from 'react';
import { useI18n } from './i18n';
import { translate as t } from './i18n-core';
import { createMemoryAtlas } from './vendor/memory-atlas/memory-atlas.js';
import type { MemoryAtlas, MemoryAtlasData, MemoryAtlasSelection } from './vendor/memory-atlas/types';

export function MemoryAtlasView({ data, onSelect, onError }: {
  data: MemoryAtlasData;
  onSelect: (selection: MemoryAtlasSelection | null) => void;
  onError: (message: string) => void;
}) {
  const {language}=useI18n();
  const host = useRef<HTMLDivElement>(null);
  const instance = useRef<MemoryAtlas | null>(null);
  const callbacks = useRef({ onSelect, onError });
  const lastData = useRef(data);
  useEffect(() => { callbacks.current = { onSelect, onError }; }, [onSelect, onError]);
  useEffect(() => {
    if (!host.current) return;
    let atlas: MemoryAtlas | null = null;
    try {
      atlas = createMemoryAtlas(host.current, {
        data: lastData.current, scene: 'galaxy', ui: { brand: false, card: false },
        autoLink: false, loadFonts: false, maxPixels: 2.5e6, maxFps: 60, persistScene: true, idleDrift: false,
        onSelect: item => callbacks.current.onSelect(item),
        text: {
          shore: { title:t('Memory Sea','记忆星海'),note: '',stir:t('Stir the water','搅动海水'),mouse:t('Drag to stir · Scroll along the coast · Select a light','拖动 搅动海水 · 滚动 沿海岸漫游 · 点一点光'),touch:t('One finger to stir · Two fingers to pan and zoom','单指 搅动海水 · 双指 移动与缩放') },
          galaxy: { title:t('Memory Galaxy','记忆星河'),note: '',stir:t('Stir the stardust','拨动星尘'),mouse:t('Drag to stir · Scroll along the galaxy · Select a star','拖动 拨动星尘 · 滚动 沿银河漫游 · 点一颗星'),touch:t('One finger to stir · Two fingers to pan and zoom','单指 拨动星尘 · 双指 移动与缩放') },
          sceneShore:t('Coast','海岸'),sceneGalaxy:t('Galaxy','星河'),pan:t('Pan view','移动视角'),sceneGroup:t('Scene','场景'),dragGroup:t('While dragging','拖动时'),legend:t('Card categories','记忆分类'),
          linked:t('Connected','相连'),nearest:t('Nearest card','离它最近'),reviewed:(count:number)=>t('Reviewed {count} times','回看 {count} 次',{count}),unsorted:t('Unsorted','还没整理'),fragmentTag:t('Fragment','碎片'),today:t('Today','今 天'),prev:t('Earlier cards','更早的一段记忆'),next:t('Later cards','更晚的一段记忆'),
          count: (count: number) => t('{count} cards','{count} 张卡片',{count}),
          ariaLabel: t('Memory Atlas: each light represents a card. Understanding depth is 0.6 and has not been assessed.','记忆星图：每一点光对应一张卡片，理解深度统一为 0.6，暂未评估'),
          list: t('Atlas cards','星图卡片列表'),
        },
      });
      instance.current = atlas;
    } catch (error) {
      callbacks.current.onError(error instanceof Error ? error.message : t('Unable to load the atlas','星图加载失败'));
    }
    return () => { atlas?.destroy(); instance.current = null; };
  }, [language]);
  useEffect(() => {
    if (lastData.current === data) return;
    lastData.current = data;
    instance.current?.setData(data);
  }, [data]);
  return <div ref={host} className="memory-atlas-host" />;
}
