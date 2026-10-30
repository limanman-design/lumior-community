// Program-controlled provider settings. Question answering uses high;
// latency-sensitive translation may select low internally.
export type AiReasoningEffort = 'low' | 'high' | 'max';

export const defaultAiReasoningEffort: AiReasoningEffort = 'high';
