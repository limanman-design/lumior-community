'use client';

import { useCallback, useMemo, useState } from 'react';
import { Dialog } from '@/components/ui/dialog';
import type { Board } from '../canvas-model';
import { useI18n } from '../i18n';
import { dateLegacyBoard, mapMemoryAtlas, type LumiorMemory } from '../memory-atlas-data';
import { MemoryAtlasView } from '../memory-atlas-view';
import { MemoryNoteDetail } from '../memory-note-detail';
import type { MemoryAtlasSelection } from '../vendor/memory-atlas/types';
import '../memory-atlas.css';
import './preview.css';

// Isolated visual proposal: these small fixtures never enter a workspace. Keep
// the public demo's full example boards out of the normal application's bundle.
export default function MemoryCardPreviewPage() {
  const { t } = useI18n();
  const [boards] = useState<Board[]>(() => [dateLegacyBoard({
    id: 'memory-preview', title: 'Memory preview',
    cards: [
      { id: 'preview-question', kind: 'note', title: 'A question worth exploring', body: 'Start with a question. Gather evidence, compare ideas, and record what changes your mind.', x: 0, y: 0, width: 360 },
      { id: 'preview-evidence', kind: 'note', title: 'Keep the evidence nearby', body: 'A useful note connects an observation with the source that supports it.', x: 440, y: 0, width: 360 },
      { id: 'preview-next-step', kind: 'note', title: 'The next step', body: 'Turn an open question into a small next step that can be checked.', x: 880, y: 0, width: 360 },
    ],
    edges: [{ id: 'preview-link', from: 'preview-question', to: 'preview-evidence' }, { id: 'preview-next', from: 'preview-evidence', to: 'preview-next-step' }],
  })]);
  const data = useMemo(() => {
    const mapped = mapMemoryAtlas(boards, boards[0].id);
    const names: Record<string, string> = { note: t('Notes', '笔记'), text: t('Text', '文本'), image: t('Images', '图片'), pdf: 'PDF', video: t('Videos', '视频') };
    return { ...mapped, categories: mapped.categories.map(category => ({ ...category, name: names[category.id] || category.name })) };
  }, [boards, t]);
  const [selectedId, setSelectedId] = useState<string | null>('preview-question');
  const [error, setError] = useState('');
  const selected = data.memories.find(memory => memory.id === selectedId);
  const choose = useCallback((item: MemoryAtlasSelection | null) => {
    const memory = item?.source as LumiorMemory | undefined;
    if (!memory || memory.card.kind === 'note' || memory.card.kind === 'text') setSelectedId(memory?.id || null);
  }, []);

  return <main className="memory-card-preview-page" aria-label={t('Memory Atlas', '记忆星图')}>
    <div className="memory-card-preview-stage"><MemoryAtlasView data={data} onSelect={choose} onError={setError}/></div>
    {error && <p className="memory-card-preview-error" role="alert">{t('The atlas is temporarily unavailable.', '星图暂时无法显示。')}</p>}
    <Dialog open={!!selected} onOpenChange={open => { if (!open) setSelectedId(null); }}>
      {selected && <MemoryNoteDetail memory={selected} onLocate={() => setSelectedId(null)}/>}
    </Dialog>
  </main>;
}
