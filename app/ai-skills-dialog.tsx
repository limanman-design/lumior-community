'use client';

import { BookOpen, X } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useI18n } from './i18n';
import { thesisSkills } from '@/lib/thesis/model';

export function AiSkillsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (value: boolean) => void }) {
  const { t } = useI18n();
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="ai-skills-dialog" overlayClassName="ai-skills-overlay" showCloseButton={false}>
      <button className="ai-skills-close" aria-label={t('Close Skills', '关闭技能')} onClick={() => onOpenChange(false)}><X size={22} /></button>
      <span className="ai-skills-icon"><BookOpen size={28} strokeWidth={1.7} /></span>
      <DialogTitle>{t('Skills', '技能')}</DialogTitle>
      <DialogDescription>{t('Give AI specialized ways to work.', '为 AI 设置专门的工作方式。')}</DialogDescription>
      <div className="ai-skills-empty" style={{display:'grid',gap:16,textAlign:'left'}}>{thesisSkills.map(skill=><a key={skill.id} href={`/?thesisSkill=${skill.id}`} style={{display:'grid',gap:4,color:'inherit',textDecoration:'none',padding:12,borderRadius:12,background:'var(--ui-fill-hover)'}}><strong>MBA · {skill.name}</strong><span style={{fontSize:12,color:'var(--ui-text-secondary)'}}>{skill.description}</span></a>)}</div>
    </DialogContent>
  </Dialog>;
}
