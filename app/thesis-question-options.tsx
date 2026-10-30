import type { ThesisQuestion } from '../lib/thesis/model';

export function ThesisQuestionOptions({ question, answer, disabled, onAnswer }: {
  question: ThesisQuestion; answer?: string; disabled: boolean; onAnswer: (answer: string) => void;
}) {
  return <div className="thesis-question-options" aria-label="问题选项">
    <div className="thesis-question-choices">{question.options.map(option =>
      <button key={option} disabled={disabled || answer !== undefined} aria-pressed={answer === option} onClick={() => onAnswer(option)}>{option}</button>)}</div>
    {answer === undefined && <p className="thesis-question-hint">也可以在下方用自己的话回答。</p>}
  </div>;
}
