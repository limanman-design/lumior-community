import type { AiQuestion } from '../lib/ai-question';
import { translate as t } from './i18n-core';
import './ai-question-options.css';

export function AiQuestionOptions({ question, answer, disabled, onAnswer }: {
  question: AiQuestion; answer?: string; disabled: boolean; onAnswer: (answer: string) => void;
}) {
  return <div className="ai-question-options" aria-label={t('Answer options', '问题选项')}>
    <div className="ai-question-choices">{question.options.map(option =>
      <button type="button" key={option} disabled={disabled || answer !== undefined} aria-pressed={answer === option} onClick={() => onAnswer(option)}>{option}</button>)}</div>
    {answer === undefined && <p className="ai-question-hint">{t('You can also answer in your own words below.', '也可以在下方用自己的话回答。')}</p>}
  </div>;
}
